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
const { spawn } = require('child_process');  // ✅ NOVO: para iniciar Icecast e Nginx

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
const PORT = process.env.PORT || 10000;  // ✅ CORRIGIDO: porta 10000 (não 3000)
const GOOGLE_DRIVE_FOLDER_ID = '1fxtCinZOfb74rWma-nSI_IUNgCSvrUS2';

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
    'ametista': {
        url: 'https://streaming.speedrs.com.br/radio/8010/maraba',
        description: 'Ametista FM'
    },
    'live': {  // ✅ CORRIGIDO: URL interna do Icecast
        url: 'http://localhost:8000/live',  // ✅ Icecast roda internamente na porta 8000
        description: 'AO VIVO - Missa'
    },
    'missa': {  // ✅ NOVO: mount point específico para a missa
        url: 'http://localhost:8000/missa',
        description: 'Missa de Sábado'
    }
};

// ===== VARIÁVEIS GLOBAIS =====
let currentStream = STREAMS.imaculado;
let messages = [];
let isPlayingMessage = false;
let messageTimeout = null;
let clients = [];
let icecastProcess = null;  // ✅ NOVO: processo do Icecast
let nginxProcess = null;    // ✅ NOVO: processo do Nginx

// ===== INICIAR ICECAST =====
function startIcecast() {
    try {
        console.log('📡 Iniciando Icecast...');

        // Substitui variáveis de ambiente no icecast.xml
        const icecastTemplate = fs.readFileSync('/app/icecast.xml.template', 'utf8');
        const icecastConfig = icecastTemplate
            .replace(/\${ICECAST_SOURCE_PASSWORD}/g, process.env.ICECAST_SOURCE_PASSWORD || 'webradio_source_2025')
            .replace(/\${ICECAST_RELAY_PASSWORD}/g, process.env.ICECAST_RELAY_PASSWORD || 'webradio_relay_2025')
            .replace(/\${ICECAST_ADMIN_PASSWORD}/g, process.env.ICECAST_ADMIN_PASSWORD || 'webradio_admin_2025')
            .replace(/\${ICECAST_HOSTNAME}/g, process.env.ICECAST_HOSTNAME || 'webradio-paroquia.onrender.com');

        fs.writeFileSync('/etc/icecast2/icecast.xml', icecastConfig);

        icecastProcess = spawn('icecast2', ['-c', '/etc/icecast2/icecast.xml'], {
            stdio: 'inherit'
        });

        icecastProcess.on('error', (err) => {
            console.error('❌ Erro ao iniciar Icecast:', err.message);
        });

        icecastProcess.on('exit', (code) => {
            console.log(`⚠️ Icecast encerrado com código ${code}`);
            // Reinicia automaticamente após 5 segundos
            setTimeout(startIcecast, 5000);
        });

        console.log('✅ Icecast iniciado com sucesso');
    } catch (error) {
        console.error('❌ Erro ao iniciar Icecast:', error.message);
    }
}

// ===== INICIAR NGINX =====
function startNginx() {
    try {
        console.log('🌐 Iniciando Nginx...');

        nginxProcess = spawn('nginx', ['-c', '/app/nginx.conf', '-g', 'daemon off;'], {
            stdio: 'inherit'
        });

        nginxProcess.on('error', (err) => {
            console.error('❌ Erro ao iniciar Nginx:', err.message);
        });

        nginxProcess.on('exit', (code) => {
            console.log(`⚠️ Nginx encerrado com código ${code}`);
            // Reinicia automaticamente após 5 segundos
            setTimeout(startNginx, 5000);
        });

        console.log('✅ Nginx iniciado com sucesso');
    } catch (error) {
        console.error('❌ Erro ao iniciar Nginx:', error.message);
    }
}

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
        await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 60 segundos por mensagem
    }
    console.log('⏹️ Bloco de mensagens finalizado.');
    isPlayingMessage = false;
    io.emit('stop-mensagem');
    io.emit('play-stream', {
        url: '/stream',
        description: currentStream.description
    });
}

