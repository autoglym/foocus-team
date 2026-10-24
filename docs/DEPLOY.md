# Publisere Foocus Team på Render (gratis)

Appen kjører som én webtjeneste på Render sin gratisplan. Databasen og filene ligger i Supabase-prosjektet `teamverktoy` (schema `prod` for produksjon, `app` for lokal utvikling).

**Verdt å vite om gratisplanen:** Tjenesten sover etter 15 minutter uten trafikk. Den første som åpner appen etterpå venter ca. ett minutt. Supabase-gratisprosjekter pauses etter en uke uten bruk.

## 1. Legg koden i ditt eget GitHub-repo

1. Gå til <https://github.com/new>.
2. Navn: `foocus-team`. Velg **Private**. Ikke huk av for README, .gitignore eller lisens.
3. Klikk **Create repository** og kopier adressen (f.eks. `https://github.com/DITT-BRUKERNAVN/foocus-team.git`).
4. Kjør i Terminal fra prosjektmappen (bytt ut adressen):

   ```bash
   git remote add origin https://github.com/DITT-BRUKERNAVN/foocus-team.git
   ```

   ```bash
   git push -u origin fase-0:main
   ```

   Remoten `upstream` er det opprinnelige Slawk-prosjektet. Ikke push dit.

## 2. Opprett tjenesten på Render

1. Gå til <https://render.com> og registrer deg med **GitHub-kontoen** din.
2. Gi Render tilgang til repoet `foocus-team` når du blir spurt.
3. Velg **New → Blueprint** og velg repoet. Render leser `render.yaml` og foreslår tjenesten `foocus-team` (Free, Frankfurt).
4. Render ber om verdiene for `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` og `CORS_ORIGIN`. Kopier dem fra filen `backend/.env.production` (skjult fil; åpne den med `open -e backend/.env.production`). Lim inn verdien etter `=`, uten anførselstegn.
5. Klikk **Apply**. Første bygg tar 5–10 minutter. Følg med under **Logs**; den er klar når du ser `Server running`.
6. Adressen står øverst på tjenestesiden, f.eks. `https://foocus-team.onrender.com`. Hvis den er annerledes, endre `CORS_ORIGIN` under **Environment** til den faktiske adressen.

## 3. Lag den første eieren

Registrering krever invitasjon, så den første brukeren lages fra Terminal (mot produksjonsdatabasen):

```bash
cd backend && npm run create-owner -- --email deg@foocus.ai --name "Ditt Navn"
```

Du blir bedt om å skrive passord to ganger (det vises ikke). Skriptet lager deg som eier og kanalen #general.

## 4. Inviter teamet

1. Logg inn på adressen fra steg 2.
2. Gå til **Admin → Invites** og lag en invitasjonslenke.
3. Send lenken til teamet. De registrerer seg selv via lenken.

## 5. Logg inn med Google (valgfritt)

1. Gå til <https://console.cloud.google.com>, lag (eller velg) et prosjekt.
2. **APIs & Services → OAuth consent screen**: velg **Internal** hvis dere bruker Google Workspace (da kan bare folk i foocus.ai logge inn), fyll inn appnavn «Foocus Team» og kontakt-e-post.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://foocus-team.onrender.com/auth/google/callback`
4. Kopier **Client ID** og **Client secret**.
5. På Render → foocus-team → **Environment**, legg inn:
   - `APP_URL` = `https://foocus-team.onrender.com`
   - `GOOGLE_CLIENT_ID` og `GOOGLE_CLIENT_SECRET` fra steg 4
   - `GOOGLE_ALLOWED_DOMAINS` = `foocus.ai` (står allerede)
6. **Save, rebuild, and deploy**. Knappen «Continue with Google» vises da på innloggingssiden.

Hvem slipper inn: alle som allerede har en konto med samme e-post, og nye brukere med e-post på domenene i `GOOGLE_ALLOWED_DOMAINS` (de får konto automatisk og havner i #general). Andre trenger fortsatt en invitasjonslenke.

## Oppdateringer

Hver `git push` til `main` i ditt repo bygger og publiserer appen automatisk. Nye databasemigreringer kjøres ved oppstart.
