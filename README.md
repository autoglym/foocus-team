# Foocus Team

Internt teamverktøy: Slack-aktig chat, dokumenter og en AI-agent (Claude) som kan oppsummere og svare med kilder fra samtaler og dokumenter.

Bygd på [Slawk](https://github.com/ncvgl/slawk) av Nathan Cavaglione (MIT-lisens, se [LICENSE](LICENSE)). Planen videre står i [MVP-PLAN.md](MVP-PLAN.md).

## Arkitektur

| Del | Teknologi |
|---|---|
| Backend | Node.js, Express, Prisma, Socket.io (`backend/`) |
| Frontend | React, Vite, Tailwind (`frontend/`) |
| Database | Supabase Postgres, schema `app` (ikke eksponert via Supabase-REST) |
| Filer | Supabase Storage, privat bucket `files`, signerte URL-er |
| Innlogging og tilgang | Slawks egen JWT-auth og kanaltilgang (`backend/src/middleware/authorize.ts`) |

## Kom i gang lokalt

Krever Node 22+.

1. Kopier `backend/.env.example` til `backend/.env` og fyll inn:
   - `DATABASE_URL` / `DIRECT_URL`: session-pooler-adressen fra Supabase (port 5432, med `?schema=app`). Ikke bruk transaction-pooleren (6543): den mister `search_path`, og rå SQL-spørringer feiler.
   - `JWT_SECRET`: `openssl rand -hex 32`
   - `SUPABASE_URL` og `SUPABASE_SECRET_KEY` (Project Settings → API Keys). Uten nøkkel lagres filer på lokal disk i `backend/uploads/`.
   - `SEED_PASSWORD` og `DEMO_PASSWORD` for testbrukerne
2. Installer og sett opp databasen:

   ```bash
   cd backend && npm install && npx prisma migrate deploy && npm run db:seed
   ```

   ```bash
   cd frontend && npm install
   ```

3. Start backend (`npm run dev` i `backend/`, port 3000) og frontend (`npm run dev` i `frontend/`, port 5173). Logg inn som f.eks. `alice@slawk.dev` med `SEED_PASSWORD`.

## Tester

Testene tømmer databasen, så de skal kjøre mot et eget schema. Lag `backend/.env.test` med `DATABASE_URL` og `DIRECT_URL` som peker på `?schema=app_test`, kjør `npx prisma migrate deploy` med de verdiene, og deretter:

```bash
cd backend && npm test
```

## Publisering

Appen kan kjøre gratis på Render. Se [docs/DEPLOY.md](docs/DEPLOY.md).
