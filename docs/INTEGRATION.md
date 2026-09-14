# Sales Dashboard → TerraFlow integration plan

This document is the blueprint for turning the standalone Terra **Sales Dashboard**
into a page **inside TerraFlow** (the Django app `TerraQuoteSystem`, served at
`https://terra-flow.ai`). It is written so the TerraFlow-side work can be picked up by
**Niek**, who owns TerraFlow.

> Ground rule: the Sales Dashboard team only changes **this** repo. All TerraFlow-side
> changes (routes, views, templates, data endpoint, budget model) are made by the
> TerraFlow owner. This document specifies exactly what those changes are.

## Where we are today

- **Frontend:** React 18 + Vite + TypeScript (`web/`). Talks to a small backend over
  `/api/*` (see `web/src/api.ts` for the exact contract).
- **Backend (interim):** Node/Express (`server/`) that syncs HubSpot deals hourly and
  stores the monthly **budget** in `data/data.json`. This backend is **temporary** —
  Phase 3 replaces it with a TerraFlow endpoint.
- Runs today as its own process on `:8080`.

## Target architecture

The Sales Dashboard becomes a **frontend-only** page that TerraFlow serves at
`/sales-dashboard/`, behind TerraFlow's existing **allauth Google login** (already
restricted to `@terra-inspectioneering.com`). Deal data and budget come from a small
**TerraFlow JSON endpoint**; the Node backend is retired.

## Phased plan

### Phase 0 — foundation (done / in progress)
- This repo (`terra-sales-dashboard`) on GitHub as the single source of truth.

### Phase 1 — make the frontend embeddable (Sales Dashboard side)
- Make the Vite `base` path configurable (e.g. build with
  `base: '/static/sales-dashboard/'`) so assets resolve when served by Django.
- Make the API base URL configurable (`VITE_API_BASE`), default `''` (same-origin),
  so the same build can talk to the interim Node backend **or** the TerraFlow endpoint.
- No behaviour change for the current standalone run.

### Phase 2 — serve as a page in TerraFlow (TerraFlow side, Niek)
1. **Build** the frontend in this repo: `cd web && npm ci && npm run build` → outputs
   static assets to `web/dist/` (with the configured `base`).
2. **Ship the assets** into TerraFlow's static tree, e.g. `static/sales-dashboard/`,
   and run `python manage.py collectstatic`.
3. **Template** `templates/sales_dashboard.html` that loads the built `index.html`'s
   CSS/JS from `{% static 'sales-dashboard/...' %}`.
4. **Route** in `quotes/urls.py`:
   ```python
   from django.contrib.auth.decorators import login_required
   from django.views.generic import TemplateView
   path('sales-dashboard/',
        login_required(TemplateView.as_view(template_name='sales_dashboard.html')),
        name='sales_dashboard'),
   ```
   The page now inherits the logged-in TerraFlow user — this covers the "login" wish.

### Phase 3 — data from TerraFlow, retire the Node backend (TerraFlow side, Niek)
Add a small JSON API under `/sales-dashboard/api/` that returns the same shapes the
frontend already expects (see `web/src/api.ts`). The frontend switches to it via
`VITE_API_BASE`.

- `GET /sales-dashboard/api/deals?year=YYYY` → `{ year, deals: Deal[] }`, where each
  `Deal` has: `id, year, deal_name, sales_pipeline, pipeline_id, deal_stage, stage_id,
  owner, owner_id, customer, customer_id, deal_amount, cost_of_sales, margin,
  close_date, execution_date, execution_month, deal_link, synced_at`.
- `GET /sales-dashboard/api/meta` → pipelines, stages, owners, years (see `Meta` in
  `web/src/api.ts`).
- `GET /sales-dashboard/api/budget?year=YYYY` and
  `POST /sales-dashboard/api/budget` → the monthly budget (revenue + margin per month).
  This is the dashboard's only **write** data; store it in a small TerraFlow model.

**Data source note:** TerraFlow's `Project` model already stores `hubspot_deal_amount`,
owner, stage tags, dealname and `executed_date`, and TerraFlow pushes `cost_of_sales`
to HubSpot. It does **not** currently keep `margin`/`cost_of_sales` as queryable
per-deal fields, so the deals endpoint should get amount + cost + margin from HubSpot
(reuse `hubspot_sync/hubspot_client.py`) — or those fields get added to the Project
sync. Until Phase 3 lands, the dashboard keeps using its own HubSpot sync in `server/`.

## The API contract (authoritative)

`web/src/api.ts` in this repo is the source of truth for the JSON shapes. Build the
Phase 3 endpoints to match it and the frontend needs no further change beyond
`VITE_API_BASE`.
