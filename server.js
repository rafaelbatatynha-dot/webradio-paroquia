const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');
const { spawn } = require('child_process'); // Para rodar comandos externos como ffmpeg
const { google } = require('googleapis'); // Para Google Drive API
const path = require('path');
const fs = require('fs');

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

// ===== SUAS URLs DOS STREAMS DE RÁDIO =====
const RADIO_VOZ_IMACULADO_URL = 'http://r13.ciclano.io:9033/live'; // Rádio Voz do Coração Imaculado
const RADIO_MARABA_URL = 'https://streaming.speedrs.com.br/radio/8010/maraba'; // Rádio Marabá
const RADIO_CLASSICA_URL = 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128'; // Swiss Classic Radio
const RADIO_AMETISTA_FM_URL = 'https://www.radios.com.br/aovivo/radio-ametista-885-fm/16128'; // Rádio Ametista FM
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

// --- NOVAS VARIÁVEIS PARA O BLOCO DE MENSAGENS DAS 11H ---
let isPlayingMessageBlock = false; // Indica se estamos no bloco de mensagens das 11h
let currentMessageBlockIndex = 0; // Índice da mensagem atual no bloco
// --- FIM NOVAS VARIÁVEIS ---

// --- INÍCIO DO BLOCO DE CÓDIGO PARA GOOGLE DRIVE ---

let googleDriveAuth;
let drive;
let messageFilesCache = []; // Esta lista será preenchida dinamicamente!

async function setupGoogleDrive() {
    try {
        let credentials;
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
            credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            console.log('✅ Credenciais do Google Drive carregadas da variável de ambiente.');
        } else {
            console.error('⚠️ Variável de ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON não encontrada.');
            console.error('   Por favor, configure-a no Render com o conteúdo do seu arquivo JSON de credenciais.');
            process.exit(1); // Sai se não conseguir configurar as credenciais
        }

        googleDriveAuth = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/drive.readonly'] // Apenas leitura
        );

        await googleDriveAuth.authorize();
        drive = google.drive({ version: 'v3', auth: googleDriveAuth });
        console.log('✅ Autenticação com Google Drive bem-sucedida.');
    } catch (error) {
        console.error('❌ Erro ao configurar Google Drive:', error.message);
        process.exit(1); // Sai se houver erro na autenticação
    }
}

