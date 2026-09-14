# Sales Dashboard → TerraFlow integration plan

This document is the blueprint for surfacing the Terra **Sales Dashboard** as a page
**inside TerraFlow** (the Django app `TerraQuoteSystem`, served at
`https://terra-flow.ai`), so it lives behind TerraFlow's login and navigation. It is
written so the TerraFlow-side work can be picked up by **Niek**, who owns TerraFlow.

> Ground rule: the Sales Dashboard team only changes **this** repo. All TerraFlow-side
> changes (routing / reverse-proxy, a nav link) are made by the TerraFlow owner. This
> document specifies exactly what those changes are.

## Architecture decision (2026-09-14)

The Sales Dashboard keeps its **own backend and its own database** — it is not folded
into TerraFlow. Reasons: we can keep developing independently, and a real database is
handy for future data beyond the budget.

- **Frontend:** React 18 + Vite + TypeScript (`web/`).
- **Backend:** Node/Express (`server/`) — hourly HubSpot sync + the monthly **budget**,
  serving the built frontend and a JSON API on `/api/*`.
- **Database:** pluggable (`server/src/db.ts`). Local dev = a JSON file; production =
  **PostgreSQL** via `DATABASE_URL`, pointed at a **dedicated database on the shared
  Postgres server** (separate from TerraFlow, so we don't get in each other's way).
  The app creates its own tables on startup. See `README.md` → *Database*.

TerraFlow's only job is to **put this behind its login and make it reachable** under
`terra-flow.ai`. No TerraFlow data endpoint and no budget model are needed — that was
an earlier idea, now dropped.

## Phased plan

### Phase 0 — foundation — DONE
Public GitHub repo `terra-sales-dashboard` as the single source of truth.

### Phase 1 — make the frontend embeddable (Sales Dashboard side) — DONE
Two build-time env vars control embedding (defaults keep the standalone run identical):

- `VITE_BASE` — public path the assets are served from. Default `/`. For a sub-path
  mount set e.g. `/sales-dashboard/`.
- `VITE_API_BASE` — prefix for the `/api/*` calls. Default `''` (same-origin). Only
  needed if the API is reached on a different path than the page.

The app has no client-side router, so no `basename` handling is needed.

### Phase 1b — own PostgreSQL database (Sales Dashboard side) — DONE
The backend runs on Postgres when `DATABASE_URL` is set (JSON file otherwise). Nothing
to do here except, at deploy time, create the dedicated database and set the URL.

### Phase 2 — surface it inside TerraFlow, behind login (TerraFlow side, Niek)
Our backend runs as its own service on the Mac mini (say `http://localhost:8090`). Make
it reachable at `terra-flow.ai/sales-dashboard/` **only for logged-in users**.
Recommended approach — a small authenticated reverse-proxy view in Django:

1. Run our service on the Mac mini (a dedicated port), with `DATABASE_URL` pointing at
   its own database on the shared Postgres server.
2. In TerraFlow, add a `@login_required` route for `sales-dashboard/` (and
   `sales-dashboard/<path>`) that reverse-proxies to our service. Because the view is
   `@login_required`, TerraFlow's existing allauth Google login (restricted to
   `@terra-inspectioneering.com`) gates access — exactly the login we want.
3. Add a link to the dashboard in TerraFlow's navigation.

Build the frontend for the sub-path so asset URLs resolve:
```bash
cd web && npm ci
# macOS/Linux:
VITE_BASE=/sales-dashboard/ npm run build
# Windows PowerShell:
#   $env:VITE_BASE="/sales-dashboard/"; npm run build
```
(If a reverse-proxy strips the `/sales-dashboard` prefix before it reaches our service,
`VITE_BASE` can stay `/`. Niek picks whichever matches the proxy setup.)

Alternative to a Django proxy: route the `/sales-dashboard` path straight to our
service at the Cloudflare Tunnel / front layer. Login is then enforced by whatever
guards that path; the Django `@login_required` proxy is the simplest way to guarantee it.

### Deployment checklist (when we go live on the Mac mini)
- Create a database on the shared Postgres server, e.g. `terra_sales_dashboard`.
- Set `DATABASE_URL`, `HUBSPOT_TOKEN`, `USE_MOCK=0` in the service's `.env`.
- Run the service (Docker or `node dist/index.js`) on its port; it creates its tables
  and does a first sync.
- Wire the TerraFlow route/proxy (Phase 2) and add the nav link.

## The API (for reference)

`web/src/api.ts` documents the JSON the frontend uses (`/api/deals`, `/api/meta`,
`/api/budget`, `/api/sync-status`, `/api/refresh`, `/api/tdjp-upside`). With the
own-backend model these are served by our own `server/` — TerraFlow does not
reimplement them.
