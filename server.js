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
            return callback(new Error('CORS not allowed'), false);
        }
        return callback(null, true);
    }
}));

app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

const server = http.createServer(app);

// ===== CONFIGURAÇÃO DO SOCKET.IO COM CORS =====
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// ===== CONFIGURAÇÃO DO GOOGLE DRIVE =====
const GOOGLE_DRIVE_FOLDER_ID = '1fxtCinZOfb74rWma-nSI_IUNgCSvrUS2';

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
        res.setHeader('Access-Control-Allow-Origin', '*');
        stream.pipe(res);
    }).on('error', (err) => {
        console.error('Erro no proxy:', err);
        res.status(500).send('Erro no proxy');
    });
});

// ===== PROXY PARA MENSAGENS (Google Drive) =====
app.get('/proxy-mensagem/:fileId', (req, res) => {
    const fileId = req.params.fileId;
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
        res.setHeader('Access-Control-Allow-Origin', '*');
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

// ===== LISTA DE MENSAGENS =====
let listaMensagens = [
    "1Z4ZZ_QhM82ivnbWg7c7zofCkGE6HuqJu",
    "1v10QzlGw4gGsJgWgsI6Gx7u0YHGzAmZH",
    "1nEiDvQ5-8RXWIO8btpqVMvEzJnL7IwpP",
    "11LSjJO3r_dKMls2YOrxzRvbchoM-Eoz3",
    "1vxw4yR4NcBfs-DCvktOSzsi7zvhiUkWh",
    "13LaeViIDUK-IwZCALw-5mV5sHTYoQkiZ",
    "1gFFmjUUNoqkdIHMGc-cYxP9SX6Zpp8v4",
    "1N49UV49UgOX8MaYmCO0EJwN2VB1Izp3S",
    "1f1xLhQWdCdLNCyHHnaHgH6zihHIE4gcv",
    "118tRazLR0sUIks4E43HH9ggOB_VMC7Pl",
];

// ===== TOCAR MENSAGEM ALEATÓRIA =====
function tocarMensagemAleatoria() {
    if (listaMensagens.length === 0) {
        console.log('⚠️ Nenhuma mensagem disponível');
        io.emit('aviso', { texto: 'Nenhuma mensagem cadastrada' });
        return;
    }

    const escolhida = listaMensagens[Math.floor(Math.random() * listaMensagens.length)];
    const urlMensagem = `/proxy-mensagem/${escolhida}`;

    console.log('🎙️ Tocando mensagem do Cônego Rafael');

    io.emit('play-mensagem', {
        arquivo: urlMensagem,
        duracao: 60
    });
}

// ===== HORÁRIOS FIXOS DAS MENSAGENS =====
cron.schedule('0 10 * * *', () => {
    console.log('📢 [10h] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('40 12 * * *', () => {
    console.log('📢 [12h40] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('52 13 * * *', () => {
    console.log('📢 [13h52] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('30 14 * * *', () => {
    console.log('📢 [14h30] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('50 15 * * *', () => {
    console.log('📢 [15h50] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('20 16 * * *', () => {
    console.log('📢 [16h20] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('13 17 * * *', () => {
    console.log('📢 [17h13] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('55 18 * * *', () => {
    console.log('📢 [18h55] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('0 20 * * *', () => {
    console.log('📢 [20h] Mensagem programada');
    tocarMensagemAleatoria();
});

cron.schedule('50 23 * * *', () => {
    console.log('📢 [23h50] Mensagem programada');
    tocarMensagemAleatoria();
});

// ===== MENSAGENS A CADA 30 MIN NA MADRUGADA (01h-05h) =====
cron.schedule('0,30 1-4 * * *', () => {
    console.log('📢 [Madrugada] Mensagem programada');
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

    // Domingo 8h30-9h45: Missa
    if (dia === 'domingo' && ((hora === 8 && minuto >= 30) || (hora === 9 && minuto < 45))) {
        url = 'https://streaming.speedrs.com.br/radio/8010/maraba';
        descricao = '⛪ Santa Missa Dominical';
    }
    // Sábado 12h50-13h05: Voz do Pastor
    else if (dia === 'sabado' && ((hora === 12 && minuto >= 50) || (hora === 13 && minuto <= 5))) {
        url = 'https://streaming.speedrs.com.br/radio/8010/maraba';
        descricao = '📻 Voz do Pastor';
    }
    // Madrugada Clássica 01h-05h
    else if (hora >= 1 && hora < 5) {
        url = 'https://livestreaming-node-2.srg-ssr.ch/srgssr/rsc_de/mp3/128';
        descricao = '🎼 Madrugada Clássica Erudita';
    }
    // Restante: Voz do Coração Imaculado
    else {
        url = 'http://r13.ciclano.io:9033/live';
        descricao = '🎵 Rádio Voz do Coração Imaculado';
    }

    io.emit('play-stream', { url, descricao });
}

cron.schedule('* * * * *', playStreamPorHorario);

setTimeout(() => {
    console.log('🎵 Iniciando programação automática...');
    playStreamPorHorario();
}, 2000);

// ===== ROTAS DE TESTE =====
app.get('/teste-mensagem', (req, res) => {
    tocarMensagemAleatoria();
    res.send('✅ Mensagem disparada');
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
