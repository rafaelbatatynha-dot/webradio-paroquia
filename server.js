const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { spawn, exec } = require('child_process');
const ytdl = require('ytdl-core');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static('public'));

// ===== CONFIGURAÇÃO =====
const PORT = process.env.PORT || 10000;
const GOOGLE_DRIVE_FOLDER_ID = '1fxtCinZOfb74rWma-nSI_IUNgCSvrUS2';

// ⚠️ IMPORTANTE: Atualize o ID do vídeo do YouTube quando criar a transmissão
const YOUTUBE_MISSA_VIDEO_ID = 'SEU_VIDEO_ID_AQUI';  // ✅ TROQUE PELO ID REAL

// Streams de rádio
const STREAMS = {
    'maraba': {
        url: 'https://streaming.speedrs.com.br/radio/8010/maraba',
        description: 'Marabá'
    },
    'imaculado': {
        url: 'http://r13.ciclano.io:9033/live',
        description: 'Voz do Coração Imaculado'
    },
    'classica': {
        url: 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128',
        description: 'Clássica'
    },
    'missa': {
        url: `https://www.youtube.com/watch?v=${YOUTUBE_MISSA_VIDEO_ID}`,
        description: 'Missa de Sábado'
    }
};

// ===== VARIÁVEIS GLOBAIS =====
let currentStream = STREAMS.imaculado;
let messages = [];
let messagesCache = new Map(); // Cache em RAM
let isPlayingMessage = false;
let messageTimeout = null;
let clients = [];

// ===== AUTENTICAÇÃO GOOGLE DRIVE =====
async function authenticateGoogleDrive() {
    try {
        const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
        if (!credentialsJson) {
            throw new Error('Variável de ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON não encontrada.');
        }
        const credentials = JSON.parse(credentialsJson);
        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        console.log('✅ Credenciais do Google Drive carregadas da variável de ambiente.');
        return auth;
    } catch (error) {
        console.error('❌ Erro ao autenticar Google Drive:', error.message);
        throw error;
    }
}

// ===== CARREGAR MENSAGENS DO GOOGLE DRIVE =====
async function loadMessagesFromGoogleDrive(auth) {
    try {
        const drive = google.drive({ version: 'v3', auth });
        const response = await drive.files.list({
            q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType contains 'audio'`,
            spaces: 'drive',
            fields: 'files(id, name, mimeType)',
            pageSize: 1000
        });
        const files = response.data.files || [];
        messages = files.map(file => ({
            id: file.id,
            name: file.name,
            url: `https://drive.google.com/uc?id=${file.id}&export=download`
        }));
        console.log(`✅ ${messages.length} arquivos de mensagem carregados do Google Drive.`);
        return messages;
    } catch (error) {
        console.error('❌ Erro ao carregar mensagens do Google Drive:', error.message);
        return [];
    }
}

// ===== INICIALIZAR GOOGLE DRIVE =====
async function initializeGoogleDrive() {
    try {
        const auth = await authenticateGoogleDrive();
        console.log('✅ Autenticação com Google Drive bem-sucedida.');
        await loadMessagesFromGoogleDrive(auth);
        console.log(`🔄 Buscando arquivos de mensagem na pasta do Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}`);
        return auth;
    } catch (error) {
        console.error('❌ Erro ao inicializar Google Drive:', error.message);
        process.exit(1);
    }
}

// ===== FUNÇÃO PARA TOCAR MENSAGENS SEQUENCIALMENTE =====
async function playSequentialMessages() {
    if (messages.length === 0) {
        console.log('⚠️ Nenhuma mensagem disponível para tocar.');
        return;
    }
    isPlayingMessage = true;
    console.log(`📢 Iniciando bloco de ${messages.length} mensagens...`);
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        console.log(`📢 Tocando mensagem ${i + 1}/${messages.length}: ${message.name}`);
        io.emit('play-mensagem', {
            name: message.name,
            url: message.url
        });
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    }
    console.log('⏹️ Bloco de mensagens finalizado.');
    isPlayingMessage = false;
    io.emit('stop-mensagem');
    io.emit('play-stream', {
        url: '/stream',
        description: currentStream.description
    });
}

// ===== FUNÇÃO PARA TOCAR MENSAGENS A CADA 30 MINUTOS =====
async function playMessageEvery30Minutes() {
    if (messages.length === 0) return;
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    console.log(`📢 Tocando mensagem aleatória: ${randomMessage.name}`);
    io.emit('play-mensagem', {
        name: randomMessage.name,
        url: randomMessage.url
    });
    await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    io.emit('stop-mensagem');
    io.emit('play-stream', {
        url: '/stream',
        description: currentStream.description
    });
}

