import { DealRow } from './db';
import { RefOwner, RefPipeline, RefStage } from './hubspot';
import { config } from './config';

export const mockPipelines: RefPipeline[] = [
  { id: 'default', label: 'Sales netherlands', order: 0 },
  { id: '11366959', label: 'Sales germany', order: 1 },
  { id: '148764192', label: 'FPSO', order: 2 },
  { id: '691243093', label: 'X1 hardware sales europe', order: 3 },
  { id: '4371268', label: 'UT drone hardware sales', order: 4 },
];

const STAGE_LABELS = [
  'Lead',
  'Quotation request',
  'Quotation sent, big chance',
  'Committed',
  'Operations briefed',
  'PO or Quote missing',
  'Can be invoiced',
  'Invoiced',
  'Paid',
  'Project finished',
  'Suspect',
  'Closed lost',
];

export const mockStages: RefStage[] = STAGE_LABELS.map((label, i) => ({
  id: 'st_' + i,
  pipeline_id: 'default',
  label,
  order: i,
}));

const stageId = (label: string) => mockStages.find((s) => s.label === label)!.id;

export const mockOwners: RefOwner[] = [
  { id: 'o1', name: 'Steven Verver', email: '' },
  { id: 'o2', name: 'Niek van Oostenbrugge', email: '' },
  { id: 'o3', name: 'Frans van Kogelenberg', email: '' },
  { id: 'o4', name: 'julia van haren', email: '' },
  { id: 'o5', name: 'Kjeld Verhage', email: '' },
];

interface Seed {
  name: string;
  pipeline: string;
  stage: string;
  owner: string;
  amount: number;
  cost: number;
  month: number | null; // execution month 1-12, or null = No execution date
}

// A spread of deals across 2026 that also exercises the colour rules
// (relative to "today"): PO or Quote missing -> red, Paid -> dark green,
// Can be invoiced -> light green (orange if execution month is in the past), etc.
const SEEDS: Seed[] = [
  { name: '26-0003.2 - MODEC MV29 4S COT', pipeline: 'FPSO', stage: 'Paid', owner: 'Steven Verver', amount: 34010, cost: 31841, month: 1 },
  { name: '26-0010.2 - Argent Energy - Kolom C60201', pipeline: 'Sales netherlands', stage: 'Paid', owner: 'Steven Verver', amount: 2850, cost: 0, month: 1 },
  { name: '26-0012.1 - Stolt Moerdijk - T6004 UT pole', pipeline: 'Sales netherlands', stage: 'Project finished', owner: 'Steven Verver', amount: 5000, cost: 0, month: 2 },
  { name: '26-0015.1 - Zeeland Refinery - demo inspecties', pipeline: 'Sales netherlands', stage: 'Invoiced', owner: 'Frans van Kogelenberg', amount: 23850, cost: 0, month: 3 },
  { name: '26-0024.1 - VOPAK Vlaardingen - T2561 OSI', pipeline: 'Sales netherlands', stage: 'Paid', owner: 'Niek van Oostenbrugge', amount: 4750, cost: 0, month: 3 },
  { name: '26-0027.1 - Advario - T300-04', pipeline: 'Sales netherlands', stage: 'Committed', owner: 'Niek van Oostenbrugge', amount: 3750, cost: 0, month: 4 },
  { name: '26-0031.1 - Terra drone Japan - X2 drone', pipeline: 'X1 hardware sales europe', stage: 'Quotation sent, big chance', owner: 'Kjeld Verhage', amount: 8000, cost: 0, month: 5 },
  { name: '26-0032.1 - Terra drone Indonesia - lease', pipeline: 'UT drone hardware sales', stage: 'Lead', owner: 'Niek van Oostenbrugge', amount: 3750, cost: 0, month: 6 },
  { name: '26-0040.1 - VOPAK Antwerpen - 3D scan', pipeline: 'Sales netherlands', stage: 'Operations briefed', owner: 'Steven Verver', amount: 3150, cost: 500, month: 7 },
  { name: '26-0055.3 - Shell Pernis - flare inspection', pipeline: 'Sales netherlands', stage: 'Committed', owner: 'julia van haren', amount: 12000, cost: 2000, month: 7 },
  { name: '26-0073.1 - TanQuid Germany - Duisburg T123', pipeline: 'Sales germany', stage: 'PO or Quote missing', owner: 'Steven Verver', amount: 5950, cost: 0, month: 8 },
  { name: '26-0061.2 - EVOS Hamburg - T0215 VT+UT', pipeline: 'Sales germany', stage: 'Operations briefed', owner: 'Steven Verver', amount: 8200, cost: 0, month: 8 },
  { name: '26-0070.1 - Liquin Botlek - VPB 5527', pipeline: 'Sales netherlands', stage: 'Can be invoiced', owner: 'Frans van Kogelenberg', amount: 1625, cost: 0, month: 8 },
  { name: '26-0075.4 - Galata Chemicals - Tank 11-40', pipeline: 'Sales netherlands', stage: 'Can be invoiced', owner: 'Niek van Oostenbrugge', amount: 1950, cost: 0, month: 9 },
  { name: '26-0113.1 - Stormvloedkering Ramspol - inwendig', pipeline: 'Sales netherlands', stage: 'Committed', owner: 'Steven Verver', amount: 20567, cost: 0, month: 9 },
  { name: '26-0080.1 - MODEC R&D - tether station', pipeline: 'FPSO', stage: 'Quotation sent, big chance', owner: 'Niek van Oostenbrugge', amount: 21267, cost: 0, month: 10 },
  { name: '26-0090.1 - Neste Maasvlakte - full OSI', pipeline: 'Sales netherlands', stage: 'Lead', owner: 'Steven Verver', amount: 8579, cost: 2460, month: 11 },
  { name: '26-0095.1 - BW Energy Pioneer Q4', pipeline: 'FPSO', stage: 'Committed', owner: 'Niek van Oostenbrugge', amount: 120000, cost: 40000, month: 12 },
  { name: '26-0099.1 - Bureau Veritas - Xross1 interest', pipeline: 'X1 hardware sales europe', stage: 'Paid', owner: 'Kjeld Verhage', amount: 23745, cost: 14997, month: 12 },
  { name: '26-0100.1 - Advario - framework quote', pipeline: 'Sales netherlands', stage: 'Suspect', owner: 'julia van haren', amount: 15000, cost: 0, month: 6 },
  { name: '26-0101.1 - Shell - cancelled tank job', pipeline: 'Sales netherlands', stage: 'Closed lost', owner: 'Frans van Kogelenberg', amount: 9000, cost: 0, month: 5 },
  { name: 'INSP_PR260001 - Fibrant schoorsteen A2151', pipeline: 'Sales netherlands', stage: 'Quotation request', owner: 'Steven Verver', amount: 7000, cost: 0, month: null },
];

