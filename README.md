# Karta · Retail Intelligence

PWA de gestão operacional para redes de supermercados hard discount.

## Estrutura de ficheiros

```
karta/
├── index.html       — Shell HTML principal
├── styles.css       — Estilos completos (design system)
├── app.js           — Lógica da app e routing entre módulos
├── firebase.js      — Firebase (Firestore, Storage, Auth) + cache TTL
├── ui.js            — Componentes UI, toasts, modals, formatters
├── sw.js            — Service Worker (PWA, cache offline)
├── manifest.json    — PWA manifest
├── netlify.toml     — Config de deploy
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## Setup Firebase

1. Crie um projeto em https://console.firebase.google.com
2. Ative **Firestore Database** (modo produção ou teste)
3. Ative **Storage**
4. Ative **Authentication** (Email/Password)
5. Em `firebase.js`, substitua `FIREBASE_CONFIG` pelas suas credenciais:

```js
const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## Collections Firestore

| Collection           | Descrição                              |
|----------------------|----------------------------------------|
| `stores`             | Dados de cada loja                     |
| `daily_kpis`         | KPIs diários por loja                  |
| `monthly_targets`    | Objetivos mensais por loja             |
| `inventory_counts`   | Registos de contagens/inventários      |
| `supervisor_reviews` | Visitas e avaliações de supervisores   |
| `schedules`          | Escalas mensais por loja               |
| `app_config`         | Configurações globais                  |

## Inserir dados demo

1. Configure o Firebase (passo anterior)
2. Abra a app no browser
3. Vá a **Administração → Seed** e clique "Seed"
4. Aguarde — irá inserir 5 lojas com 30 dias de KPIs

## Ícones PWA

Crie uma pasta `icons/` e adicione:
- `icon-192.png` — 192×192px, fundo preto, 4 quadrados: branco, azul escuro, azul vivo, branco
- `icon-512.png` — 512×512px (mesma composição)

Pode usar o Figma ou https://icon.kitchen para gerar os ícones.

## Deploy Netlify

1. Faça push do projeto para um repositório GitHub
2. Ligue o repo ao Netlify
3. Configuração de build: já incluída no `netlify.toml`
4. (Opcional) Adicione variáveis de ambiente para as chaves Firebase

## Regras de Segurança Firestore (sugeridas)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Apenas utilizadores autenticados
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Módulos incluídos

- **Dashboard** — KPIs por loja, objetivos mensais, ranking, gráfico diário
- **Análises** — Top/Flop 10, médias por dia da semana, evolução mensal
- **Contagens** — Registo de inventários, upload de anexos, exportação CSV
- **Escalas** — Escala mensal por loja com turnos M/T/N/F
- **Roteiro** — Checklist de supervisores com avaliação e histórico
- **Administração** — Gestão de lojas, cache, seed de dados, exportação JSON

## Tecnologias

- HTML / CSS / JavaScript puro (sem frameworks)
- Firebase Firestore + Storage + Auth
- PWA (Service Worker, manifest, offline parcial)
- Deploy Netlify
- Font: DM Sans + DM Mono
- Cache local com TTL (localStorage)
