FROM node:20-bullseye

# Instala Icecast, Nginx e dependências
RUN apt-get update && apt-get install -y \
    icecast2 \
    nginx \
    curl \
    wget \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Cria diretórios necessários
RUN mkdir -p /app /cache /var/log/icecast2 /var/run/icecast2

# Define diretório de trabalho
WORKDIR /app

# Copia package.json e instala dependências Node.js
COPY package*.json ./
RUN npm install

# Copia todo o código do projeto
COPY . .

# Copia e configura start.sh
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expõe porta 10000
EXPOSE 10000

# Inicia os serviços
CMD ["/start.sh"]