// ===== AGENDAMENTO COM CRON =====
function setupSchedule() {
    console.log('⏰ Configurando agendamento de programação...');

    // 00:10 - Muda para música clássica
    cron.schedule('10 0 * * *', () => {
        console.log('🎼 00:10 - Mudando para Clássica');
        currentStream = STREAMS.classica;
        io.emit('play-stream', { url: '/stream', description: currentStream.description });
    });

    // 01:00-05:00 - Mensagens a cada 30 min
    cron.schedule('0,30 1-4 * * *', () => {
        if (!isPlayingMessage) playMessageEvery30Minutes();
    });

    // 05:00 - Retorna para Voz do Imaculado
    cron.schedule('0 5 * * *', () => {
        console.log('📻 05:00 - Retornando para Voz do Coração Imaculado');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', { url: '/stream', description: currentStream.description });
    });

    // 11:00 - Inicia bloco de mensagens diárias
    cron.schedule('0 11 * * *', () => {
        console.log('📢 11:00 - Iniciando bloco de mensagens diárias');
        playSequentialMessages();
    });

    // 12:00 - Retorna para stream principal
    cron.schedule('0 12 * * *', () => {
        console.log('📻 12:00 - Retornando para stream principal');
        isPlayingMessage = false;
        currentStream = STREAMS.imaculado;
        io.emit('stop-mensagem');
        io.emit('play-stream', { url: '/stream', description: currentStream.description });
    });

    // Sábado 19:00 - Muda para transmissão da missa (YouTube)
    cron.schedule('0 19 * * 6', () => {
        console.log('⛪ 19:00 (Sábado) - Mudando para transmissão da Missa (YouTube)');
        currentStream = STREAMS.missa;
        io.emit('play-stream', { url: '/stream', description: currentStream.description });
    });

    // Sábado 20:30 - Retorna para programação normal
    cron.schedule('30 20 * * 6', () => {
        console.log('📻 20:30 (Sábado) - Retornando para programação normal');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', { url: '/stream', description: currentStream.description });
    });

    console.log('✅ Agendamento configurado com sucesso');
}

// ===== ROTA PARA PROXY DO STREAM (COM SUPORTE A YOUTUBE) =====
app.get('/stream', async (req, res) => {
    try {
        const streamUrl = currentStream.url;

        // ✅ DETECTA SE É LINK DO YOUTUBE
        if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
            console.log("🎥 Extraindo áudio do YouTube:", streamUrl);

            try {
                // Verifica se o vídeo existe e está disponível
                const info = await ytdl.getInfo(streamUrl);
                console.log(`✅ Vídeo encontrado: ${info.videoDetails.title}`);

                const audioStream = ytdl(streamUrl, {
                    filter: 'audioonly',
                    quality: 'highestaudio',
                    highWaterMark: 1 << 25 // Buffer maior para evitar travamentos
                });

                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Transfer-Encoding', 'chunked');

                // Verifica se FFmpeg está disponível
                exec('which ffmpeg', (error, stdout) => {
                    if (error) {
                        console.warn('⚠️ FFmpeg não encontrado, enviando áudio direto');
                        audioStream.pipe(res);
                        return;
                    }

                    // Converte o áudio para MP3 com FFmpeg
                    const ffmpeg = spawn('ffmpeg', [
                        '-i', 'pipe:0',
                        '-f', 'mp3',
                        '-codec:a', 'libmp3lame',
                        '-b:a', '128k',
                        '-ar', '44100',
                        '-ac', '2',
                        '-content_type', 'audio/mpeg',
                        'pipe:1'
                    ]);

                    audioStream.pipe(ffmpeg.stdin);
                    ffmpeg.stdout.pipe(res);

                    ffmpeg.stderr.on('data', (data) => {
                        // Log silencioso do FFmpeg (apenas para debug)
                    });

                    ffmpeg.on('error', (err) => {
                        console.error("❌ Erro FFmpeg:", err.message);
                        if (!res.headersSent) {
                            res.status(500).send('Erro ao processar áudio do YouTube');
                        }
                    });

                    audioStream.on('error', (err) => {
                        console.error("❌ Erro ytdl-core:", err.message);
                        ffmpeg.kill();
                        if (!res.headersSent) {
                            res.status(500).send('Erro ao extrair áudio do YouTube');
                        }
                    });

                    res.on('close', () => {
                        console.log('🔌 Cliente desconectou do stream YouTube');
                        ffmpeg.kill();
                    });
                });

                return;
            } catch (ytError) {
                console.error("❌ Erro ao processar YouTube:", ytError.message);

                // Se o vídeo não estiver disponível, volta para programação normal
                if (ytError.message.includes('unavailable') || ytError.message.includes('private')) {
                    console.log('⚠️ Vídeo indisponível, retornando para programação normal');
                    currentStream = STREAMS.imaculado;
                    io.emit('play-stream', { url: '/stream', description: currentStream.description });
                }

                if (!res.headersSent) {
                    res.status(500).send('Erro ao carregar stream do YouTube');
                }
                return;
            }
        }

        // ✅ PROXY NORMAL PARA OUTRAS RÁDIOS (Marabá, Imaculado, Clássica)
        console.log(`🔗 Proxying stream: ${streamUrl}`);
        const streamUrlObj = new URL(streamUrl);
        const client = streamUrlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: streamUrlObj.hostname,
            port: streamUrlObj.port,
            path: streamUrlObj.pathname + streamUrlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Icy-MetaData': '0'
            },
            timeout: 15000
        };

        const request = client.request(options, (streamRes) => {
            res.writeHead(streamRes.statusCode, {
                'Content-Type': streamRes.headers['content-type'] || 'audio/mpeg',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Transfer-Encoding': 'chunked'
            });
            streamRes.pipe(res);
            streamRes.on('error', (err) => {
                console.error('❌ Erro ao receber stream:', err.message);
                if (!res.headersSent) res.status(500).send('Erro ao carregar stream');
            });
        });

        request.on('error', (err) => {
            console.error('❌ Erro na requisição do stream:', err.message);
            if (!res.headersSent) res.status(500).send('Erro ao carregar stream');
        });

        request.on('timeout', () => {
            console.error('❌ Timeout ao conectar no stream');
            request.destroy();
            if (!res.headersSent) res.status(504).send('Timeout ao carregar stream');
        });

        request.end();
    } catch (error) {
        console.error('❌ Erro na rota /stream:', error.message);
        if (!res.headersSent) res.status(500).send('Erro ao carregar stream');
    }
});

