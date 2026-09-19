import { Deal } from './api';

// Rules come from the backend (stored in the DB, see server/src/countryRules.ts) and
// are applied here, client-side, so the map stays consistent with the active filters.
export interface CountryRules {
  version: number;
  pipelineCountry: Record<string, string>;
  nameRules: { contains: string; country: string }[];
  provinceRules?: { contains: string; province: string }[]; // NL city/site -> province (statnaam)
  stateRules?: { contains: string; state: string }[]; // DE city/site -> Bundesland (geojson 'name')
  fallback: string;
}

// Derive a deal's ISO-2 country. Order: deal-name rules (overrides) → pipeline default
// → fallback (''/Unknown). All matching is case-insensitive.
export function countryOf(d: Deal, rules?: CountryRules | null): string {
  if (!rules) return '';
  const name = (d.deal_name || '').toLowerCase();
  for (const r of rules.nameRules || []) {
    if (r.contains && name.includes(r.contains.toLowerCase())) return r.country;
  }
  const pipe = (d.sales_pipeline || '').trim().toLowerCase();
  if (rules.pipelineCountry && rules.pipelineCountry[pipe]) return rules.pipelineCountry[pipe];
  return rules.fallback || '';
}

// Derive the NL province (statnaam, matching the provinces GeoJSON) for a deal, from a
// recognisable city / industrial site in its name. Only meaningful for NL deals; returns
// '' (Unknown province) when no city is recognised. First match wins.
export function provinceOf(d: Deal, rules?: CountryRules | null): string {
  if (!rules || !rules.provinceRules) return '';
  const name = (d.deal_name || '').toLowerCase();
  for (const r of rules.provinceRules) {
    if (r.contains && name.includes(r.contains.toLowerCase())) return r.province;
  }
  return '';
}

// Derive the DE Bundesland (matching the states GeoJSON 'name') for a deal, from a
// city/site in its name. Only meaningful for DE deals; '' = Unknown state.
export function stateOf(d: Deal, rules?: CountryRules | null): string {
  if (!rules || !rules.stateRules) return '';
  const name = (d.deal_name || '').toLowerCase();
  for (const r of rules.stateRules) {
    if (r.contains && name.includes(r.contains.toLowerCase())) return r.state;
  }
  return '';
}

// ISO-2 → display name (matching the ECharts world GeoJSON names) + an approx centre
// [lon, lat] used to frame the map when drilling into a country.
export const COUNTRY_META: Record<string, { name: string; lon: number; lat: number }> = {
  NL: { name: 'Netherlands', lon: 5.3, lat: 52.15 },
  DE: { name: 'Germany', lon: 10.4, lat: 51.2 },
  BE: { name: 'Belgium', lon: 4.5, lat: 50.6 },
  FR: { name: 'France', lon: 2.5, lat: 46.6 },
  ES: { name: 'Spain', lon: -3.7, lat: 40.2 },
  GB: { name: 'United Kingdom', lon: -1.5, lat: 52.8 },
  DK: { name: 'Denmark', lon: 9.5, lat: 56.0 },
  NO: { name: 'Norway', lon: 8.5, lat: 61.0 },
  TR: { name: 'Turkey', lon: 35.0, lat: 39.0 },
  SK: { name: 'Slovakia', lon: 19.5, lat: 48.7 },
  BR: { name: 'Brazil', lon: -51.9, lat: -14.2 },
  ID: { name: 'Indonesia', lon: 118.0, lat: -2.5 },
  JP: { name: 'Japan', lon: 138.0, lat: 36.5 },
  AO: { name: 'Angola', lon: 17.9, lat: -11.2 },
  US: { name: 'United States', lon: -98.0, lat: 39.5 },
  CN: { name: 'China', lon: 104.0, lat: 35.9 },
  IT: { name: 'Italy', lon: 12.5, lat: 42.8 },
  PL: { name: 'Poland', lon: 19.1, lat: 52.1 },
  AT: { name: 'Austria', lon: 14.5, lat: 47.6 },
  CH: { name: 'Switzerland', lon: 8.2, lat: 46.8 },
  SE: { name: 'Sweden', lon: 15.0, lat: 62.0 },
  GR: { name: 'Greece', lon: 22.0, lat: 39.0 },
  RO: { name: 'Romania', lon: 25.0, lat: 45.9 },
  PT: { name: 'Portugal', lon: -8.0, lat: 39.5 },
  SN: { name: 'Senegal', lon: -14.5, lat: 14.5 },
  OM: { name: 'Oman', lon: 56.0, lat: 21.0 },
  GA: { name: 'Gabon', lon: 11.6, lat: -0.8 },
  SA: { name: 'Saudi Arabia', lon: 45.0, lat: 24.0 },
};

// name (as used by the GeoJSON / our meta) helper
export function countryName(code: string): string {
  return COUNTRY_META[code]?.name || code;
}

// The 12 NL provinces and 16 DE Bundesländer (names match the GeoJSON), used to populate
// the dropdowns in the post-refresh "assign location" modal.
export const NL_PROVINCES = [
  'Groningen', 'Fryslân', 'Drenthe', 'Overijssel', 'Flevoland', 'Gelderland', 'Utrecht',
  'Noord-Holland', 'Zuid-Holland', 'Zeeland', 'Noord-Brabant', 'Limburg',
];
export const DE_STATES = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen',
  'Mecklenburg-Vorpommern', 'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz',
  'Saarland', 'Sachsen', 'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
];

// Guess a rule keyword from a deal name: strip a leading project code
// ("26-0001.2 - " or "INSP_PR250219 - "), then take the first name segment.
export function guessKeyword(dealName: string): string {
  let s = (dealName || '').replace(/^\s*(?:INSP_PR[0-9.]+[A-Z]?|\d{2}-\d+(?:\.\d+)?)\s*[-–]?\s*/i, '');
  s = s.split(/\s+[-–]\s+/)[0].trim();
  return s.toLowerCase().slice(0, 40);
}
