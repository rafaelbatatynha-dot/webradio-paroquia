const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

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
const PORT = process.env.PORT || 3000;
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
    'ametista': { // Nova entrada para a Rádio Ametista FM
        url: 'https://www.radios.com.br/aovivo/radio-ametista-885-fm/16128',
        description: 'Ametista FM'
    }
};

// ===== VARIÁVEIS GLOBAIS =====
let currentStream = STREAMS.imaculado;
let messages = []; // Cache de mensagens em RAM
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

        // Emite para todos os clientes
        io.emit('play-mensagem', {
            name: message.name,
            url: message.url
        });

        // Aguarda a duração estimada da mensagem (ajuste conforme necessário)
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 segundos por mensagem
    }

    console.log('⏹️ Bloco de mensagens finalizado.');
    isPlayingMessage = false;

    // Retoma o stream principal
    io.emit('stop-mensagem');
    io.emit('play-stream', {
        url: currentStream.url,
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

    // Aguarda 30 segundos para a mensagem tocar
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Retoma o stream
    io.emit('stop-mensagem');
    io.emit('play-stream', {
        url: currentStream.url,
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
            url: currentStream.url,
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
            url: currentStream.url,
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
            url: currentStream.url,
            description: currentStream.description
        });
    });

    // Domingo 08:30 - Missa Marabá
    cron.schedule('30 8 * * 0', () => {
        console.log('⛪ Domingo 08:30 - Iniciando Missa Marabá');
        currentStream = STREAMS.maraba;
        io.emit('play-stream', {
            url: currentStream.url,
            description: 'Missa Marabá'
        });
    });

    // Domingo 09:45 - Retorna para Imaculado
    cron.schedule('45 9 * * 0', () => {
        console.log('📻 Domingo 09:45 - Retornando para Voz do Coração Imaculado');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', {
            url: currentStream.url,
            description: currentStream.description
        });
    });

    // Sábado 12:50 - Voz do Pastor
    cron.schedule('50 12 * * 6', () => {
        console.log('🎤 Sábado 12:50 - Iniciando Voz do Pastor');
        currentStream = STREAMS.maraba;
        io.emit('play-stream', {
            url: currentStream.url,
            description: 'Voz do Pastor'
        });
    });

    // Sábado 13:05 - Retorna para Imaculado
    cron.schedule('5 13 * * 6', () => {
        console.log('📻 Sábado 13:05 - Retornando para Voz do Coração Imaculado');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', {
            url: currentStream.url,
            description: currentStream.description
        });
    });

    // Sábado 19:00 - Missa Ametista (usando a nova entrada 'ametista')
    cron.schedule('0 19 * * 6', () => {
        console.log('⛪ Sábado 19:00 - Iniciando Missa Ametista');
        currentStream = STREAMS.ametista; // Usando a nova entrada 'ametista'
        io.emit('play-stream', {
            url: currentStream.url,
            description: 'Missa Ametista'
        });
    });

    // Sábado 20:30 - Retorna para Imaculado
    cron.schedule('30 20 * * 6', () => {
        console.log('📻 Sábado 20:30 - Retornando para Voz do Coração Imaculado');
        currentStream = STREAMS.imaculado;
        io.emit('play-stream', {
            url: currentStream.url,
            description: currentStream.description
        });
    });

    console.log('✅ Agendamento configurado com sucesso');
}

// ===== ROTA PARA STREAM =====
app.get('/stream', (req, res) => {
    res.redirect(currentStream.url);
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
    console.log(`✅ Cliente conectado: ${socket.id}`);
    clients.push(socket.id);

    // Emite o stream atual ao conectar
    socket.emit('play-stream', {
        url: currentStream.url,
        description: currentStream.description
    });

    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
        clients = clients.filter(id => id !== socket.id);
    });

    socket.on('get-current-stream', () => {
        socket.emit('play-stream', {
            url: currentStream.url,
            description: currentStream.description
        });
    });
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====
async function startServer() {
    try {
        // Inicializa Google Drive
        await initializeGoogleDrive();

        // Configura agendamento
        setupSchedule();

        // Inicia o servidor
        server.listen(PORT, () => {
            console.log(`\n╔═════════════════════════════════════════════════════╗`);
            console.log(`║                                                     ║`);
            console.log(`║  📡 Servidor iniciado com sucesso na porta ${PORT}  ║`);
            console.log(`║  📂 Google Drive: ${GOOGLE_DRIVE_FOLDER_ID}        ║`);
            console.log(`║  📊 Mensagens carregadas: ${messages.length}  ║`);
            console.log(`║  📻 Stream principal: ${currentStream.description}  ║`);
            console.log(`║  🎼 Clássica: 00h10-05h00 (msgs a cada 30min)       ║`);
            console.log(`║  ⛪ Domingo: Missa Marabá 8h30-9h45                 ║`);
            console.log(`║  📻 Sábado: Missa Ametista 19h00-20h30              ║`);
            console.log(`║  📻 Sábado: Voz do Pastor 12h50-13h05               ║`);
            console.log(`║  ⏰ Bloco de Mensagens: 11h00-12h00 (TODOS OS DIAS) ║`);
            console.log(`║  🗣️ Mensagens noturnas: a cada 30 min (01-05h)     ║`);
            console.log(`║  🌐 URL: https://webradio-paroquia.onrender.com     ║`);
            console.log(`║                                                     ║`);
            console.log(`╚═════════════════════════════════════════════════════╝\n`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar servidor:', error.message);
        process.exit(1);
    }
}

startServer();
