#!/bin/bash

echo "🚀 Iniciando Web Rádio Paróquia..."

# Substitui variáveis de ambiente no icecast.xml
if [ -f "/app/icecast.xml.template" ]; then
    echo "📡 Configurando Icecast..."
    envsubst < /app/icecast.xml.template > /etc/icecast2/icecast.xml
fi

# Inicia Icecast
if command -v icecast2 &> /dev/null; then
    echo "📡 Iniciando Icecast..."
    icecast2 -c /etc/icecast2/icecast.xml &
    ICECAST_PID=$!
    sleep 5

    if ps -p $ICECAST_PID > /dev/null; then
        echo "✅ Icecast rodando (PID: $ICECAST_PID)"
    else
        echo "⚠️ Icecast não iniciou, mas continuando..."
    fi
else
    echo "⚠️ Icecast não está instalado, pulando..."
fi

# Inicia Nginx
if command -v nginx &> /dev/null; then
    if [ -f "/app/nginx.conf" ]; then
        echo "🌐 Iniciando Nginx..."
        nginx -c /app/nginx.conf -g 'daemon off;' &
        NGINX_PID=$!
        sleep 3

        if ps -p $NGINX_PID > /dev/null; then
            echo "✅ Nginx rodando (PID: $NGINX_PID)"
        else
            echo "⚠️ Nginx não iniciou, mas continuando..."
        fi
    fi
else
    echo "⚠️ Nginx não está instalado, pulando..."
fi

# Inicia servidor Node.js
echo "🎵 Iniciando servidor Node.js..."
cd /app
exec node server.js
