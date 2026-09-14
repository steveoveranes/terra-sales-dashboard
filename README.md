# Terra Sales Dashboard — Phase 1

A self-hosted web dashboard that replaces the Google Sheet as the daily sales tool.
This is **Phase 1**: the project skeleton, the HubSpot → database sync, and the
**Raw HubSpot data** tab. The other three tabs (Monthly overview, Graphs, TDJP)
are visible as placeholders and come in the next phases.

It runs as **one Docker container**: a Node.js backend that syncs HubSpot into a
local SQLite database and serves a React frontend.

> Note: this package was built for you but could not be test-built in the
> Claude sandbox (the npm registry is blocked there). The first build happens on
> your machine. If anything fails on first run, send me the error and I'll fix it.

---

## What you need

- **Docker Desktop** (recommended — one command to run), **or**
- **Node.js 22+** if you'd rather run it without Docker.

---

## Quick start (Docker — recommended)

1. Copy the example config and open it:
   ```
   cp .env.example .env
   ```
2. For a **first look with sample data**, leave `.env` as is (`USE_MOCK=1`).
   To use **real HubSpot data**, set in `.env`:
   ```
   HUBSPOT_TOKEN=pat-na1-your-token
   USE_MOCK=0
   ```
3. Build and start:
   ```
   docker compose up --build
   ```
4. Open **http://localhost:8080**

The database is stored in a Docker volume (`dashboard-data`), so your data and
(later) your budgets survive restarts. Stop with `Ctrl+C`, or run detached with
`docker compose up --build -d`.

---

## Quick start on Windows (no Docker) — easiest

1. Install **Node.js LTS** from https://nodejs.org (if `node -v` in a terminal fails).
2. Copy `.env.example` to `.env` (leave `USE_MOCK=1` for a first look with sample data).
3. Double-click **`run-dev.bat`** (or run it from the terminal).
   It installs everything, builds, and starts the app.
4. Open **http://localhost:8080**

Leave the window open while you use the app; press `Ctrl+C` to stop. To switch to
real HubSpot data, set `HUBSPOT_TOKEN` and `USE_MOCK=0` in `.env`, then run the
script again.

## Quick start (without Docker, manual)

Two terminals:

**Backend**
```
cd server
npm install
npm run dev
```
(reads `../.env` values via your shell, or set env vars; defaults to sample data)

**Frontend**
```
cd web
npm install
npm run dev
```
Open the URL Vite prints (http://localhost:5173). The frontend proxies `/api` to
the backend on port 8080.

For a single production-style process without Docker:
```
cd web && npm install && npm run build
cd ../server && npm install && npm run build
cp -r ../web/dist ./web-dist
# set your env (or a .env loaded by your shell), then:
HUBSPOT_TOKEN=... USE_MOCK=0 PORT=8080 npm start
```
Open http://localhost:8080

---

## Configuration (.env)

| Variable | Meaning |
|---|---|
| `HUBSPOT_TOKEN` | Your HubSpot private-app token. Stays on the server, never sent to the browser. |
| `USE_MOCK` | `1` = show built-in sample data (no HubSpot needed). `0` = real data (requires token). |
| `SYNC_YEARS` | Years to sync, comma separated. Phase 1: `2026`. |
| `PIPELINE_IDS` | HubSpot pipeline IDs to include. |
| `EXCLUDED_STAGE_LABELS` | Deal stages hidden **by default** in the Monthly overview (Phase 2). Not excluded from sync, so you can still toggle them on. |
| `SYNC_CRON` | Auto-sync schedule (cron). Default hourly `0 * * * *`. |
| `PORT` | Port to listen on (default 8080). |
| `HUBSPOT_PORTAL_ID` | Used to build deal links (default 2372383). |

The app also syncs automatically every hour, and there is a **Refresh now**
button in the top bar.

---

## How the sync works

- Deals are fetched per year via the HubSpot CRM Search API, using
  `closedate >= 1 Jan` and `< 1 Jan next year` with cursor pagination and a stable
  sort on `hs_object_id` — so no deal is fetched twice (the duplicate bug we fixed).
- Pipelines, stages and owners are read live from HubSpot (replacing the
  "Pipelinestages" and "Owners" helper sheets).
- Deals are grouped by **execution date** month, with a **"No execution date"**
  group, matching the current sheet.

---

## What's next

- **Phase 2:** Monthly overview — month grouping, totals, filter bar, colour rules.
- **Phase 3:** TDJP Input Format — the 5-block calculation with editable upside.
- **Phase 4:** Graphs — turnover & margin by category and vs. editable budget.
- **Phase 5:** Terra Drone styling polish + deployment to the Mac mini.
