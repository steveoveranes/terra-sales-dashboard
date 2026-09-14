import { config } from './config';

const BASE = 'https://api.hubapi.com';

async function hsFetch(url: string, init?: any): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.hubspotToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HubSpot ${res.status} on ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

export interface RefPipeline {
  id: string;
  label: string;
  order: number;
}
export interface RefStage {
  id: string;
  pipeline_id: string;
  label: string;
  order: number;
}
export interface RefOwner {
  id: string;
  name: string;
  email: string;
}

export async function fetchReferenceData(): Promise<{
  pipelines: RefPipeline[];
  stages: RefStage[];
  owners: RefOwner[];
}> {
  const pipelines: RefPipeline[] = [];
  const stages: RefStage[] = [];

  const pipeData = await hsFetch(`${BASE}/crm/v3/pipelines/deals`);
  for (const p of pipeData.results || []) {
    pipelines.push({ id: p.id, label: p.label, order: p.displayOrder ?? 0 });
    for (const s of p.stages || []) {
      stages.push({ id: s.id, pipeline_id: p.id, label: s.label, order: s.displayOrder ?? 0 });
    }
  }

  const owners: RefOwner[] = [];
  let after: string | undefined;
  let guard = 0;
  do {
    const url = new URL(`${BASE}/crm/v3/owners`);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);
    const data = await hsFetch(url.toString());
    for (const o of data.results || []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || o.email || o.id;
      owners.push({ id: String(o.id), name, email: o.email || '' });
    }
    after = data.paging?.next?.after;
    guard++;
  } while (after && guard < 100);

  return { pipelines, stages, owners };
}

const DEAL_PROPERTIES = [
  'execution_date',
  'dealname',
  'closedate',
  'amount',
  'cost_of_sales',
  'dealstage',
  'pipeline',
  'hubspot_owner_id',
];

/**
 * Epoch millis of 1 Jan `year` at 00:00 LOCAL time in `tz`.
 * HubSpot stores closedate as a UTC instant, so a deal closing at local midnight on
 * 1 Jan (e.g. Amsterdam UTC+1) is stored as 31 Dec 23:00 UTC. Using UTC midnight as
 * the year boundary would drop it; using local midnight keeps it in the right year,
 * matching the old Google Sheet (which ran in the business timezone).
 */
function localYearStartMillis(year: number, tz: string): number {
  const utcGuess = Date.UTC(year, 0, 1, 0, 0, 0);
  // offset (local - utc) for `tz` at that instant
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcGuess))) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = asIfUTC - utcGuess; // e.g. +3600000 for CET
  return utcGuess - offset; // shift UTC midnight back to local midnight
}

