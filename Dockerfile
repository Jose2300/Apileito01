# Etapa 1: Construir a aplicação
FROM node:20.17.0 AS build

# Define o diretório de trabalho
WORKDIR /app

# Copia o package.json e package-lock.json (ou yarn.lock) para o diretório de trabalho
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código fonte para o diretório de trabalho
COPY . .

# Instala o TypeScript globalmente
RUN npm install -g typescript

# Compila o código TypeScript para JavaScript
RUN tsc

# Etapa 2: Criar a imagem de produção
FROM node:20.17.0

# Define o diretório de trabalho
WORKDIR /app

# Copia o package.json e package-lock.json (ou yarn.lock) para o diretório de trabalho
COPY package*.json ./

# Instala apenas as dependências de produção
RUN npm install --only=production

# Copia o código compilado da etapa de build
COPY --from=build /app/dist ./dist

# Copia os arquivos de configuração, se houver
COPY --from=build /app/arquivo.env ./

# Define a variável de ambiente para o Node.js
ENV NODE_ENV=production

# Expõe a porta que a aplicação vai usar
EXPOSE 3000

# Define o comando para iniciar a aplicação
CMD ["node", "dist/index.js"]
