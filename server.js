const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process'); // Para rodar comandos externos como ffmpeg
const app = express();

// ===== CONFIGURAÇÃO DO CORS =====
const allowedOrigins = [
    'https://www.paroquiaauxiliadorairai.com.br',
    'https://webradio-paroquia.onrender.com',
    'http://localhost:3000'
];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'CORS policy violation';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    }
}));
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;
const GOOGLE_DRIVE_FOLDER_ID = '1fxtCinZOfb74rWma-nSI_IUNgCSvrUS2';

// ===== SUAS URLs DOS STREAMS DE RÁDIO (NÃO ALTERADAS!) =====
const RADIO_VOZ_IMACULADO_URL = 'http://r13.ciclano.io:9033/live'; // Rádio Voz do Coração Imaculado
const RADIO_MARABA_URL = 'https://streaming.speedrs.com.br/radio/8010/maraba'; // Rádio Marabá
const RADIO_CLASSICA_URL = 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128'; // Swiss Classic Radio
// ==============================================================================

app.use(express.static('public'));

// ===== VARIÁVEIS GLOBAIS =====
let currentPlayingStream = {
    url: '', // Esta URL será o endpoint LOCAL do seu servidor (ex: '/stream')
    description: ''
};
let lastMainStream = { // Para retornar à rádio anterior após a mensagem
    url: RADIO_VOZ_IMACULADO_URL,
    description: 'Voz do Coração Imaculado'
};
let isPlayingMessage = false;
let messageTimeout = null;
let ffmpegProcess = null; // Variável para armazenar o processo FFmpeg do stream principal
let ffprobeCache = {}; // Cache para armazenar a duração das mensagens

// Função para iniciar o stream FFmpeg (para rádios ou mensagens)
function startFfmpegStream(sourceUrl, res, isMessage = false) {
    // Se for um stream principal e já houver um processo FFmpeg rodando, encerra-o primeiro
    if (!isMessage && ffmpegProcess) {
        console.log('🔄 Encerrando processo FFmpeg anterior do stream principal...');
        ffmpegProcess.kill('SIGKILL'); // Força o encerramento
        ffmpegProcess = null;
    }

    console.log(`▶️ Iniciando FFmpeg para ${isMessage ? 'mensagem' : 'stream'}: ${sourceUrl}`);

    const ffmpegArgs = [
        '-i', sourceUrl,
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        '-f', 'mp3',
        '-ar', '44100',
        '-ac', '2',
        'pipe:1'
    ];

    const currentFfmpegProcess = spawn('ffmpeg', ffmpegArgs);

    // Se for o stream principal, armazena a referência
    if (!isMessage) {
        ffmpegProcess = currentFfmpegProcess;
    }

    currentFfmpegProcess.stdout.pipe(res);

    currentFfmpegProcess.stderr.on('data', (data) => {
        // Apenas loga se não for o output normal de progresso do FFmpeg
        const dataStr = data.toString();
        if (!dataStr.includes('size=') && !dataStr.includes('time=') && !dataStr.includes('bitrate=')) {
            console.error(`❌ FFmpeg stderr (${isMessage ? 'mensagem' : 'stream'}): ${dataStr}`);
        }
    });

    currentFfmpegProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`❌ FFmpeg process exited with code ${code} for ${isMessage ? 'message' : 'stream'}: ${sourceUrl}`);
        } else {
            console.log(`⏹️ FFmpeg process closed gracefully for ${isMessage ? 'message' : 'stream'}: ${sourceUrl}`);
        }
        if (!isMessage && currentFfmpegProcess === ffmpegProcess) {
            ffmpegProcess = null; // Limpa a referência apenas se for o processo principal atual
        }
    });

    currentFfmpegProcess.on('error', (err) => {
        console.error(`❌ Failed to start FFmpeg process for ${isMessage ? 'message' : 'stream'}:`, err);
        if (!res.headersSent) {
            res.status(500).send(`Erro ao iniciar o stream de ${isMessage ? 'mensagem' : 'rádio'}.`);
        }
        if (!isMessage && currentFfmpegProcess === ffmpegProcess) {
            ffmpegProcess = null;
        }
    });
}