// Page through one filter set with the `after` cursor and a stable sort.
async function searchAllDeals(filters: any[]): Promise<any[]> {
  const out: any[] = [];
  let after: string | undefined;
  let guard = 0;
  do {
    const body: any = {
      limit: 100,
      sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
      properties: DEAL_PROPERTIES,
      filterGroups: [{ filters }],
    };
    if (after) body.after = after;
    const data = await hsFetch(`${BASE}/crm/v3/objects/deals/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    for (const d of data.results || []) out.push(d);
    after = data.paging?.next?.after;
    guard++;
  } while (after && guard < 500);
  return out;
}

/**
 * Fetch the deals that belong to the given year. A deal belongs to the year of its
 * EXECUTION date, because that is how the overview is organised (grouped by execution
 * month). Deals without an execution date are assigned by their CLOSE date instead
 * (the "No execution date" group), matching the old sheet.
 *
 * execution_date is a HubSpot *date* property (stored at UTC midnight), so plain UTC
 * year boundaries are correct for it. closedate is a *datetime*, so its boundaries
 * use LOCAL midnight (a deal closing 1 Jan local is stored as 31 Dec 23:00 UTC).
 */
export async function fetchDealsForYear(year: number, excludedStageIds: string[]): Promise<any[]> {
  const exStart = Date.UTC(year, 0, 1);
  const exEnd = Date.UTC(year + 1, 0, 1);
  const clStart = localYearStartMillis(year, config.timezone);
  const clEnd = localYearStartMillis(year + 1, config.timezone);

  const base: any[] = [{ propertyName: 'pipeline', operator: 'IN', values: config.pipelineIds }];
  if (excludedStageIds.length) {
    base.push({ propertyName: 'dealstage', operator: 'NOT_IN', values: excludedStageIds });
  }

  // 1) deals whose execution date is in this year
  const executedInYear = [
    ...base,
    { propertyName: 'execution_date', operator: 'GTE', value: String(exStart) },
    { propertyName: 'execution_date', operator: 'LT', value: String(exEnd) },
  ];
  // 2) deals with NO execution date, whose close date is in this year
  const undatedClosedInYear = [
    ...base,
    { propertyName: 'execution_date', operator: 'NOT_HAS_PROPERTY' },
    { propertyName: 'closedate', operator: 'GTE', value: String(clStart) },
    { propertyName: 'closedate', operator: 'LT', value: String(clEnd) },
  ];

  const results: any[] = [];
  const seen = new Set<string>();
  for (const filters of [executedInYear, undatedClosedInYear]) {
    for (const d of await searchAllDeals(filters)) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(d);
      }
    }
  }
  return results;
}

/**
 * Look up the associated company (id + name) for a set of deals, so the dashboard
 * can group turnover/margin by customer. HubSpot's deal search does not return
 * associations, so this is done in two batched passes:
 *   1) deal id  -> company id   (v4 associations batch read)
 *   2) company id -> company name (v3 companies batch read)
 * A deal can be associated with several companies; we take the first (primary).
 * Deals with no associated company map to an empty name (shown as "Unknown").
 */
export async function fetchDealCompanies(
  dealIds: string[]
): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (!dealIds.length) return out;

  // Resolving the customer needs the `crm.objects.companies.read` scope on the
  // private-app token. If that scope is missing (403) or any other call fails, we
  // must NOT break the whole sync — the dashboard just falls back to no customer
  // data. So the entire lookup is wrapped and returns whatever it managed to get.
  try {
    // 1) deal -> company id
    const dealToCompany = new Map<string, string>();
    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100);
      const data = await hsFetch(`${BASE}/crm/v4/associations/deals/companies/batch/read`, {
        method: 'POST',
        body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
      });
      for (const row of data.results || []) {
        const from = String(row.from?.id ?? row.from ?? '');
        const toList = Array.isArray(row.to) ? row.to : [];
        const to = toList.length ? String(toList[0].toObjectId ?? toList[0].id ?? '') : '';
        if (from && to) dealToCompany.set(from, to);
      }
    }

    // 2) company id -> name
    const companyIds = [...new Set(dealToCompany.values())].filter(Boolean);
    const nameById = new Map<string, string>();
    for (let i = 0; i < companyIds.length; i += 100) {
      const chunk = companyIds.slice(i, i + 100);
      const data = await hsFetch(`${BASE}/crm/v3/objects/companies/batch/read`, {
        method: 'POST',
        body: JSON.stringify({ properties: ['name'], inputs: chunk.map((id) => ({ id })) }),
      });
      for (const c of data.results || []) {
        nameById.set(String(c.id), String(c.properties?.name || '').trim());
      }
    }

    for (const [dealId, companyId] of dealToCompany) {
      out.set(dealId, { id: companyId, name: nameById.get(companyId) || '' });
    }
  } catch (err: any) {
    console.warn(
      '[sync] Could not fetch associated companies (customer grouping disabled). ' +
        'Grant the private app the "crm.objects.companies.read" scope to enable it. Reason: ' +
        (err?.message || String(err))
    );
    return new Map();
  }
  return out;
}