// ===== FUNÇÃO PARA TOCAR MENSAGENS A CADA 30 MINUTOS (01:00 - 05:00) =====
async function playMessageEvery30Minutes() {
    if (messages.length === 0) return;
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    console.log(`📢 Tocando mensagem aleatória: ${randomMessage.name}`);
    io.emit('play-mensagem', {
        name: randomMessage.name,
        url: randomMessage.url
    });
    await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 60 segundos por mensagem
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
        io.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
    });

    // 01:00, 01:30, 02:00, 02:30, 03:00, 03:30, 04:00, 04:30 - Mensagens a cada 30 min
    cron.schedule('0,30 1-4 * * *', () => {
        if (!isPlayingMessage) {
            playMessageEvery30Minutes();
        }
    });

    // 05:00 - Retorna para Voz do Imaculado
    cron.schedule('0 5 * * *', () => {
        console.log('📻 05:00 - Retornando para Voz do Coração Imaculado');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
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
        io.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
    });

    // ✅ NOVO: Sábado 19:00 - Muda para stream da missa
    cron.schedule('0 19 * * 6', () => {
        console.log('⛪ 19:00 (Sábado) - Mudando para transmissão da Missa');
        currentStream = STREAMS.missa;
        io.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
    });

    // ✅ NOVO: Sábado 20:30 - Retorna para programação normal
    cron.schedule('30 20 * * 6', () => {
        console.log('📻 20:30 (Sábado) - Retornando para programação normal');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
    });

    console.log('✅ Agendamento configurado com sucesso');
}

// ===== ROTA PARA PROXY DO STREAM =====
app.get('/stream', (req, res) => {
    try {
        console.log(`🔗 Proxying stream: ${currentStream.url}`);
        const streamUrl = new URL(currentStream.url);
        const client = streamUrl.protocol === 'https:' ? https : http;

        const options = {
            hostname: streamUrl.hostname,
            port: streamUrl.port,
            path: streamUrl.pathname + streamUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
                if (!res.headersSent) {
                    res.status(500).send('Erro ao carregar stream');
                }
            });
        });

        request.on('error', (err) => {
            console.error('❌ Erro na requisição do stream:', err.message);
            if (!res.headersSent) {
                res.status(500).send('Erro ao carregar stream');
            }
        });

        request.on('timeout', () => {
            console.error('❌ Timeout ao conectar no stream');
            request.destroy();
            if (!res.headersSent) {
                res.status(504).send('Timeout ao carregar stream');
            }
        });

        request.end();
    } catch (error) {
        console.error('❌ Erro na rota /stream:', error.message);
        if (!res.headersSent) {
            res.status(500).send('Erro ao carregar stream');
        }
    }
});

// ✅ NOVO: Rota de health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        icecast: icecastProcess ? 'running' : 'stopped',
        nginx: nginxProcess ? 'running' : 'stopped',
        messages: messages.length,
        currentStream: currentStream.description
    });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
    console.log(`✅ Cliente conectado: ${socket.id}`);
    clients.push(socket.id);
    socket.emit('play-stream', {
        url: '/stream',
        description: currentStream.description
    });

    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
        clients = clients.filter(id => id !== socket.id);
    });

    socket.on('get-current-stream', () => {
        socket.emit('play-stream', {
            url: '/stream',
            description: currentStream.description
        });
    });
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====
async function startServer() {
    try {
        // ✅ NOVO: Inicia Icecast e Nginx primeiro
        if (fs.existsSync('/app/icecast.xml.template')) {
            startIcecast();
            await new Promise(resolve => setTimeout(resolve, 5000)); // Aguarda 5s
        }

        if (fs.existsSync('/app/nginx.conf')) {
            startNginx();
            await new Promise(resolve => setTimeout(resolve, 3000)); // Aguarda 3s
        }

        await initializeGoogleDrive();
        setupSchedule();

        server.listen(PORT, () => {
            console.log(`\n╔═════════════════════════════════════════════════════╗`);
            console.log(`║                                                     ║`);
            console.log(`║  📡 Servidor iniciado com sucesso na porta ${PORT}  ║`);
            console.log(`║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║`);
            console.log(`║  📊 Mensagens carregadas: ${messages.length}  ║`);
            console.log(`║  📻 Stream principal: ${currentStream.description}  ║`);
            console.log(`║  🎼 Clássica: 00h10-05h00 (msgs a cada 30min)       ║`);
            console.log(`║  ⏰ Bloco de Mensagens: 11h00-12h00 (TODOS OS DIAS) ║`);
            console.log(`║  🗣️ Mensagens noturnas: a cada 30 min (01-05h)     ║`);
            console.log(`║  ⛪ Missa: Sábado 19h00-20h30                       ║`);
            console.log(`║  🎙️ Icecast: ${icecastProcess ? 'Ativo' : 'Inativo'}                              ║`);
            console.log(`║  🌐 URL: https://webradio-paroquia.onrender.com     ║`);
            console.log(`║                                                     ║`);
            console.log(`╚═════════════════════════════════════════════════════╝\n`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error.message);
        process.exit(1);
    }
}

// ✅ NOVO: Encerra processos ao fechar o servidor
process.on('SIGTERM', () => {
    console.log('⚠️ Encerrando servidor...');
    if (icecastProcess) icecastProcess.kill();
    if (nginxProcess) nginxProcess.kill();
    process.exit(0);
});

startServer();
