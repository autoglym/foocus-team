# Teamverktøy – MVP-plan

Utgangspunkt: [Slawk](https://github.com/ncvgl/slawk) (MIT), klonet 2026-10-23.
Mål for MVP: Slack-aktig chat + enkle dokumenter + en AI-agent som kan oppsummere og svare med kilder.

## Viktig funn: hvordan vi bruker Supabase

Slawk har en ferdig og godt testet backend (~37 000 linjer inkl. tester): Express + Prisma + Socket.io,
egen JWT-innlogging og tilgangskontroll per kanal (`backend/src/middleware/authorize.ts`), med egne
sikkerhetstester (`security.test.ts`, 1 159 linjer).

Å skrive om alt til Supabase Auth / Realtime / RLS ville vært en omskriving av hele backenden og kastet
de testene. Derfor:

| Del | Valg |
|---|---|
| Database | **Supabase Postgres** (bare bytt `DATABASE_URL`, Prisma fungerer som før) |
| Vektorsøk | **pgvector** i Supabase |
| Filer | **Supabase Storage** i stedet for Google Cloud Storage (`routes/files.ts`) |
| Innlogging, sanntid, tilgang | **Behold Slawks** (JWT, Socket.io, `authorize.ts`) |

Vi kan flytte til Supabase Auth senere hvis det blir behov for SSO (f.eks. Google/Microsoft-innlogging).

## Fase 0 – Få det til å kjøre (½–1 dag)

- [x] Opprett nytt Supabase-prosjekt (region EU), sett `DATABASE_URL` i `backend/.env`
- [x] `npm install` i `backend/` og `frontend/`, `prisma migrate deploy`, `db:seed`
- [x] Kjør lokalt, logg inn, test kanaler/tråder/filer
- [x] Bytt fil-lagring fra GCS til Supabase Storage
- [x] Rydd bort Slawk-spesifikt: `images/`, `my_prompts/`, dag-for-dag-README, GCP-deployskript

## Fase 1 – Dokumenter (3–5 dager)

Enkel modell: **dokumenter hører til en kanal og arver kanalens tilgang.** Da gjenbruker vi
`requireChannelMembership` og slipper et eget rettighetssystem i MVP.

- [x] Prisma-modeller: `Folder` (channelId, parentId, name), `Document` (channelId, folderId, title,
      `content` som JSON, `contentText` som ren tekst for søk/AI, createdBy, updatedBy, timestamps),
      `DocumentVersion` (snapshot ved hver lagring)
- [x] `routes/documents.ts`: list, hent, opprett, lagre, slett, versjonshistorikk
- [x] Editor: **BlockNote** (Notion-aktig, bygd på Tiptap), autosave
- [x] Ikke samtidig redigering i MVP: «Glenn redigerer nå»-varsel via Socket.io, siste lagring vinner
- [x] Maler (møtereferat, prosjektbrief, ukesrapport), mapper med filer, papirkurv og versjonsgjenoppretting
- [x] Frontend: «Dokumenter»-fane i hver kanal + oversikt over alle dokumenter jeg har tilgang til
- [x] Lenke til dokument i chat viser forhåndsvisning

## Fase 2 – Indeksering for AI (2–3 dager)

- [ ] Slå på `vector`-utvidelsen i Supabase
- [ ] Tabell `Chunk`: sourceType (`message` | `document`), sourceId, channelId, text, `embedding vector(1024)`
      (Prisma: `Unsupported("vector")` + rå SQL for søk)
- [ ] Embeddings via **Voyage AI** (Anthropics anbefalte embeddings-leverandør)
- [ ] Bakgrunnsjobb: ny melding / lagret dokument → del opp → embed → lagre. Gjenbruk `scheduler.ts`
- [ ] Engangsjobb som indekserer eksisterende innhold
- [ ] Søkefunksjon: hybrid (pgvector + Postgres fulltekst), **alltid filtrert på channelIds brukeren er medlem av**

## Fase 3 – AI-agenten (3–5 dager)

- [ ] Egen bot-bruker «AI» i `User`-tabellen
- [ ] Trigges av `@AI` i kanal/tråd og fra en knapp i dokumentvisningen
- [ ] Claude (Sonnet 5.5) med verktøy:
  - `søk(query)`: søker i meldinger og dokumenter
  - `les_tråd(messageId)`, `les_dokument(documentId)`
  - `oppsummer_kanal(channelId, periode)`
  - `lag_dokumentutkast(tittel, innhold, channelId)`: lager et utkast brukeren må godkjenne
- [ ] Svar postes i tråd med **kildelenker** til meldinger/dokumenter
- [ ] **Tilgangsregel:** verktøyene får brukerens tillatte channelIds fra serveren, aldri fra modellen.
      Agenten kan aldri se mer enn personen som spør
- [ ] Logg alle agent-kall (hvem spurte, hvilke kilder ble lest) i `AuditLog`

## Ikke i MVP

- Samtidig redigering (Yjs), kommentarer i dokumenter
- Egne rettigheter per mappe/dokument (SharePoint-stil)
- Opplasting og indeksering av PDF/Word/Excel
- Kobling mot CRM-et og Foocus-data
- SSO, mobilapp

## Estimat

Ca. 2–3 uker effektivt arbeid til en brukbar MVP for et lite team.
