const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors');

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

app.use(express.static('public'));

// ===== VARIÁVEIS GLOBAIS =====
let currentPlayingStream = {
    url: '',
    description: ''
};

let isPlayingMessage = false;
let messageTimeout = null;

// ===== LISTA COMPLETA DE MENSAGENS DO GOOGLE DRIVE =====
// Obtida do script do Google Apps Script
const mensagensCache = [
    { id: '1Z4ZZ_QhM82ivnbWg7c7zofCkGE6HuqJu', name: 'msg_010.mp3' },
    { id: '1v10QzlGw4gGsJgWgsI6Gx7u0YHGzAmZH', name: 'msg_009.mp3' },
    { id: '1nEiDvQ5-8RXWIO8btpqVMvEzJnL7IwpP', name: 'msg_008.mp3' },
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
    { id: '1E9pmHkkFrZRTDXWTihqNIvkRJLrFMh9X', name: 'Salmo 91.mp3' },
    { id: '1vhLxfYB_JBdn3SFpORdgBoH-hjQHLDnH', name: 'Salmo 115.mp3' },
    { id: '16btERmT1143oUmmOySL2VhcBXvbwoZYd', name: 'Salmo 132.mp3' },
    { id: '1uJ47-F3_rdYOc8bJfvUt5VT00mACbVv-', name: 'Salmo 79.mp3' },
    { id: '1WltDlJIhToRhYWldW1-RD3eioSNj9gTF', name: 'Salmo 86.mp3' },
    { id: '17W14onAoXbesGGPtJx0yXJ3dpeRgrkoE', name: 'Salmo 108.mp3' },
    { id: '1FrvFITpG_dqHAPPY3Semh4n1mtVLJtyx', name: 'Salmo 135.mp3' },
    { id: '1f4C4XMjBQbcQpbpU3TepmSX6u0aA_nZe', name: 'Salmo 144.mp3' },
    { id: '1tF8kBjxOZp1HocuaslCUSbvKb91mSSVB', name: 'Salmo 81.mp3' },
    { id: '14DCDLo2BAhhNRL8s5imYYz_0qjcFceta', name: 'Salmo 92.mp3' },
    { id: '14IOd1hk7lYs1lKbz6El2TjM4M4hB8XOO', name: 'Salmo 83.mp3' },
    { id: '174hpzizP1WB50v3BMZXQZso1X4FFQbwz', name: 'Salmo 116.mp3' },
    { id: '1EInNuT1B64D6Htlmko3a-vzRjGFF3NJE', name: 'Salmo 136.mp3' },
    { id: '1WHHIXhB3uigF3qhnKTXgZApZ_-RqyI4_', name: 'Salmo 145.mp3' },
    { id: '1PRx7SFua2XBahxRDdoj6KKXycGBoSv_x', name: 'Salmo 77.mp3' },
    { id: '1K8mvUQsX5pFfHue9yEhSY5rZKLw2nK0e', name: 'Salmo 139.mp3' },
    { id: '1Wqe3TOyiwlOvX8YhRyaFvTXP76WXQEQh', name: 'Salmo 88.mp3' },
    { id: '16hXZ9MYTd1O1D2TolT47ELvayhYEwXVi', name: 'Salmo 103.mp3' },
    { id: '1Me9O1G4v3yzhAm82IG4TmG47zgeToAWJ', name: 'Salmo 94.mp3' },
    { id: '14EzGTfMkJaGX1Evgj7M61Pz3hKAAlAqP', name: 'Salmo 80.mp3' },
    { id: '1ngjU6zfhJu37Kt-Osu3AMJac6dtQUCwT', name: 'Salmo 90.mp3' },
    { id: '1O2jFFifw_qRFoqvVdNW02XjM336xH0r2', name: 'Salmo 118.mp3' },
    { id: '1Q6PhLbArCELOVSy-No9kKheSoi0mCKmD', name: 'Salmo 102.mp3' },
    { id: '12BXiVMdhJEzsAdUGd94_njiPMetvKwzl', name: 'Salmo 109.mp3' },
    { id: '1w9uZG261XxrubGtPDVNKor4mpcE3A5BV', name: 'Salmo 104.mp3' },
    { id: '1S5ngs9bGc5smwNpaC1BxaaQ3wfGyvNfQ', name: 'Salmo 89.mp3' }
];