function pad2(n: number) {
  return n < 10 ? '0' + n : String(n);
}

// Rough customer guess from a mock deal name (real data uses the HubSpot company).
function mockCustomer(name: string): string {
  const afterCode = name.replace(/^\s*(?:INSP_)?[A-Z0-9]+[-_.\d]*\s*[-–]?\s*/, '');
  const seg = afterCode.split(/\s[-–]\s/)[0].trim();
  return seg.split(/\s+/).slice(0, 2).join(' ') || 'Unknown';
}

export function buildMockDeals(year: number): DealRow[] {
  const now = new Date().toISOString();
  const pipeId = (label: string) => mockPipelines.find((p) => p.label === label)?.id || 'default';
  const ownerId = (name: string) => mockOwners.find((o) => o.name === name)?.id || '';

  return SEEDS.map((s, i) => {
    const id = `mock-${year}-${i + 1}`;
    const execDate = s.month ? `${year}-${pad2(s.month)}-15` : null;
    const execMonth = s.month ? `${year}-${pad2(s.month)}` : null;
    // close date roughly in the same month (or spread if no execution date)
    const closeMonth = s.month ?? ((i % 12) + 1);
    const closeDate = `${year}-${pad2(closeMonth)}-10T00:00:00.000Z`;
    return {
      id,
      year,
      deal_name: s.name,
      sales_pipeline: s.pipeline,
      pipeline_id: pipeId(s.pipeline),
      deal_stage: s.stage,
      stage_id: stageId(s.stage),
      owner: s.owner,
      owner_id: ownerId(s.owner),
      customer: mockCustomer(s.name),
      customer_id: '',
      deal_amount: s.amount,
      cost_of_sales: s.cost,
      margin: s.amount - s.cost,
      close_date: closeDate,
      execution_date: execDate,
      execution_month: execMonth,
      deal_link: `https://app.hubspot.com/contacts/${config.hubspotPortalId}/deals/${id}`,
      synced_at: now,
    } as DealRow;
  });
}
