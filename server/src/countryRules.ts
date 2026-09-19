import { getSetting, setSetting } from './db';

// Country-derivation rules, stored in the database so they can be extended later
// without a code change. A deal's country is derived (client-side, from these rules)
// in this order of precedence:
//   1. nameRules   — a substring in the DEAL NAME wins (overrides everything).
//                    Used for explicit exceptions (e.g. "Antwerpen" -> BE) and for
//                    X1-hardware customers whose country we recognise by name.
//   2. pipelineCountry — the deal's sales pipeline maps to a default country
//                    (Sales Netherlands -> NL, Sales germany -> DE).
//   3. fallback    — otherwise "Unknown" (empty string), until a rule is added.
//
// All matching is case-insensitive. To add a country, just add a nameRule or a
// pipeline mapping — no code change needed.

export interface CountryRules {
  version: number;
  pipelineCountry: Record<string, string>; // lowercased pipeline label -> ISO2
  nameRules: { contains: string; country: string }[]; // substring in deal name -> ISO2 (first match wins)
  // For NL deals only: derive the province from a recognisable city / industrial site
  // in the deal name. A substring in the deal name -> province (statnaam, matching the
  // NL provinces GeoJSON). First match wins; unmatched NL deals show as "Unknown province".
  // Extend this list as more locations are recognised — no code change needed.
  provinceRules?: { contains: string; province: string }[];
  // For DE deals only: derive the Bundesland (federal state) from a city / site in the
  // deal name. A substring -> state name (matching the DE Bundesländer GeoJSON 'name').
  // First match wins; unmatched DE deals show as "Unknown state". Same idea as
  // provinceRules, extend as needed.
  stateRules?: { contains: string; state: string }[];
  fallback: string; // '' = Unknown
}


