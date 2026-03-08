# Transcriber2000

App de transcrição de áudio/vídeo usando React, Convex e Gemini AI.

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar Convex

```bash
npx convex dev
```

Isso vai:
- Pedir para você fazer login no Convex (cria uma conta gratuita)
- Criar um projeto no Convex
- Gerar o arquivo `.env.local` com a URL do Convex

### 3. Configurar API Key do Gemini

1. Obtenha sua API key em: https://aistudio.google.com/apikey
2. No terminal onde o Convex está rodando, configure a variável:

```bash
npx convex env set GEMINI_API_KEY "sua-api-key-aqui"
```

### 4. Rodar o projeto

Em um terminal, mantenha o Convex rodando:
```bash
npx convex dev
```

Em outro terminal, inicie o frontend:
```bash
npm run dev
```

Acesse: http://localhost:5173

## Deploy na Vercel

### 1. Criar repositório no GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create transcriber2000 --public --source=. --push
```

### 2. Deploy do Convex para produção

```bash
npx convex deploy
```

### 3. Conectar Vercel ao GitHub

1. Acesse https://vercel.com
2. Importe o repositório do GitHub
3. Adicione a variável de ambiente `VITE_CONVEX_URL` com a URL de produção do Convex

## Tecnologias

- React + TypeScript + Vite
- Convex (backend + database)
- Tailwind CSS
- Google Gemini 2.0 Flash API