async function fetchMessageFilesFromDrive() {
    if (!drive) {
        console.warn('Google Drive não autenticado. Tentando configurar...');
        await setupGoogleDrive(); // Tenta configurar novamente se não estiver pronto
        if (!drive) {
            console.error('Não foi possível configurar o Google Drive. Pulando a busca de arquivos.');
            return;
        }
    }

    try {
        console.log(`🔄 Buscando arquivos de mensagem na pasta do Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}`);
        const res = await drive.files.list({
            q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType contains 'audio/' and trashed = false`,
            fields: 'files(id, name, webContentLink)',
            pageSize: 1000, // Aumenta o limite para garantir que todos os arquivos sejam pegos
        });

        const files = res.data.files;
        if (files.length) {
            messageFilesCache = files.map(file => ({
                id: file.id,
                name: file.name,
                url: file.webContentLink, // URL para download direto
            }));
            console.log(`✅ ${messageFilesCache.length} arquivos de mensagem carregados do Google Drive.`);
        } else {
            console.log('Nenhum arquivo de mensagem encontrado na pasta do Google Drive.');
        }
    } catch (err) {
        console.error('❌ Erro ao buscar arquivos do Google Drive:', err.message);
        if (messageFilesCache.length === 0) {
            console.warn('Não foi possível carregar do Google Drive e o cache está vazio. As mensagens podem não funcionar.');
        }
    }
}
// --- FIM DO BLOCO DE CÓDIGO PARA GOOGLE DRIVE ---

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
        '-q:a', '2', // Qualidade de áudio (0-9, 0 é o melhor)
        '-f', 'mp3',
        '-ar', '44100', // Taxa de amostragem
        '-ac', '2', // Canais de áudio (estéreo)
        'pipe:1' // Saída para stdout
    ];

    const currentFfmpegProcess = spawn('ffmpeg', ffmpegArgs);

    if (!isMessage) { // Se for o stream principal, armazena o processo
        ffmpegProcess = currentFfmpegProcess;
    }

    currentFfmpegProcess.stdout.pipe(res); // Envia a saída do FFmpeg diretamente para a resposta HTTP

    currentFfmpegProcess.stderr.on('data', (data) => {
        const dataStr = data.toString();
        // Filtra mensagens de progresso comuns do FFmpeg para não poluir o log
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
        // Se o processo que fechou era o principal, limpa a referência
        if (!isMessage && currentFfmpegProcess === ffmpegProcess) {
            ffmpegProcess = null;
        }
    });

    currentFfmpegProcess.on('error', (err) => {
        console.error(`❌ Falha ao iniciar processo FFmpeg para ${isMessage ? 'mensagem' : 'stream'}:`, err);
        res.status(500).send('Erro no stream de áudio.');
    });
}

// Função para obter a duração de um arquivo de áudio usando ffprobe
async function getAudioDuration(url) {
    if (ffprobeCache[url]) {
        return ffprobeCache[url];
    }

    return new Promise((resolve) => {
        const ffprobeArgs = [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            url
        ];

        const ffprobeProcess = spawn('ffprobe', ffprobeArgs);
        let duration = '';

        ffprobeProcess.stdout.on('data', (data) => {
            duration += data.toString();
        });

        ffprobeProcess.on('close', (code) => {
            if (code === 0 && duration) {
                const parsedDuration = parseFloat(duration);
                ffprobeCache[url] = parsedDuration; // Armazena no cache
                resolve(parsedDuration);
            } else {
                console.error(`❌ Erro ao obter duração de ${url}. Código: ${code}, Duração: ${duration}`);
                resolve(30); // Duração padrão de 30 segundos em caso de erro
            }
        });

        ffprobeProcess.on('error', (err) => {
            console.error(`❌ Falha ao iniciar ffprobe para ${url}:`, err);
            resolve(30); // Duração padrão em caso de erro
        });
    });
}

// Função para tocar uma mensagem
async function playMessage(message, isBlockMessage = false) {
    if (isPlayingMessage) {
        console.log(`⚠️ Mensagem "${message.name}" ignorada, outra mensagem já está tocando.`);
        return;
    }

    isPlayingMessage = true;
    console.log(`▶️ Tocando mensagem: ${message.name}`);
    io.emit('play-mensagem', {
        name: message.name,
        url: `/message-stream/${message.id}` // Usa a rota local para o stream
    });

    try {
        const duration = await getAudioDuration(`https://docs.google.com/uc?export=download&id=${message.id}`);
        console.log(`⏳ Duração da mensagem "${message.name}": ${duration} segundos.`);

        // Limpa qualquer timeout anterior para mensagens
        if (messageTimeout) {
            clearTimeout(messageTimeout);
        }

        messageTimeout = setTimeout(() => {
            isPlayingMessage = false;
            console.log(`⏹️ Mensagem "${message.name}" concluída.`);
            if (!isBlockMessage) { // Se não for uma mensagem do bloco das 11h, retorna ao stream principal
                setMainStream(); // Retorna ao stream principal
            }
            // Se for uma mensagem de bloco, o cron das 11h cuidará da próxima mensagem
        }, duration * 1000); // Converte para milissegundos
    } catch (error) {
        console.error(`❌ Erro ao obter duração ou agendar fim da mensagem "${message.name}":`, error);
        isPlayingMessage = false;
        if (!isBlockMessage) {
            setMainStream(); // Tenta retornar ao stream principal mesmo com erro
        }
    }
}

// Função para definir o stream principal com base na hora atual
function setMainStream() {
    const now = new Date();
    const day = now.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTimeInMinutes = hours * 60 + minutes;

    let newStream = currentPlayingStream; // Mantém o stream atual por padrão

    // Se uma mensagem estiver tocando OU se estivermos no bloco de mensagens das 11h, NÃO muda o stream principal
    if (isPlayingMessage || isPlayingMessageBlock) {
        console.log('⚠️ Stream principal não alterado: mensagem ou bloco de mensagens ativo.');
        return;
    }

    // ===== PROGRAMAÇÃO ESPECIAL =====

    // Madrugada Clássica (00h10 às 05h00)
    if (currentTimeInMinutes >= (0 * 60 + 10) && currentTimeInMinutes < (5 * 60)) {
        newStream = { url: RADIO_CLASSICA_URL, description: 'Swiss Classic Radio (Madrugada Clássica)' };
    }
    // Domingo: Missa Rádio Marabá 8h30-9h45
    else if (day === 0 && currentTimeInMinutes >= (8 * 60 + 30) && currentTimeInMinutes < (9 * 60 + 45)) {
        newStream = { url: RADIO_MARABA_URL, description: 'Rádio Marabá (Missa de Domingo)' };
    }
    // Sábado: Voz do Pastor 12h50-13h05
    else if (day === 6 && currentTimeInMinutes >= (12 * 60 + 50) && currentTimeInMinutes < (13 * 60 + 5)) {
        newStream = { url: RADIO_VOZ_IMACULADO_URL, description: 'Voz do Coração Imaculado (Voz do Pastor)' };
    }
    // Sábado: Missa Rádio Ametista FM 19h00-20h30
    else if (day === 6 && currentTimeInMinutes >= (19 * 60) && currentTimeInMinutes < (20 * 60 + 30)) {
        newStream = { url: RADIO_AMETISTA_FM_URL, description: 'Rádio Ametista FM (Missa de Sábado)' };
    }
    // Bloco de Mensagens das 11h-12h (Este bloco é gerenciado pelo cron específico, mas o setMainStream precisa saber)
    else if (hours === 11) {
        // Não define um stream principal aqui, pois o cron das 11h gerencia as mensagens
        // A variável isPlayingMessageBlock já foi definida como true pelo cron
        newStream = { url: 'MENSAGEM_BLOCO', description: 'Mensagens do Google Drive' }; // Stream "virtual" para o cliente
    }
    // Padrão: Voz do Imaculado (fora dos horários especiais)
    else {
        newStream = { url: RADIO_VOZ_IMACULADO_URL, description: 'Voz do Coração Imaculado' };
    }

    // Só atualiza o stream se houver uma mudança real
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
// Mensagens diárias (fora da madrugada clássica E fora do bloco das 11h-12h)
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
        // Não toca mensagens diárias se estiver na Madrugada Clássica (00h00 a 04h59)
        // OU se estiver no bloco de mensagens das 11h-12h
        if (!(hours >= 0 && hours < 5) && !(hours === 11)) {
            if (messageFilesCache.length > 0) {
                const randomMessage = messageFilesCache[Math.floor(Math.random() * messageFilesCache.length)];
                playMessage(randomMessage);
            } else {
                console.warn('Não há mensagens carregadas do Google Drive para tocar nas mensagens diárias.');
            }
        }
    });
});