const DEFAULT_RULES: CountryRules = {
  version: 19,
  pipelineCountry: {
    'sales netherlands': 'NL',
    'sales germany': 'DE',
  },
  nameRules: [
    // --- FPSO (order matters: MODEC R&D before the generic MODEC rule) ---
    { contains: 'modec r&d', country: 'JP' }, // MODEC R&D -> Japan
    { contains: 'modec high temperature drone', country: 'JP' }, // R&D work -> Japan
    { contains: 'modec above uel', country: 'JP' }, // R&D/engineering -> Japan
    { contains: 'modec', country: 'BR' }, // other MODEC (MV COT field inspections, Petrobras) -> Brazil
    { contains: 'oap', country: 'AO' }, // OAP Angola & OAP PSVM (offshore Angola)
    { contains: 'angola', country: 'AO' },
    { contains: 'pioneer', country: 'US' },
    { contains: 'mv22', country: 'BR' }, // MODEC MV22 — Brazil [confirmed by Steven]
    { contains: 'mv30', country: 'BR' }, // MODEC MV30 — Brazil [confirmed by Steven]
    { contains: 'adolo', country: 'GA' }, // BW Energy FPSO Adolo — Gabon [confirmed by Steven]
    { contains: 'senegal', country: 'SN' }, // BP FPSO project Senegal [confirmed by Steven]
    { contains: 'aramco', country: 'SA' }, // Saudi Aramco [confirmed by Steven]
    { contains: 'tdjpn', country: 'JP' }, // Terra Drone Japan (TDJPN) [confirmed by Steven]
    // --- explicit exceptions on otherwise-NL/DE deals (site is abroad) ---
    { contains: 'antwerpen', country: 'BE' },
    { contains: 'antwerp', country: 'BE' },
    { contains: 'hamburg', country: 'DE' }, // EVOS Hamburg — site is Germany (filed under Sales Netherlands)
    { contains: 'enport', country: 'DE' }, // Enport — Hamburg (Germany) [confirmed by Steven]
    { contains: 'gelsenkirchen', country: 'DE' }, // Scholven / Ruhröl-BP Gelsenkirchen — Germany
    { contains: 'moers', country: 'DE' }, // Media 360 — Moers, Germany
    { contains: 'aachen', country: 'DE' }, // Media 360 — Kanalbefliegung Aachen, Germany
    { contains: 'beernem', country: 'BE' }, // SFA — Beernem silo (Belgium)
    { contains: 'feluy', country: 'BE' }, // Total Feluy — site is Belgium
    { contains: 'total belgie', country: 'BE' }, // Total Belgium
    { contains: 'innovyn sur sambre', country: 'BE' }, // Innovyn/Inovyn sur Sambre — Belgium
    { contains: 'terra drone japan', country: 'JP' }, // Terra Drone Japan work
    { contains: 'alcom', country: 'SN' }, // Alcom Energy Services — Senegal [confirmed by Steven]
    { contains: 'bp gta', country: 'SN' }, // BP GTA (Greater Tortue Ahmeyim) — Senegal [confirmed by Steven]
    { contains: 'unifly', country: 'BE' }, // Unifly (drone-in-a-box) — Antwerp [confirmed by Steven]
    // --- UT drone hardware sales / Terra Drone Indonesia ---
    { contains: 'tdbr', country: 'BR' },
    { contains: 'tdid', country: 'ID' },
    { contains: 'terra drone indonesia', country: 'ID' },
    { contains: 'jakarta', country: 'ID' },
    { contains: 'indonesia', country: 'ID' },
    // --- X1 hardware sales Europe: recognised customers -> country ---
    { contains: 'generalitat de catalunya', country: 'ES' },
    { contains: 'géolithe', country: 'FR' },
    { contains: 'geolithe', country: 'FR' },
    { contains: 'mistras france', country: 'FR' },
    { contains: 'bureau veritas group lille', country: 'FR' },
    { contains: 'bureau veritas group turkiye', country: 'TR' },
    { contains: 'bureau veritas group uk', country: 'GB' },
    { contains: 'bureau veritas group rotterdam', country: 'NL' },
    { contains: 'bv denmark', country: 'DK' },
    { contains: 'novonesis', country: 'DK' },
    { contains: 'uasvoss', country: 'NO' },
    { contains: 's&t ndt', country: 'IT' }, // S&T NDT S.r.l. — X1 distributor Italy [confirmed by Steven]
    { contains: 'esbaar', country: 'OM' }, // Esbaar — X1 distributor Oman [confirmed by Steven]
    { contains: 'dnv', country: 'NO' },
    { contains: 'volvo cars slovakia', country: 'SK' },
    // --- X1 hardware: country mentioned in the deal name ---
    { contains: 'china', country: 'CN' },
    { contains: 'greece', country: 'GR' },
    { contains: 'romania', country: 'RO' },
    { contains: 'france', country: 'FR' },
    { contains: '- uk', country: 'GB' },
    { contains: 'spain', country: 'ES' },
    { contains: 'denmark', country: 'DK' },
    { contains: 'austria', country: 'AT' },
    { contains: 'belgium', country: 'BE' },
    // --- X1 customers without a country in the name (confirmed by Steven).
    //     Order: 'bureau veritas' must precede 'spare parts' so BV spare-parts -> FR,
    //     while the standalone "Spare parts - Xross 1" -> IT. ---
    { contains: 'geofix', country: 'SE' },
    { contains: 'volvo cars', country: 'SK' },
    { contains: 'bureau veritas', country: 'FR' }, // generic BV (after all specific BV/country rules)
    { contains: 'spare parts', country: 'IT' }, // standalone spare parts invoice -> Italy
  ],
  // NL city / industrial-site -> province (statnaam). Only applied to deals whose
  // country resolves to NL. Distinctive substrings only (short/ambiguous town names
  // like "born", "oss", "goes", "ede", "tiel", "weert" are intentionally left out to
  // avoid false matches). Order: more specific phrases before generic ones.
  provinceRules: [
    // --- Zuid-Holland (Rotterdam port cluster & surroundings) ---
    { contains: 'botlek', province: 'Zuid-Holland' },
    { contains: 'maasvlakte', province: 'Zuid-Holland' },
    { contains: 'pernis', province: 'Zuid-Holland' },
    { contains: 'europoort', province: 'Zuid-Holland' },
    { contains: 'vondelingen', province: 'Zuid-Holland' }, // Vondelingenplaat
    { contains: 'rotterdam', province: 'Zuid-Holland' },
    { contains: 'vlaardingen', province: 'Zuid-Holland' },
    { contains: 'schiedam', province: 'Zuid-Holland' },
    { contains: 'dordrecht', province: 'Zuid-Holland' },
    { contains: 'spijkenisse', province: 'Zuid-Holland' },
    { contains: 'gouda', province: 'Zuid-Holland' }, // Cargill Gouda
    { contains: 'nieuwe maas', province: 'Zuid-Holland' }, // Chane Nieuwe Maas Terminal (Rotterdam)
    { contains: 'zuid beijerland', province: 'Zuid-Holland' }, // Unite2Build — Zuid-Beijerland (Hoeksche Waard)
    { contains: 'maassluis', province: 'Zuid-Holland' },
    { contains: 'hoek van holland', province: 'Zuid-Holland' },
    { contains: 'den haag', province: 'Zuid-Holland' },
    { contains: "'s-gravenhage", province: 'Zuid-Holland' },
    { contains: 'leiden', province: 'Zuid-Holland' },
    { contains: 'delft', province: 'Zuid-Holland' },
    // --- Noord-Brabant ---
    { contains: 'moerdijk', province: 'Noord-Brabant' },
    { contains: 'bergen op zoom', province: 'Noord-Brabant' },
    { contains: 'geertruidenberg', province: 'Noord-Brabant' },
    { contains: 'klundert', province: 'Noord-Brabant' },
    { contains: 'zevenbergen', province: 'Noord-Brabant' },
    { contains: 'roosendaal', province: 'Noord-Brabant' },
    { contains: 'breda', province: 'Noord-Brabant' },
    { contains: 'tilburg', province: 'Noord-Brabant' },
    { contains: 'eindhoven', province: 'Noord-Brabant' },
    { contains: "'s-hertogenbosch", province: 'Noord-Brabant' },
    { contains: 'den bosch', province: 'Noord-Brabant' },
    // --- Zeeland (Terneuzen / Vlissingen canal zone) ---
    { contains: 'vlissingen', province: 'Zeeland' },
    { contains: 'terneuzen', province: 'Zeeland' },
    { contains: 'sluiskil', province: 'Zeeland' },
    { contains: 'hansweert', province: 'Zeeland' },
    { contains: 'sas van gent', province: 'Zeeland' },
    { contains: 'borssele', province: 'Zeeland' },
    { contains: 'borsele', province: 'Zeeland' },
    { contains: 'nieuwdorp', province: 'Zeeland' },
    { contains: 'yerseke', province: 'Zeeland' },
    { contains: 'middelburg', province: 'Zeeland' },
    { contains: 'wemeldinge', province: 'Zeeland' }, // Ecotank Wemeldinge
    { contains: 'zeeland refinery', province: 'Zeeland' }, // Zeeland Refinery (Nieuwdorp/Vlissingen-Oost)
    // --- Groningen ---
    { contains: 'delfzijl', province: 'Groningen' },
    { contains: 'eemshaven', province: 'Groningen' },
    { contains: 'farmsum', province: 'Groningen' },
    { contains: 'groningen', province: 'Groningen' },
    // --- Noord-Holland ---
    { contains: 'amsterdam', province: 'Noord-Holland' },
    { contains: 'ijmuiden', province: 'Noord-Holland' },
    { contains: 'velsen', province: 'Noord-Holland' },
    { contains: 'beverwijk', province: 'Noord-Holland' },
    { contains: 'den helder', province: 'Noord-Holland' },
    { contains: 'zaandam', province: 'Noord-Holland' },
    { contains: 'alkmaar', province: 'Noord-Holland' },
    { contains: 'haarlem', province: 'Noord-Holland' },
    // --- Gelderland ---
    { contains: 'zaltbommel', province: 'Gelderland' },
    { contains: 'zaltbomel', province: 'Gelderland' }, // common misspelling of Zaltbommel (Seqora/Sequora)
    { contains: 'arnhem', province: 'Gelderland' },
    { contains: 'nijmegen', province: 'Gelderland' },
    { contains: 'apeldoorn', province: 'Gelderland' },
    { contains: 'culemborg', province: 'Gelderland' },
    { contains: 'harderwijk', province: 'Gelderland' },
    { contains: 'wageningen', province: 'Gelderland' },
    { contains: 'zevenaar', province: 'Gelderland' },
    // --- Overijssel ---
    { contains: 'ramspol', province: 'Overijssel' },
    { contains: 'zwolle', province: 'Overijssel' },
    { contains: 'enschede', province: 'Overijssel' },
    { contains: 'hengelo', province: 'Overijssel' },
    { contains: 'deventer', province: 'Overijssel' },
    { contains: 'almelo', province: 'Overijssel' },
    { contains: 'kampen', province: 'Overijssel' },
    // --- Utrecht ---
    { contains: 'utrecht', province: 'Utrecht' },
    { contains: 'amersfoort', province: 'Utrecht' },
    { contains: 'nieuwegein', province: 'Utrecht' },
    { contains: 'veenendaal', province: 'Utrecht' },
    // --- Flevoland ---
    { contains: 'almere', province: 'Flevoland' },
    { contains: 'lelystad', province: 'Flevoland' },
    { contains: 'dronten', province: 'Flevoland' },
    { contains: 'emmeloord', province: 'Flevoland' },
    // --- Drenthe ---
    { contains: 'emmen', province: 'Drenthe' },
    { contains: 'hoogeveen', province: 'Drenthe' },
    { contains: 'assen', province: 'Drenthe' },
    { contains: 'meppel', province: 'Drenthe' },
    // --- Fryslân ---
    { contains: 'leeuwarden', province: 'Fryslân' },
    { contains: 'drachten', province: 'Fryslân' },
    { contains: 'heerenveen', province: 'Fryslân' },
    { contains: 'harlingen', province: 'Fryslân' },
    { contains: 'sneek', province: 'Fryslân' },
    // --- Limburg ---
    { contains: 'chemelot', province: 'Limburg' },
    { contains: 'geleen', province: 'Limburg' },
    { contains: 'sittard', province: 'Limburg' },
    { contains: 'maastricht', province: 'Limburg' },
    { contains: 'venlo', province: 'Limburg' },
    { contains: 'roermond', province: 'Limburg' },
    { contains: 'heerlen', province: 'Limburg' },
    { contains: 'steyl', province: 'Limburg' }, // Steyl (part of Venlo)
    // --- end-customer rules: province derived from the customer's OWN site
    //     (customer/site is not stored in the deal data, only in the deal name).
    //     Confirmed by Steven or researched to a single site. NOTE: only for companies
    //     whose own plant is inspected. Partners/subcontractors (ROSEN, UTQuality, Array
    //     Industries, Falcker, Unite2Build, Mistras) are deliberately NOT listed here —
    //     their deals name the real third-party site, which the city rules above catch. ---
    { contains: 'argent', province: 'Noord-Holland' }, // Argent Energy / Tank Storage Argent — Amsterdam
    { contains: 'klm', province: 'Noord-Holland' }, // KLM — Schiphol / Amstelveen
    { contains: 'icl group', province: 'Noord-Holland' }, // ICL Group — Amsterdam [confirmed by Steven]
    { contains: 'theo pouw', province: 'Groningen' }, // Theo Pouw — Eemshaven [confirmed by Steven]
    { contains: 'vtti', province: 'Zuid-Holland' }, // VTTI / Euro Tank Terminal — Europoort, Rotterdam
    { contains: 'wilmar', province: 'Zuid-Holland' }, // Wilmar Oleochemicals — Rotterdam
    { contains: 'shinetsu', province: 'Zuid-Holland' }, // Shin-Etsu PVC — Pernis/Botlek (Rotterdam)
    { contains: 'shin-etsu', province: 'Zuid-Holland' },
    { contains: 'paebbl', province: 'Zuid-Holland' }, // Paebbl — Rotterdam (RDM)
    { contains: 'agf nitrogen', province: 'Zuid-Holland' }, // AGF Nitrogen — Europoort, Rotterdam
    { contains: 'aglobis', province: 'Zuid-Holland' }, // Aglobis — Rotterdam [confirmed by Steven]
    { contains: 'alco energy', province: 'Zuid-Holland' }, // Alco Energy — Rotterdam [confirmed by Steven]
    { contains: 'air liquide benelux', province: 'Zuid-Holland' }, // Air Liquide Benelux — Rotterdam (this deal) [confirmed by Steven]
    { contains: 'advario', province: 'Zuid-Holland' }, // Advario — Rotterdam [confirmed by Steven]
    { contains: 'liquin', province: 'Zuid-Holland' }, // Liquin Terminal TTR — Rotterdam [confirmed by Steven]
    { contains: 'cosun beet', province: 'Noord-Brabant' }, // Cosun Beet Company — Dinteloord [confirmed by Steven]
    { contains: 'inspectron', province: 'Noord-Brabant' }, // Inspectron — Dinteloord [confirmed by Steven]
    { contains: 'galata', province: 'Zeeland' }, // Galata Chemicals Netherlands [confirmed by Steven]
    { contains: 'verbrugge', province: 'Zeeland' }, // (ERP) Verbrugge Terminals — Vlissingen/Terneuzen [confirmed by Steven]
    { contains: 'bakelite', province: 'Zuid-Holland' }, // EQUANS — Bakelite, Rotterdam [confirmed by Steven]
    { contains: 'kleiwarenfabriek', province: 'Zuid-Holland' }, // Unite2Build — Groenendijk / Hazerswoude-Rijndijk [confirmed by Steven]
    { contains: 'rosen', province: 'Noord-Holland' }, // site-less ROSEN = AFS Schiphol; ROSEN's other sites are caught by the city rules above [confirmed by Steven]
    { contains: 'ebert hera', province: 'Limburg' }, // Ebert Hera — Chemelot (this deal) [confirmed by Steven]
    { contains: 'gw leidingtechniek', province: 'Limburg' }, // GW — Steyl/Limburg
    { contains: 'gw rioolinspectie', province: 'Limburg' }, // GW Rioolinspectie — Limburg [confirmed by Steven]
    { contains: 'fibrant', province: 'Limburg' }, // Fibrant — Chemelot [confirmed by Steven]
    { contains: 'usg', province: 'Limburg' }, // USG — Chemelot [confirmed by Steven]
    { contains: 'sabic', province: 'Limburg' }, // Sabic — Geleen/Chemelot [confirmed by Steven] (city rules catch other Sabic sites first)
    { contains: 'limburg', province: 'Limburg' }, // generic mention, last
  ],
  // DE city / site -> Bundesland (matches the Bundesländer GeoJSON 'name'). Only applied
  // to deals whose country resolves to DE. First match wins. Distinctive substrings only.
  stateRules: [
    { contains: 'hamburg', state: 'Hamburg' }, // EVOS / Enport Hamburg
    { contains: 'frankfurt', state: 'Hessen' }, // Enport Tanklager Frankfurt (am Main) — must precede the generic 'enport' rule
    { contains: 'kiel', state: 'Schleswig-Holstein' }, // UTG — tanks in Kiel [confirmed by Steven]
    { contains: 'enport', state: 'Hamburg' }, // Enport defaults to Hamburg unless Frankfurt is named [confirmed by Steven]
    { contains: 'lingen', state: 'Niedersachsen' }, // BP Lingen (Ems)
    { contains: 'nürnberg', state: 'Bayern' }, // TanQuid Nürnberg
    { contains: 'nurnberg', state: 'Bayern' },
    // --- Nordrhein-Westfalen (Ruhrgebiet & omgeving) ---
    { contains: 'gelsenkirchen', state: 'Nordrhein-Westfalen' }, // Ruhröl-BP / Scholven
    { contains: 'duisburg', state: 'Nordrhein-Westfalen' }, // TanQuid / Media 360 Duisburg
    { contains: 'datteln', state: 'Nordrhein-Westfalen' }, // Uniper Kraftwerk Datteln
    { contains: 'moers', state: 'Nordrhein-Westfalen' }, // Media 360 Moers
    { contains: 'aachen', state: 'Nordrhein-Westfalen' }, // Kanalbefliegung Aachen
    { contains: 'warendorf', state: 'Nordrhein-Westfalen' }, // Kanalbefliegung Warendorf
    { contains: 'marl', state: 'Nordrhein-Westfalen' }, // Chemiepark Marl
  ],
  fallback: '',
};