// ===== CONFIGURAÇÃO DOS STREAMS DE RÁDIO =====
const RADIO_STREAMS = {
    'vozimaculado': 'http://r13.ciclano.io:9033/live',
    'maraba': 'http://r13.ciclano.io:9033/live', // Usando o mesmo link para Marabá por enquanto
    'classica': 'http://stream.srg-ssr.ch/m/rsc_de/mp3_128', // Exemplo de rádio clássica
    'ametista-fm': 'http://stream.srg-ssr.ch/m/rsc_de/mp3_128' // Placeholder para Ametista FM
};

// ===== ROTA DE PROXY PARA STREAMS HTTP =====
app.get('/proxy-stream/:radioId', async (req, res) => {
    const radioId = req.params.radioId;
    const streamUrl = RADIO_STREAMS[radioId];

    if (!streamUrl) {
        return res.status(404).send('Stream não encontrado.');
    }

    try {
        const response = await axios({
            method: 'get',
            url: streamUrl,
            responseType: 'stream'
        });

        // Configura os cabeçalhos para o navegador entender que é um stream de áudio
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        response.data.pipe(res); // Redireciona o stream de áudio para o cliente

        response.data.on('end', () => {
            console.log(`Proxy para ${radioId} finalizado.`);
        });

        response.data.on('error', (err) => {
            console.error(`Erro no proxy para ${radioId}:`, err.message);
            if (!res.headersSent) {
                res.status(500).send('Erro ao retransmitir o stream.');
            }
        });

    } catch (error) {
        console.error(`Erro ao iniciar proxy para ${radioId}:`, error.message);
        if (!res.headersSent) {
            res.status(500).send('Erro ao conectar com a fonte do stream.');
        }
    }
});


// ===== FUNÇÃO: Gerar URL segura para Google Drive =====
function gerarUrlGoogleDrive(fileId) {
    return `https://docs.google.com/uc?export=download&id=${fileId}`;
}

// ===== FUNÇÃO: Selecionar mensagem aleatória =====
function selecionarMensagemAleatoria() {
    if (mensagensCache.length === 0) {
        console.warn('⚠️ Nenhuma mensagem disponível no cache.');
        return null;
    }
    const randomIndex = Math.floor(Math.random() * mensagensCache.length);
    return mensagensCache[randomIndex];
}

// ===== FUNÇÃO: Tocar mensagem e agendar retorno =====
function tocarMensagem(mensagem, duracao) {
    if (!mensagem) {
        console.warn('⚠️ Tentativa de tocar mensagem nula.');
        return;
    }

    isPlayingMessage = true;
    const urlMensagem = gerarUrlGoogleDrive(mensagem.id);

    console.log(`▶️ Tocando mensagem: ${mensagem.name} (${duracao}s)`);

    io.emit('play-mensagem', {
        arquivo: urlMensagem,
        duracao: duracao,
        nome: mensagem.name
    });

    // Limpar timeout anterior se existir
    if (messageTimeout) clearTimeout(messageTimeout);

    // Agendar retorno para a programação normal
    messageTimeout = setTimeout(() => {
        console.log(`⏹️ Mensagem finalizada, retornando para a programação normal`);
        isPlayingMessage = false;
        playStreamPorHorario(); // Chama a função para retomar o stream principal
    }, duracao * 1000);
}

