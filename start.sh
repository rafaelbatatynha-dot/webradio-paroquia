#!/bin/bash

echo "🚀 Iniciando Icecast + Nginx + Web Radio..."

# Substitui variáveis de ambiente no icecast.xml
envsubst < /app/icecast.xml.template > /etc/icecast2/icecast.xml

# Inicia Icecast
echo "📡 Iniciando Icecast..."
icecast2 -c /etc/icecast2/icecast.xml &
ICECAST_PID=$!

sleep 5

if ! ps -p $ICECAST_PID > /dev/null; then
    echo "❌ Erro: Icecast não iniciou"
    cat /var/log/icecast2/error.log 2>/dev/null || echo "Sem logs"
    exit 1
fi

echo "✅ Icecast rodando (PID: $ICECAST_PID)"

# Inicia Nginx
echo "🌐 Iniciando Nginx..."
nginx -c /app/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

sleep 3

echo "✅ Nginx rodando (PID: $NGINX_PID)"

# Inicia servidor Node.js
echo "🎵 Iniciando servidor web da rádio..."
cd /app
node server.js &
NODE_PID=$!

echo "✅ Servidor Node.js rodando (PID: $NODE_PID)"

# Monitora processos
while true; do
    if ! ps -p $ICECAST_PID > /dev/null; then
        echo "⚠️ Icecast parou! Reiniciando..."
        icecast2 -c /etc/icecast2/icecast.xml &
        ICECAST_PID=$!
    fi

    if ! ps -p $NGINX_PID > /dev/null; then
        echo "⚠️ Nginx parou! Reiniciando..."
        nginx -c /app/nginx.conf -g 'daemon off;' &
        NGINX_PID=$!
    fi

    if ! ps -p $NODE_PID > /dev/null; then
        echo "⚠️ Node.js parou! Reiniciando..."
        node server.js &
        NODE_PID=$!
    fi

    sleep 30
done
