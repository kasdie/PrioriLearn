# PrioriLearn AI

PrioriLearn is a bilingual study coach that turns syllabus, deadline, and calendar context into one explainable answer: **what should I do right now?** It shows academic impact and Cost of Delay, proposes a realistic plan, and requires explicit approval before a plan or replan takes effect.

This repository is the OpenAI Build Week Education-track implementation: a responsive React app, Node/TypeScript API, deterministic planning services, OpenAI structured extraction, PostgreSQL schema, seeded demo data, and a Manifest V3 browser companion.

## Run locally

Requirements: Node.js 22+ and npm.

```powershell
npm.cmd install
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run dev
```

- Web: `http://127.0.0.1:4173`
- API health: `http://127.0.0.1:8787/api/health`

`npm.cmd run dev` starts both processes with PostgreSQL persistence from `.env`. No AI credential is required: without `OPENAI_API_KEY`, the API selects a deterministic provider and labels its extraction as demo output.

To use OpenAI document extraction, copy the relevant values from `.env.example` into `.env`:

```dotenv
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.6
```

The implementation uses the Responses API with an `input_file` and Zod-backed structured output. See the official [file input](https://developers.openai.com/api/docs/guides/file-inputs) and [structured output](https://developers.openai.com/api/docs/guides/structured-outputs) guides.

## Demo path

1. Create a private account, sign in, or explicitly choose **Dùng workspace demo** for seeded data.
2. Open **Dữ liệu**, upload `sample-data/demo-syllabus.txt`, review the extraction, then confirm it.
3. Optionally import `sample-data/demo-calendar.ics`; calendar data also remains a draft until confirmation.
4. Return to **Hôm nay**, inspect the enlarged priority score and Cost of Delay warning, then start focus.
5. Open **Kế hoạch** and approve the versioned proposal.
6. Open **Coach**, choose **Mình đang bị kẹt**, and approve the smaller replan proposal.
7. Use the browser icon in the top bar to preview the read-only Canvas companion.

Authentication and workspace data require the API. The client never enters the shared demo implicitly, and logout revokes the active server session. The API exposes the active provider through `/api/health`, so demo and model-backed extraction are never silently confused.

## Verify

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The test suite covers account/session lifecycle, auth rate limits, scoring weights, Cost of Delay, coach-mode limits, calendar conflicts, tenant isolation, extraction confirmation, versioned plan/replan approval, ICS review, and 30-day raw-file purging.

## PostgreSQL schema

The runtime uses the PostgreSQL repository whenever `PERSISTENCE_DRIVER=postgres`; it persists accounts, sessions, courses, tasks, imports, plans, consents, and product events. The schema in `server/db/migrations` includes tenant keys, consent/audit records, connector-token columns, RLS policies, immutable plan versions, and a minimum cohort size of 10.

```powershell
docker compose up -d postgres
npm.cmd run db:migrate
```

`DATABASE_URL` and the remaining optional integration variables are documented in `.env` and `.env.example`. The Google Calendar and Canvas OAuth callback/token-sync flows are still pending; their variables remain blank until those connectors are enabled.

## Deploy: Vercel, Render, Supabase

The production topology is deliberately split: Vercel hosts the React client, Render hosts the Express API, and Supabase hosts PostgreSQL plus private source documents. The browser never receives `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.

1. In Supabase Storage, create the private bucket named in `SUPABASE_STORAGE_BUCKET` (the default is `priorilearn-documents`). Do not make it public.
2. In Render, create a new **Blueprint** from this repository. It reads [`render.yaml`](render.yaml) and starts the compiled API with `npm start`. Render Free does not run a pre-deploy command, so run the idempotent migration manually before the first deployment.
3. When Render asks for values, add `DATABASE_URL`, `SUPABASE_URL` (the Project URL root, not `/rest/v1`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, and set `APP_ORIGIN` to the exact Vercel Production URL. `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS` are optional tuning values. `OPENAI_API_KEY` is optional; without it, the deterministic demo extractor remains active.
4. The committed `.env.production` supplies the public Render API origin for this deployment. In Vercel, `VITE_API_ORIGIN` may override it when the API host changes; use the URL with no trailing slash and no `/api` suffix, then redeploy the frontend.
5. Open `https://<render-service>.onrender.com/api/health`. A production configuration reports `persistence: "postgres"` and `storage: "supabase"`.

For a manual migration outside Render, run `npm.cmd run db:migrate` from a machine that has the production `DATABASE_URL`. For the compiled production command, use `npm.cmd run db:migrate:production` after `npm.cmd run build`.

## Chrome extension

Load `extension/` through `chrome://extensions` using **Load unpacked**. It requests `activeTab` and `scripting`, reads a Canvas title/heading only after the student opens the popup, and never writes to Canvas.

## Project documents

- [Product spec](docs/product-spec.md)
- [Design and architecture](docs/design-doc.md)
- [Build and pilot plan](docs/build-plan.md)
- [Vietnamese pitch deck](docs/pitch-deck.md)
- [Devpost submission draft](SUBMISSION.md)