// Rota para o stream principal (rádios)
app.get('/stream', (req, res) => {
    res.set({
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    startFfmpegStream(currentPlayingStream.url, res, false);
});

// Rota para o stream de mensagens do Google Drive
app.get('/message-stream/:id', (req, res) => {
    const messageId = req.params.id;
    const googleDriveUrl = `https://docs.google.com/uc?export=download&id=${messageId}`;
    res.set({
        'Content-Type': 'audio/mpeg',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    startFfmpegStream(googleDriveUrl, res, true); // isMessage = true
});

// Função para obter a duração de um arquivo de áudio usando ffprobe
async function getAudioDuration(fileId) {
    if (ffprobeCache[fileId]) {
        return ffprobeCache[fileId];
    }

    const googleDriveUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
    console.log(`⏳ Obtendo duração para ${fileId} via ffprobe...`);

    return new Promise((resolve, reject) => {
        const ffprobeProcess = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            googleDriveUrl
        ]);

        let duration = '';
        ffprobeProcess.stdout.on('data', (data) => {
            duration += data.toString();
        });

        ffprobeProcess.on('close', (code) => {
            if (code === 0) {
                const parsedDuration = parseFloat(duration);
                if (!isNaN(parsedDuration) && parsedDuration > 0) {
                    ffprobeCache[fileId] = parsedDuration;
                    console.log(`✅ Duração de ${fileId}: ${parsedDuration.toFixed(2)} segundos`);
                    resolve(parsedDuration);
                } else {
                    console.warn(`⚠️ ffprobe retornou duração inválida para ${fileId}: ${duration.trim()}. Usando fallback de 60s.`);
                    resolve(60); // Fallback para 60 segundos
                }
            } else {
                console.error(`❌ ffprobe exited with code ${code} for ${fileId}. Output: ${duration.trim()}. Usando fallback de 60s.`);
                reject(new Error(`ffprobe failed for ${fileId}`));
            }
        });

        ffprobeProcess.on('error', (err) => {
            console.error(`❌ Failed to start ffprobe process for ${fileId}:`, err);
            reject(err);
        });
    }).catch(err => {
        console.error(`Erro ao obter duração para ${fileId}:`, err.message);
        return 60; // Fallback em caso de erro total
    });
}

// ===== LISTA COMPLETA DE MENSAGENS DO GOOGLE DRIVE (SEM DUPLICAÇÕES) =====
const mensagensCache = [
    { id: '1Z4ZZ_QhM82ivnbWg7c7zofCkGE6HuqJu', name: 'msg_010.mp3' },
    { id: '1v10QzlGw4gGsJgWgsI6Gx7u0YHGzAmZH', name: 'msg_009.mp3' },
    { id: '1nEiDvQ5-8RXWIO8btpqVMvEzJn3IwpP', name: 'msg_008.mp3' }, // Corrigido ID (era 1nEiDvQ5-8RXWIO8btpqVMvEzJn7IwpP)
    { id: '11LSjJO3r_dKMls2YOrxzRvbchoM-Eoz3', name: 'msg_007.mp3' },
    { id: '1vxw4yR4NcBfs-DCvktOSzsi7zvhiUkWh', name: 'msg_006.mp3' },
    { id: '13LaeViIDUK-IwZCALw-5mV5sHTYoQkiZ', name: 'msg_005.mp3' },
    { id: '1gFFmjUUNoqkdIHMGc-cYxP9SX6Zpp8v4', name: 'msg_004.mp3' },
    { id: '1N49UV49UgOX8MaYmCO0EJwN2VB1Izp3S', name: 'msg_003.mp3' },
    { id: '1f1xLhQWdCdLNCyHHnaHgH6zihHIE4gcv', name: 'msg_002.mp3' },
    { id: '118tRazLR0sUIks4E43HH9ggOB_VMC7Pl', name: 'msg_001.mp3' },
    { id: '1uX99frB_rnEU_uBD57u2WcdJaox4c6j_', name: 'Salmo 106.mp3' },
    { id: '1lVviofGAdqEWygzdFLd1emt57flF9W1M', name: 'Salmo 119.mp3' },
    { id: '1CLztJTfu0s8psYxpCVyQ-lti_lZTt6E7', name: 'Salmo 105.mp3' },
    { id: '1y4ES81ZUYH_ads_Y0R3B2Ww5hHUks88p', name: 'Salmo 107.mp3' },
    { id: '16v61m1k5tdKTZUBSucQkvhevBvhMuFTp', name: 'Salmo 78.mp3' },
    { id: '12ra2H5ucpEO7aqCwVoFogJOkp_7rwX5w', name: 'Salmo 117.mp3' },
    { id: '1AkPfoVZLmNofXx0wHNlpSsIiHSEalEIB', name: 'Salmo 131.mp3' },
    { id: '1yN8U5g4lODAEhqR7wKwXerPjoT4hNGWh', name: 'Salmo 134.mp3' },
    { id: '1BOb5GEiBhR9DeK2vLeF5CKn499v-jNG_', name: 'Salmo 121.mp3' },
    { id: '1i3TK4QZvfh_BN_WpOKrxufZoWfRl-0Iv', name: 'Salmo 128.mp3' },
    { id: '1ehj7_Oba7RtKaTBz0s3WOkZx0H4e4bYr', name: 'Salmo 133.mp3' },
    { id: '1L37pSgDdbEJOB71Rh9wU_F1JieX5uS_y', name: 'Salmo 127.mp3' },
    { id: '1i4VpP7lC7DuXHx7ggpdrESR_yIYyCT_8', name: 'Salmo 100.mp3' },
    { id: '1LlfKangFdPNuo3Hk32SI1Q12C323YTLy', name: 'Salmo 125.mp3' },
    { id: '1EBezglx-IfwK602bxrNkbmTADtQdWQZq', name: 'Salmo 114.mp3' },
    { id: '1fiTdtM7SCT0Bk0HboUv7YLlpOv6YGnCM', name: 'Salmo 93.mp3' },
    { id: '1h0pejzsa0msag3cPgZFfoHdxRD-VtEYl', name: 'Salmo 113.mp3' },
    { id: '1kkTNKs332_0e3c06IYHsbFauWMU7URzE', name: 'Salmo 126.mp3' },
    { id: '1n1gy4l9k6B6l5B_eXeaRHcb9895GOAD7', name: 'Salmo 120.mp3' },
    { id: '1D1edO6gqvUS9Eqw0Zm8SzrLa07Ac68Rc', name: 'Salmo 123.mp3' },
    { id: '1gF69TOjPdaSbm3R4OBuVw8glpdASlrFS', name: 'Salmo 150.mp3' },
    { id: '1_3urJGy0_j66Vmf8y2-2P0k0P87TOGeS', name: 'Salmo 124.mp3' },
    { id: '1j0_9NwY7KEctjj7fh5sn35sAsUr1HZAl', name: 'Salmo 129.mp3' },
    { id: '1j2jClOT6fEGMffd2mehNbYmcopmdplGB', name: 'Salmo 122.mp3' },
    { id: '1BwKCFU7FHI4PW4oBVQqUu1GaiAVID3Eo', name: 'Salmo 137.mp3' },
    { id: '1FNdZIxM8LO4LFdH0EsThYsElmbC-dhK8', name: 'Salmo 130.mp3' },
    { id: '16VECEsmwSs8gVuMj2IXpAVOQ1qaFIXyA', name: 'Salmo 142.mp3' },
    { id: '1tySpNqegPCjV2qI-hBpmavutvFIwDwqi', name: 'Salmo 149.mp3' },
    { id: '1-uelr59uvtKIK3ctyPzv9jBroFBvWP3v', name: 'Salmo 101.mp3' },
    { id: '1mVkLs2hZYAEiPkdW8iw4-oF5fh1wsVhg', name: 'Salmo 82.mp3' },
    { id: '1BTOwj2xHP0j4ppPMqdDYDZXd916cpuhd', name: 'Salmo 112.mp3' },
    { id: '1Rji9Ybuh2Kyz-1SpMrMRkqmBrrZ7uOml', name: 'Salmo 138.mp3' },
    { id: '1e-MZeWuu7n9xIu6UulFFA0Je4bKumZ4j', name: 'Salmo 111.mp3' },
    { id: '13Istud0Ruj7oKHHHbblLznAXpm_W0Zho', name: 'Salmo 146.mp3' },
    { id: '18FJOdANODiBo-vyYzsem9KwpyHZ3qi3k', name: 'Salmo 87.mp3' },
    { id: '1EZzacTP20mPeBoEucmZC65ivsVL-Ay5D', name: 'Salmo 110.mp3' },
    { id: '1t9_AYDKPVjS87wdmxdqQKS4s2AtlPA3F', name: 'Salmo 98.mp3' },
    { id: '1NxLbScmVCEbGN9rqB3WNmfCeqmTKV3A4', name: 'Salmo 141.mp3' },
    { id: '1JAqRW0pDm6XgDa8Lhdm2jI-cmqtDxKS8', name: 'Salmo 95.mp3' },
    { id: '1dvmlynb5yDVHcQxZnMIQ7UrbUHTgisev', name: 'Salmo 99.mp3' },
    { id: '1-m0huWoY2VZjxcmb0NAE6AuT29zU7oIh', name: 'Salmo 140.mp3' },
    { id: '1Z22hoepgWHjoCKkd5JUCOViIYRLUuO5F', name: 'Salmo 97.mp3' },
    { id: '1TWDRwqRDTBRwSSBiMHTw0GdXMwNBo24S', name: 'Salmo 76.mp3' },
    { id: '1fQe7QcMcoyfymh2k4N682tZVZ5jO02hV', name: 'Salmo 96.mp3' },
    { id: '1iIRJ121q9sk-uE2PQQL9uxmUEmiIPJsx', name: 'Salmo 143.mp3' },
    { id: '1EPWnB4wB69Ps53UORwfPbuKiVzQIKEbn', name: 'Salmo 84.mp3' },
    { id: '1eC6CqwimvrMydZGyXiEhRRV3XhwLkupv', name: 'Salmo 148.mp3' },
    { id: '17WDUcHHwDgzURL6Iyn7xsdpGjGc86Dn4', name: 'Salmo 147.mp3' },
    { id: '1i-aJU88g9GveRgRaPhQ43-HhkA_GM_Hn', name: 'Salmo 85.mp3' },
    { id: '1E9pmHkkFrZRTDXWTihqNIvkRJLrFMh9X', name: 'Salmo 91.mp3' }
];

// Variável para armazenar a mensagem atual sendo reproduzida
let currentMessage = null;

// Função para tocar uma mensagem
async function playMessage(message) {
    if (isPlayingMessage) {
        console.log(`⚠️ Mensagem ${message.name} ignorada, outra mensagem já está tocando.`);
        return;
    }

    isPlayingMessage = true;
    currentMessage = message;
    console.log(`📢 Iniciando mensagem: ${message.name}`);

    // Envia o comando para o cliente tocar a mensagem
    io.emit('play-mensagem', {
        name: message.name,
        url: `/message-stream/${message.id}` // Usa a nova rota de proxy
    });

    const duration = await getAudioDuration(message.id);
    console.log(`⏳ Mensagem ${message.name} tem duração de ${duration.toFixed(2)} segundos.`);

    // Limpa qualquer timeout anterior para evitar conflitos
    if (messageTimeout) {
        clearTimeout(messageTimeout);
    }

    messageTimeout = setTimeout(() => {
        console.log(`⏹️ Mensagem ${message.name} finalizada (timeout de ${duration}s).`);
        isPlayingMessage = false;
        currentMessage = null;
        io.emit('stop-mensagem'); // Informa o cliente para parar a mensagem
        setMainStream(); // Retorna ao stream principal
    }, duration * 1000); // Converte segundos para milissegundos
}

// Função para definir o stream principal com base na programação
function setMainStream() {
    if (isPlayingMessage) {
        console.log('⚠️ Não alterando stream principal, mensagem está tocando.');
        return;
    }

    const now = new Date();
    const day = now.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTimeInMinutes = hours * 60 + minutes;

    let newStream = {
        url: RADIO_VOZ_IMACULADO_URL,
        description: 'Voz do Coração Imaculado'
    };

    // ===== PROGRAMAÇÃO ESPECIAL =====

    // Domingo: Rádio Marabá (Missa) 8h30-9h45
    if (day === 0 && currentTimeInMinutes >= (8 * 60 + 30) && currentTimeInMinutes < (9 * 60 + 45)) {
        newStream = {
            url: RADIO_MARABA_URL,
            description: 'Rádio Marabá (Missa)'
        };
    }
    // Sábado: Programa específico do sábado 12h50-13h05
    else if (day === 6 && currentTimeInMinutes >= (12 * 60 + 50) && currentTimeInMinutes < (13 * 60 + 5)) {
        newStream = {
            url: RADIO_VOZ_IMACULADO_URL, // Assumindo que o programa é na Voz do Imaculado
            description: 'Voz do Coração Imaculado (Programa de Sábado)'
        };
    }
    // Madrugada Clássica: 00h10-03h00
    else if (currentTimeInMinutes >= (0 * 60 + 10) && currentTimeInMinutes < (3 * 60)) {
        newStream = {
            url: RADIO_CLASSICA_URL,
            description: 'Swiss Classic Radio (Madrugada Clássica)'
        };
    }

    // Verifica se o stream mudou
    if (newStream.url !== currentPlayingStream.url) {
        currentPlayingStream = newStream;
        lastMainStream = newStream; // Atualiza o último stream principal válido
        console.log(`📻 Trocando para o stream principal: ${currentPlayingStream.description}`);
        io.emit('play-stream', currentPlayingStream); // Notifica o cliente para tocar o novo stream
    } else {
        console.log(`📻 Stream principal permanece: ${currentPlayingStream.description}`);
    }
}

// ===== AGENDAMENTO DE MENSAGENS =====

// Mensagens diárias (fora da madrugada clássica)
const dailyMessageTimes = [
    '55 9 * * *',   // 9:55
    '40 12 * * *',  // 12:40
    '52 13 * * *',  // 13:52
    '30 14 * * *',  // 14:30
    '50 15 * * *',  // 15:50
    '20 16 * * *',  // 16:20
    '13 17 * * *',  // 17:13
    '55 18 * * *',  // 18:55
    '55 19 * * *',  // 19:55
    '50 23 * * *'   // 23:50
];

dailyMessageTimes.forEach(time => {
    cron.schedule(time, () => {
        const now = new Date();
        const hours = now.getHours();
        // Não toca mensagens diárias se estiver na Madrugada Clássica
        if (!(hours >= 0 && hours < 3)) { // 00h00 a 02h59
            const randomMessage = mensagensCache[Math.floor(Math.random() * mensagensCache.length)];
            playMessage(randomMessage);
        }
    });
});

// Mensagens na Madrugada Clássica (00:10 até 03:00, a cada 15 minutos)
cron.schedule('10,25,40,55 0-2 * * *', () => { // Aos 10, 25, 40, 55 minutos das horas 0, 1, 2
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    // Garante que só toque se estiver dentro do período 00:10-03:00
    if ((hours === 0 && minutes >= 10) || (hours > 0 && hours < 3)) {
        const randomMessage = mensagensCache[Math.floor(Math.random() * mensagensCache.length)];
        playMessage(randomMessage);
    }
});

// Inicializa a programação ao iniciar o servidor
setMainStream();

// Atualiza a programação a cada minuto
cron.schedule('* * * * *', setMainStream);

// ===== INICIANDO O SERVIDOR =====
server.listen(PORT, () => {
    console.log(`
╔═════════════════════════════════════════════════════╗
║                                                     ║
║  📡 Servidor iniciado com sucesso na porta ${PORT}  ║
║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║
║  📊 Mensagens carregadas: ${mensagensCache.length}  ║
║  🎵 Rádio Principal: ${currentPlayingStream.description}  ║
║  🎼 Clássica: 00h10-03h00 (msgs a cada 15min)       ║
║  ⛪ Domingo: Missa Marabá 8h30-9h45                 ║
║  📻 Sábado: Voz do Pastor 12h50-13h05               ║
║  ⏰ Mensagens diárias: 9:55, 12:40, 13:52...         ║
╚═════════════════════════════════════════════════════╝
`);
});

// Função para tocar o stream principal (chamada pelo cliente)
function playMainStream() {
    if (!isPlayingMessage) {
        io.emit('play-stream', currentPlayingStream);
    }
}