// ===== AGENDAMENTOS DE MENSAGENS =====
// Horários diários
cron.schedule('0 10 * * *', () => { console.log('📢 [10h] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('40 12 * * *', () => { console.log('📢 [12h40] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('52 13 * * *', () => { console.log('📢 [13h52] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('30 14 * * *', () => { console.log('📢 [14h30] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('50 15 * * *', () => { console.log('📢 [15h50] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('20 16 * * *', () => { console.log('📢 [16h20] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('13 17 * * *', () => { console.log('📢 [17h13] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('55 18 * * *', () => { console.log('📢 [18h55] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('0 20 * * *', () => { console.log('📢 [20h] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });
cron.schedule('50 23 * * *', () => { console.log('📢 [23h50] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); });

// ===== MENSAGENS NA MADRUGADA (00h10-03h00, a cada 15 minutos) =====
cron.schedule('10,25,40,55 0 * * *', () => { if (!isPlayingMessage) { console.log('📢 [Madrugada 00h] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); } });
cron.schedule('10,25,40,55 1 * * *', () => { if (!isPlayingMessage) { console.log('📢 [Madrugada 01h] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); } });
cron.schedule('10,25,40,55 2 * * *', () => { if (!isPlayingMessage) { console.log('📢 [Madrugada 02h] Mensagem'); tocarMensagem(selecionarMensagemAleatoria(), 60); } });

// ===== PROGRAMAÇÃO AUTOMÁTICA DE STREAMS =====
function playStreamPorHorario() {
    if (isPlayingMessage) {
        console.log('⏭️ Ignorando mudança de stream (tocando mensagem)');
        return;
    }

    const agora = new Date();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    const dia = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][agora.getDay()];

    let url = '';
    let descricao = '';

    // Domingo 8h30-9h45: Missa Rádio Marabá
    if (dia === 'domingo' && ((hora === 8 && minuto >= 30) || (hora === 9 && minuto < 45))) {
        url = '/proxy-stream/maraba'; // AGORA VIA PROXY
        descricao = '⛪ Santa Missa Dominical - Rádio Marabá';
    }
    // Sábado 12h50-13h05: Voz do Pastor (Marabá)
    else if (dia === 'sabado' && ((hora === 12 && minuto >= 50) || (hora === 13 && minuto <= 5))) {
        url = '/proxy-stream/maraba'; // AGORA VIA PROXY
        descricao = '📻 Voz do Pastor - Rádio Marabá';
    }
    // Sábado 19h00-20h30: Missa Rádio Ametista FM (aguardando link)
    else if (dia === 'sabado' && ((hora === 19 && minuto >= 0) || (hora === 20 && minuto < 30))) {
        url = '/proxy-stream/ametista-fm'; // Placeholder - será atualizado com o link real
        descricao = '🙏 Santa Missa de Sábado - Rádio Ametista FM';
    }
    // Música Clássica: 00h10-03h00
    else if ((hora === 0 && minuto >= 10) || (hora === 1) || (hora === 2) || (hora === 3 && minuto < 0)) {
        url = '/proxy-stream/classica';
        descricao = '🎼 Madrugada Clássica Erudita';
    }
    // Restante do tempo: Rádio Voz do Coração Imaculado
    else {
        url = '/proxy-stream/vozimaculado'; // AGORA VIA PROXY
        descricao = '🎵 Rádio Voz do Coração Imaculado';
    }

    // Só emite se o stream mudou
    if (currentPlayingStream.url !== url || currentPlayingStream.description !== descricao) {
        currentPlayingStream = { url, description: descricao };
        io.emit('play-stream', currentPlayingStream);
        console.log(`▶️ Stream: ${descricao} (URL: ${url})`);
    }
}

// Verificar stream a cada 30 segundos
cron.schedule('*/30 * * * * *', playStreamPorHorario);

// Iniciar ao ligar
setTimeout(() => {
    console.log('🎵 Iniciando programação...');
    playStreamPorHorario();
}, 2000);

// ===== ROTAS DE TESTE =====
app.get('/teste-stream/:tipo', (req, res) => {
    const tipo = req.params.tipo;
    let url = '';
    let descricao = '';

    if (tipo === 'maraba') {
        url = '/proxy-stream/maraba';
        descricao = 'Rádio Marabá';
    } else if (tipo === 'vozimaculado') {
        url = '/proxy-stream/vozimaculado';
        descricao = 'Rádio Voz do Coração Imaculado';
    } else if (tipo === 'classica') {
        url = '/proxy-stream/classica';
        descricao = 'Música Clássica';
    } else if (tipo === 'ametista-fm') {
        url = '/proxy-stream/ametista-fm';
        descricao = 'Rádio Ametista FM';
    } else {
        return res.status(400).send('Tipo inválido');
    }

    currentPlayingStream = { url, description: descricao };
    io.emit('play-stream', currentPlayingStream);
    res.send(`▶️ Testando: ${descricao}`);
});

app.get('/teste-mensagem', (req, res) => {
    const msg = selecionarMensagemAleatoria();
    if (msg) {
        tocarMensagem(msg, 60);
        res.send(`✅ Mensagem: ${msg.name}`);
    } else {
        res.send('⚠️ Nenhuma mensagem disponível');
    }
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║  🎙️  WebRádio Paróquia NSA                       ║
║  ✅ Servidor ativo na porta ${PORT}                 ║
║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║
║  📊 Mensagens carregadas: ${mensagensCache.length}         ║
║  🎵 Rádio Principal: Voz do Coração Imaculado    ║
║  🎼 Clássica: 00h10-03h00 (msgs a cada 15min)   ║
║  ⛪ Domingo: Missa Marabá 8h30-9h45             ║
║  📻 Sábado: Voz do Pastor 12h50-13h05           ║
║  🙏 Sábado: Missa Ametista 19h00-20h30          ║
║  ⏰ Mensagens diárias: 10h, 12h40, 13h52...     ║
╚════════════════════════════════════════════════════╝
    `);
});