// User-added rules (from the "assign location" modal after a refresh) live in their own
// DB key so a code-side version bump of DEFAULT_RULES never wipes them. They are merged
// on top of the code defaults at read time.
const USER_KEY = 'country.rules.user';

interface UserRules {
  nameRules: { contains: string; country: string }[];
  provinceRules: { contains: string; province: string }[];
  stateRules: { contains: string; state: string }[];
}

function emptyUser(): UserRules {
  return { nameRules: [], provinceRules: [], stateRules: [] };
}

function readUserRules(): UserRules {
  const raw = getSetting(USER_KEY);
  if (!raw) return emptyUser();
  try {
    const p = JSON.parse(raw) || {};
    return {
      nameRules: Array.isArray(p.nameRules) ? p.nameRules : [],
      provinceRules: Array.isArray(p.provinceRules) ? p.provinceRules : [],
      stateRules: Array.isArray(p.stateRules) ? p.stateRules : [],
    };
  } catch {
    return emptyUser();
  }
}

/**
 * Effective rules = code defaults + user additions. User rules are appended AFTER the
 * defaults so the (more specific) defaults still win on first-match; the user rules only
 * catch deals the defaults did not. This is the merge that lets the modal persist rules.
 */
export function getCountryRules(): CountryRules {
  const u = readUserRules();
  return {
    version: DEFAULT_RULES.version,
    pipelineCountry: DEFAULT_RULES.pipelineCountry,
    nameRules: [...DEFAULT_RULES.nameRules, ...u.nameRules],
    provinceRules: [...(DEFAULT_RULES.provinceRules || []), ...u.provinceRules],
    stateRules: [...(DEFAULT_RULES.stateRules || []), ...u.stateRules],
    fallback: DEFAULT_RULES.fallback,
  };
}

/** Append user rules (deduped, sanitised) and return the new effective rules. */
export function addUserCountryRules(add: Partial<UserRules>): CountryRules {
  const u = readUserRules();
  const clean = (s: any) => (typeof s === 'string' ? s.trim() : '');
  const merge = (existing: any[], incoming: any[] | undefined, targetKey: 'country' | 'province' | 'state') => {
    const seen = new Set(existing.map((x) => (x.contains || '').toLowerCase()));
    for (const it of incoming || []) {
      const contains = clean(it?.contains).toLowerCase();
      const target = clean(it?.[targetKey]);
      if (contains && target && !seen.has(contains)) {
        existing.push({ contains, [targetKey]: target });
        seen.add(contains);
      }
    }
    return existing;
  };
  const next: UserRules = {
    nameRules: merge(u.nameRules, add.nameRules, 'country'),
    provinceRules: merge(u.provinceRules, add.provinceRules, 'province'),
    stateRules: merge(u.stateRules, add.stateRules, 'state'),
  };
  setSetting(USER_KEY, JSON.stringify(next));
  return getCountryRules();
}
