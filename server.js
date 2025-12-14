const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const axios = require('axios');
const cors = require('cors'); // Importar o módulo CORS

const app = express();

// ===== CONFIGURAÇÃO DO CORS PARA O SOCKET.IO E ROTAS =====
// Permitir acesso do seu domínio (e outros que você queira)
const allowedOrigins = [
    'https://www.paroquiaauxiliadorairai.com.br', // Seu site
    'https://webradio-paroquia.onrender.com', // Onde o servidor está rodando
    'http://localhost:3000' // Para testes locais, se necessário
];

app.use(cors({
    origin: function (origin, callback) {
        // Permitir requisições sem 'origin' (como mobile apps ou curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    }
}));

// Configuração do CORS para o Socket.IO
const io = socketIo(http.createServer(app), {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

const server = http.createServer(app); // O servidor HTTP agora é criado aqui
// const io = socketIo(server); // Esta linha foi movida para cima e modificada
const PORT = process.env.PORT || 3000;

// ===== CONFIGURAÇÃO DO GOOGLE DRIVE =====
const GOOGLE_DRIVE_FOLDER_ID = '1fxtCinZOfb74rWma-nSI_IUNgCSvrUS2';
// ========================================

app.use(express.static('public'));

// ===== PROXY PARA STREAMS =====
app.get('/proxy-stream/:tipo', (req, res) => {
    const tipo = req.params.tipo;
    let streamUrl = '';

    if (tipo === 'vozimaculado') {
        streamUrl = 'http://r13.ciclano.io:9033/live';
    } else if (tipo === 'maraba') {
        streamUrl = 'https://streaming.speedrs.com.br/radio/8010/maraba';
    } else if (tipo === 'classica') {
        streamUrl = 'https://livestreaming-node-2.srg-ssr.ch/srgssr/rsc_de/mp3/128';
    }

    if (!streamUrl) {
        return res.status(400).send('Stream inválido');
    }

    const https = require('https');
    const httpModule = require('http');
    const protocol = streamUrl.startsWith('https') ? https : httpModule;

    protocol.get(streamUrl, (stream) => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Access-Control-Allow-Origin', '*'); // Já estava aqui, mas é bom manter
        stream.pipe(res);
    }).on('error', (err) => {
        console.error('Erro no proxy:', err);
        res.status(500).send('Erro no proxy');
    });
});

// ===== PROXY PARA MENSAGENS (Google Drive) =====
app.get('/proxy-mensagem/:fileId', (req, res) => {
    const fileId = req.params.fileId;

    // URL que força o download direto do Google Drive
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;

    console.log(`📥 Baixando mensagem: ${fileId}`);

    axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        headers: {
            'User-Agent': 'Mozilla/5.0'
        }
    }).then(response => {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Access-Control-Allow-Origin', '*'); // Já estava aqui, mas é bom manter
        response.data.pipe(res);
    }).catch(err => {
        console.error('❌ Erro ao baixar mensagem:', err.message);
        res.status(500).send('Erro ao baixar mensagem');
    });
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// ===== WEBSOCKET =====
io.on('connection', (socket) => {
    console.log('✅ Ouvinte conectado');
    io.emit('ouvintes', { total: io.engine.clientsCount });

    socket.on('disconnect', () => {
        console.log('❌ Ouvinte desconectado');
        io.emit('ouvintes', { total: io.engine.clientsCount });
    });
});

// ===== LISTA DE MENSAGENS (GOOGLE DRIVE) =====
let listaMensagens = [
    "1Z4ZZ_QhM82ivnbWg7c7zofCkGE6HuqJu", // msg_010.mp3
    "1v10QzlGw4gGsJgWgsI6Gx7u0YHGzAmZH", // msg_009.mp3
    "1nEiDvQ5-8RXWIO8btpqVMvEzJnL7IwpP", // msg_008.mp3
    "11LSjJO3r_dKMls2YOrxzRvbchoM-Eoz3", // msg_007.mp3
    "1vxw4yR4NcBfs-DCvktOSzsi7zvhiUkWh", // msg_006.mp3
    "13LaeViIDUK-IwZCALw-5mV5sHTYoQkiZ", // msg_005.mp3
    "1gFFmjUUNoqkdIHMGc-cYxP9SX6Zpp8v4", // msg_004.mp3
    "1N49UV49UgOX8MaYmCO0EJwN2VB1Izp3S", // msg_003.mp3
    "1f1xLhQWdCdLNCyHHnaHgH6zihHIE4gcv", // msg_002.mp3
    "118tRazLR0sUIks4E43HH9ggOB_VMC7Pl", // msg_001.mp3
];

// ===== TOCAR MENSAGEM ALEATÓRIA =====
function tocarMensagemAleatoria() {
    if (listaMensagens.length === 0) {
        console.log('⚠️ Nenhuma mensagem disponível ainda');
        io.emit('aviso', { texto: 'Nenhuma mensagem cadastrada ainda' });
        return;
    }

    const escolhida = listaMensagens[Math.floor(Math.random() * listaMensagens.length)];

    console.log('🎙️ Tocando mensagem do Cônego Rafael');

    // Usa o proxy para evitar bloqueio do Google Drive
    const urlMensagem = `/proxy-mensagem/${escolhida}`;

    io.emit('play-mensagem', {
        arquivo: urlMensagem,
        duracao: 60
    });
}

// ===== HORÁRIOS FIXOS DAS MENSAGENS =====
// 10h
cron.schedule('0 10 * * *', () => {
    console.log('📢 [10h] Mensagem programada');
    tocarMensagemAleatoria();
});

// 12h40
cron.schedule('40 12 * * *', () => {
    console.log('📢 [12h40] Mensagem programada');
    tocarMensagemAleatoria();
});

// 13h52
cron.schedule('52 13 * * *', () => {
    console.log('📢 [13h52] Mensagem programada');
    tocarMensagemAleatoria();
});

// 14h30
cron.schedule('30 14 * * *', () => {
    console.log('📢 [14h30] Mensagem programada');
    tocarMensagemAleatoria();
});

// 15h50
cron.schedule('50 15 * * *', () => {
    console.log('📢 [15h50] Mensagem programada');
    tocarMensagemAleatoria();
});

// 16h20
cron.schedule('20 16 * * *', () => {
    console.log('📢 [16h20] Mensagem programada');
    tocarMensagemAleatoria();
});

// 17h13
cron.schedule('13 17 * * *', () => {
    console.log('📢 [17h13] Mensagem programada');
    tocarMensagemAleatoria();
});

// 18h55
cron.schedule('55 18 * * *', () => {
    console.log('📢 [18h55] Mensagem programada');
    tocarMensagemAleatoria();
});

// 20h
cron.schedule('0 20 * * *', () => {
    console.log('📢 [20h] Mensagem programada');
    tocarMensagemAleatoria();
});

// 23h50
cron.schedule('50 23 * * *', () => {
    console.log('📢 [23h50] Mensagem programada');
    tocarMensagemAleatoria();
});

// ===== PROGRAMAÇÃO AUTOMÁTICA =====
function playStreamPorHorario() {
    const agora = new Date();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    const dia = ['domingo','segunda','terca','quarta','quinta','sexta','sabado'][agora.getDay()];

    let url = '';
    let descricao = '';

    // Domingo 8h30-9h45: Missa Rádio Marabá
    if (dia === 'domingo' && ((hora === 8 && minuto >= 30) || (hora === 9 && minuto < 45))) {
        url = 'https://streaming.speedrs.com.br/radio/8010/maraba';
        descricao = '⛪ Santa Missa Dominical - Rádio Marabá';
    }
    // Sábado 12h50-13h05: Voz do Pastor
    else if (dia === 'sabado' && ((hora === 12 && minuto >= 50) || (hora === 13 && minuto <= 5))) {
        url = 'https://streaming.speedrs.com.br/radio/8010/maraba';
        descricao = '📻 Voz do Pastor - Rádio Marabá';
    }
    // Madrugada Clássica 01h-05h
    else if (hora >= 1 && hora < 5) { // Corrigido para 01h-05h
        url = 'https://livestreaming-node-2.srg-ssr.ch/srgssr/rsc_de/mp3/128';
        descricao = '🎼 Madrugada Clássica Erudita';
        // Agendar mensagens a cada 30 minutos na madrugada
        if (minuto % 30 === 0) {
            tocarMensagemAleatoria();
        }
    }
    // Restante: Voz do Coração Imaculado
    else {
        url = 'http://r13.ciclano.io:9033/live';
        descricao = '🎵 Rádio Voz do Coração Imaculado';
    }

    io.emit('play-stream', { url, descricao });
}

// Verificar stream a cada minuto
cron.schedule('* * * * *', playStreamPorHorario);

// Iniciar ao ligar
setTimeout(() => {
    console.log('🎵 Iniciando programação automática...');
    playStreamPorHorario();
}, 2000);

// ===== ROTAS DE TESTE =====
app.get('/teste-mensagem', (req, res) => {
    tocarMensagemAleatoria();
    res.send('✅ Mensagem disparada (60 segundos)');
});

app.get('/teste-stream/:tipo', (req, res) => {
    const tipo = req.params.tipo;
    let url = '';
    let descricao = '';

    if (tipo === 'maraba') {
        url = 'https://streaming.speedrs.com.br/radio/8010/maraba';
        descricao = 'Rádio Marabá';
    } else if (tipo === 'vozimaculado') {
        url = 'http://r13.ciclano.io:9033/live';
        descricao = 'Rádio Voz do Coração Imaculado';
    } else if (tipo === 'classica') {
        url = 'https://livestreaming-node-2.srg-ssr.ch/srgssr/rsc_de/mp3/128';
        descricao = 'Música Clássica';
    }

    io.emit('play-stream', { url, descricao });
    res.send(`▶️ Testando: ${descricao}`);
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║  🎙️  WebRádio Paróquia NSA                       ║
║  ✅ Servidor ativo na porta ${PORT}                 ║
║  📂 Google Drive ID: ${GOOGLE_DRIVE_FOLDER_ID}     ║
║  ⏰ Mensagens: 10h, 12h40, 13h52, 14h30,         ║
║              15h50, 16h20, 17h13, 18h55,         ║
║              20h, 23h50                          ║
║  🌙 Madrugada (01h-05h): Mensagens a cada 30min  ║
╚════════════════════════════════════════════════════╝
    `);
});
