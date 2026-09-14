import { config, yearsToSync } from './config';
import {
  addSyncLog,
  DealRow,
  replaceDealsForYear,
  setSetting,
  upsertOwners,
  upsertPipelines,
  upsertStages,
} from './db';
import { fetchDealCompanies, fetchDealsForYear, fetchReferenceData } from './hubspot';
import { buildMockDeals, mockOwners, mockPipelines, mockStages } from './mockData';

let running = false;
export function isSyncing() {
  return running;
}

function pad2(n: number) {
  return n < 10 ? '0' + n : String(n);
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toMonth(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(isNaN(Number(dateStr)) ? dateStr : Number(dateStr));
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function mapRawDeal(
  raw: any,
  year: number,
  maps: { pipe: Map<string, string>; stage: Map<string, string>; owner: Map<string, string> },
  companies?: Map<string, { id: string; name: string }>
): DealRow {
  const p = raw.properties || {};
  const amount = parseNum(p.amount);
  const cost = parseNum(p.cost_of_sales);
  const pipelineId = p.pipeline || '';
  const stageId = p.dealstage || '';
  const ownerId = p.hubspot_owner_id || '';
  const comp = companies?.get(String(raw.id));
  return {
    id: String(raw.id),
    year,
    deal_name: p.dealname || '(no name)',
    sales_pipeline: maps.pipe.get(pipelineId) || pipelineId,
    pipeline_id: pipelineId,
    deal_stage: maps.stage.get(stageId) || stageId,
    stage_id: stageId,
    owner: maps.owner.get(ownerId) || '',
    owner_id: ownerId,
    customer: comp?.name || '',
    customer_id: comp?.id || '',
    deal_amount: amount,
    cost_of_sales: cost,
    margin: amount - cost,
    close_date: p.closedate || null,
    execution_date: p.execution_date || null,
    execution_month: toMonth(p.execution_date),
    deal_link: `https://app.hubspot.com/contacts/${config.hubspotPortalId}/deals/${raw.id}`,
    synced_at: new Date().toISOString(),
  };
}

export async function runSync(): Promise<{ status: string; message: string; count: number }> {
  if (running) return { status: 'skipped', message: 'A sync is already running', count: 0 };
  running = true;
  const started = new Date().toISOString();
  let count = 0;
  const source = config.useMock ? 'mock' : 'hubspot';
  const years = yearsToSync();

  try {
    if (config.useMock) {
      upsertPipelines(mockPipelines);
      upsertStages(mockStages);
      upsertOwners(mockOwners);
      for (const year of years) {
        const deals = buildMockDeals(year);
        replaceDealsForYear(year, deals);
        count += deals.length;
      }
    } else {
      const ref = await fetchReferenceData();
      upsertPipelines(ref.pipelines);
      upsertStages(ref.stages);
      upsertOwners(ref.owners);

      const pipeMap = new Map(ref.pipelines.map((p) => [p.id, p.label]));
      const stageMap = new Map(ref.stages.map((s) => [s.id, s.label]));
      const ownerMap = new Map(ref.owners.map((o) => [o.id, o.name]));

      for (const year of years) {
        // Fetch ALL stages; the Monthly overview hides Suspect/Closed lost by default via the filter.
        const raw = await fetchDealsForYear(year, []);
        // Look up the associated company per deal so we can group by customer.
        const companies = await fetchDealCompanies(raw.map((r) => String(r.id)));
        const deals = raw.map((r) =>
          mapRawDeal(r, year, { pipe: pipeMap, stage: stageMap, owner: ownerMap }, companies)
        );
        replaceDealsForYear(year, deals);
        count += deals.length;
      }
    }

    const finished = new Date().toISOString();
    setSetting('last_sync_at', finished);
    setSetting('last_sync_status', 'ok');
    setSetting('last_sync_source', source);
    addSyncLog({
      started_at: started,
      finished_at: finished,
      status: 'ok',
      message: `Synced ${count} deals`,
      deals_count: count,
      years: years.join(','),
      source,
    });
    return { status: 'ok', message: `Synced ${count} deals`, count };
  } catch (err: any) {
    const finished = new Date().toISOString();
    const message = err?.message || String(err);
    setSetting('last_sync_status', 'error');
    setSetting('last_sync_error', message);
    addSyncLog({
      started_at: started,
      finished_at: finished,
      status: 'error',
      message,
      deals_count: count,
      years: years.join(','),
      source,
    });
    return { status: 'error', message, count };
  } finally {
    running = false;
  }
}