// ===== ROTA DE HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        messages: messages.length,
        currentStream: currentStream.description,
        youtubeVideoId: YOUTUBE_MISSA_VIDEO_ID,
        timestamp: new Date().toISOString()
    });
});

// ===== ROTA PARA LISTAR MENSAGENS =====
app.get('/api/messages', (req, res) => {
    res.json({
        total: messages.length,
        messages: messages
    });
});

// ===== ROTA PARA ATUALIZAR ID DO YOUTUBE =====
app.post('/api/update-youtube-id', express.json(), (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
        return res.status(400).json({ error: 'videoId é obrigatório' });
    }
    YOUTUBE_MISSA_VIDEO_ID = videoId;
    STREAMS.missa.url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`✅ ID do YouTube atualizado: ${videoId}`);
    res.json({ success: true, videoId });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
    console.log(`✅ Cliente conectado: ${socket.id}`);
    clients.push(socket.id);
    socket.emit('play-stream', { url: '/stream', description: currentStream.description });

    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
        clients = clients.filter(id => id !== socket.id);
    });

    socket.on('get-current-stream', () => {
        socket.emit('play-stream', { url: '/stream', description: currentStream.description });
    });
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====
async function startServer() {
    try {
        await initializeGoogleDrive();
        setupSchedule();

        server.listen(3000, () => {
            console.log(`\n╔═════════════════════════════════════════════════════╗`);
            console.log(`║                                                     ║`);
            console.log(`║  📡 Servidor iniciado com sucesso na porta ${PORT}  ║`);
            console.log(`║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║`);
            console.log(`║  📊 Mensagens carregadas: ${messages.length}  ║`);
            console.log(`║  📻 Stream principal: ${currentStream.description}  ║`);
            console.log(`║  🎼 Clássica: 00h10-05h00 (msgs a cada 30min)       ║`);
            console.log(`║  ⏰ Bloco de Mensagens: 11h00-12h00 (TODOS OS DIAS) ║`);
            console.log(`║  🗣️ Mensagens noturnas: a cada 30 min (01-05h)     ║`);
            console.log(`║  ⛪ Missa: Sábado 19h00-20h30 (via YouTube)        ║`);
            console.log(`║  🎥 YouTube Video ID: ${YOUTUBE_MISSA_VIDEO_ID}    ║`);
            console.log(`║  🌐 URL: https://webradio-paroquia.onrender.com     ║`);
            console.log(`║                                                     ║`);
            console.log(`╚═════════════════════════════════════════════════════╝\n`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error.message);
        process.exit(1);
    }
}

process.on('SIGTERM', () => {
    console.log('⚠️ Encerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('⚠️ Encerrando servidor...');
    process.exit(0);
});

startServer();
