import { Deal } from './api';

/**
 * Customer-name extraction for the Graphs tab.
 *
 * HubSpot deals don't always have an associated company, so when they don't we
 * derive the customer from the deal name. Deal names look like
 *   "<projectnr> - <Customer> - <description>"   (sometimes "<projectnr> <Customer> - …")
 *
 * This file is the growing "memory" from the guess-the-customer game: each time a
 * parse is corrected, encode it here so it sticks.
 *
 *  - PREFIX_ALIASES : if the parsed name STARTS WITH one of these (case-insensitive),
 *                     it collapses to the canonical name. Use for companies we always
 *                     want as ONE customer regardless of trailing site/project text.
 *                     Do NOT list companies we track per site (e.g. VOPAK) here.
 *  - EXACT_OVERRIDES: exact parsed string (lower-cased) -> canonical name, for odd
 *                     one-offs where the name isn't a normal "<code> - <customer>".
 */

// Learned 2026-09: Bureau Veritas and Mistras are always one customer;
// VOPAK is deliberately kept per site, so it is NOT listed here.
// MODEC is deliberately split into two customers ("MODEC" operational vs
// "MODEC R&D") — handled by modecCategory() below, so it is NOT listed here.
export const PREFIX_ALIASES: string[] = ['Bureau Veritas', 'Mistras'];

// Learned 2026-09: MODEC is two customers, not one:
//  - "MODEC R&D"                      : the R&D / engineering work we do for MODEC
//                                       Japan (R&D program, engineering hours, High
//                                       temperature drone, tether / EX ground
//                                       station, EMAT, SoW terms, lab reports,
//                                       Cable Reels ATEX).
//  - "MODEC Brazil FPSO inspections"  : the operational FPSO tank inspections — the
//                                       "MV<n> <tank> COT" jobs, WBT, Petrobras, and
//                                       the "MODEC Brazil/Inc part" deals.
// A MODEC deal is OPERATIONAL when its deal name contains a cargo/water tank code
// (COT / WBT), a vessel number (MV<digits>), or "Petrobras"; otherwise it is R&D.
// This holds even where R&D and inspections share one project number (e.g. 2025's
// INSP_PR250022.xx): the .00/.00A/.00B umbrella items are R&D, the MV<n> COT items
// operational. Validated 2026-09 against 72 MODEC deals (2024-2026): 38 op / 34 R&D.
const MODEC_R_AND_D = 'MODEC R&D';
const MODEC_OPERATIONAL_NAME = 'MODEC Brazil FPSO inspections';
const MODEC_OPERATIONAL = /\bCOT\b|\bWBT\b|MV\s?\d+|petrobras/i;

/**
 * If a deal is a MODEC deal, return which of the two MODEC customers it belongs to
 * ("MODEC Brazil FPSO inspections" or "MODEC R&D"); otherwise return null. Runs on
 * the FULL deal name because the deciding keywords (COT, MV<n>, R&D, …) can appear
 * anywhere in it.
 */
export function modecCategory(dealName: string): string | null {
  if (!/modec/i.test(dealName || '')) return null;
  return MODEC_OPERATIONAL.test(dealName) ? MODEC_OPERATIONAL_NAME : MODEC_R_AND_D;
}

export const EXACT_OVERRIDES: Record<string, string> = {
  // "Kanalbefliegung Warendorf" is a project description; the customer is Warendorf.
  'kanalbefliegung warendorf': 'Warendorf',
};

// KEYWORD_ALIASES: if the parsed name contains ALL keywords (case-insensitive), it
// collapses to `canonical`. Use to merge different SPELLINGS of the SAME customer/site
// (e.g. "VOPAK Vlaardingen", "Vopak Terminal Vlaardingen B.V.", "VOPAK Vlaardingen
// T2002"), while keeping genuinely different sites apart (Vlissingen ≠ Vlaardingen).
export const KEYWORD_ALIASES: { canonical: string; keywords: string[] }[] = [
  { canonical: 'VOPAK Vlaardingen', keywords: ['vopak', 'vlaardingen'] },
  { canonical: 'VOPAK Vlissingen', keywords: ['vopak', 'vlissingen'] },
];

// Leading project code: "26-0003.2", "26-0003.0.1", "26 - 0047.1",
// "INSP_PR250022.00A", and ranges like "26-0070.1.1 t/m 26-0070.1.7".
const PROJECT_CODE =
  /^\s*(?:INSP[_A-Za-z0-9.]*|\d{2,}\s*-\s*\d{2,}(?:\.\w+)*)(?:\s*(?:t\/m|t\.m|&|\+|,)\s*(?:INSP[_A-Za-z0-9.]*|\d{2,}\s*-\s*\d{2,}(?:\.\w+)*))*\s*[-–—:]?\s*/i;

export function deriveCustomerFromName(name: string): string {
  const s = (name || '').trim().replace(PROJECT_CODE, '');
  const parts = s.split(/\s+[-–—]\s+/);
  let cust = (parts[0] || '').trim();
  if (parts.length === 1) cust = cust.split(/\s+/).slice(0, 2).join(' ');
  cust = cust.trim();
  return /[A-Za-z]{2}/.test(cust) ? cust : '';
}

export function canonicalCustomer(raw: string): string {
  const r = (raw || '').trim();
  const lo = r.toLowerCase();
  const over = EXACT_OVERRIDES[lo];
  if (over) return over;
  for (const k of KEYWORD_ALIASES) {
    if (k.keywords.every((w) => lo.includes(w.toLowerCase()))) return k.canonical;
  }
  for (const a of PREFIX_ALIASES) {
    if (lo.startsWith(a.toLowerCase())) return a;
  }
  return r;
}

/**
 * The customer for a deal: the associated HubSpot company when present, otherwise
 * the name parsed from the deal name — then run through the alias/override rules.
 */
export function customerOf(deal: Deal): string {
  // MODEC splits into two customers based on the deal name — decide that first.
  const modec = modecCategory(deal.deal_name);
  if (modec) return modec;
  const base = (deal.customer && deal.customer.trim()) || deriveCustomerFromName(deal.deal_name);
  return canonicalCustomer(base) || 'Unknown';
}