// Mensagens na Madrugada Clássica (00:10 até 05:00, a cada 30 minutos)
cron.schedule('10,40 0-4 * * *', () => { // Aos 10 e 40 minutos das horas 0, 1, 2, 3, 4
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    // Garante que só toque se estiver dentro do período 00:10-05:00
    if ((hours === 0 && minutes >= 10) || (hours > 0 && hours < 5)) {
        if (messageFilesCache.length > 0) {
            const randomMessage = messageFilesCache[Math.floor(Math.random() * messageFilesCache.length)];
            playMessage(randomMessage);
        } else {
            console.warn('Não há mensagens carregadas do Google Drive para tocar na madrugada clássica.');
        }
    }
});

// --- NOVO AGENDAMENTO: Bloco de Mensagens das 11h00 às 12h00 ---
cron.schedule('* 11 * * *', async () => { // A cada minuto entre 11h00 e 11h59
    const now = new Date();
    const hours = now.getHours();
    if (hours === 11) { // Estamos dentro do período das 11h
        if (!isPlayingMessageBlock) {
            isPlayingMessageBlock = true;
            currentMessageBlockIndex = 0; // Reinicia o índice para começar do zero a cada dia
            console.log('⏰ Bloco de mensagens das 11h-12h ativado por cron.');
            // Força a atualização do stream para o bloco de mensagens
            setMainStream();
        }
        if (messageFilesCache.length === 0) {
            console.warn('Não há mensagens carregadas do Google Drive para o bloco das 11h.');
            return;
        }
        // Se não houver mensagem tocando
        if (!isPlayingMessage) {
            const messageToPlay = messageFilesCache[currentMessageBlockIndex];
            if (messageToPlay) {
                await playMessage(messageToPlay, true); // O 'true' indica que é uma mensagem de bloco
                currentMessageBlockIndex = (currentMessageBlockIndex + 1) % messageFilesCache.length; // Próxima mensagem
            } else {
                console.warn('Nenhuma mensagem encontrada no índice atual para o bloco das 11h.');
            }
        }
    } else {
        // Fora do horário das 11h, garante que o bloco esteja desativado
        if (isPlayingMessageBlock) {
            console.log('⏰ Bloco de mensagens das 11h-12h desativado por cron.');
            isPlayingMessageBlock = false;
            currentMessageBlockIndex = 0;
            // setMainStream() será chamado pelo cron '* * * * *' para retomar a rádio
        }
    }
});
// --- FIM NOVO AGENDAMENTO ---


// Inicializa a programação ao iniciar o servidor
setMainStream();
// Atualiza a programação a cada minuto
cron.schedule('* * * * *', setMainStream);

// ===== INICIANDO O SERVIDOR =====
// Antes de iniciar o servidor, configuramos o Google Drive e carregamos as mensagens
setupGoogleDrive().then(() => {
    fetchMessageFilesFromDrive().then(() => {
        server.listen(PORT, () => {
            console.log(`
╔═════════════════════════════════════════════════════╗
║                                                     ║
║  📡 Servidor iniciado com sucesso na porta ${PORT}  ║
║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║
║  📊 Mensagens carregadas: ${messageFilesCache.length}  ║
║  🎵 Rádio Principal: ${currentPlayingStream.description}  ║
║  🎼 Clássica: 00h10-05h00 (msgs a cada 30min)       ║
║  ⛪ Domingo: Missa Marabá 8h30-9h45                 ║
║  📻 Sábado: Missa Ametista 19h00-20h30              ║
║  📻 Sábado: Voz do Pastor 12h50-13h05               ║
║  ⏰ Mensagens diárias: 9:55, 12:40, 13:52...         ║
║  🗣️ Bloco de Mensagens: 11h00-12h00 (TODOS OS DIAS) ║
╚═════════════════════════════════════════════════════╝
            `);
        });
    });
}).catch(error => {
    console.error('❌ Falha crítica ao iniciar o servidor devido a erro no Google Drive:', error);
    process.exit(1); // Sai se não conseguir configurar o Drive
});

// Função para tocar o stream principal (chamada pelo cliente)
function playMainStream() {
    if (!isPlayingMessage) {
        io.emit('play-stream', currentPlayingStream);
    }
}
