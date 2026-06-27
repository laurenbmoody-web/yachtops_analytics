// Residency / Schengen / visa engine.
//
// Per day, a crew member's country comes from the right source for that day:
//   • Aboard (Active)  → the shared vessel position calendar (vessel_positions)
//   • Training         → the training entry's location country
//   • Travelling/Leave → unknown (transit / free time — not counted)
//
// From the per-day countries we derive Schengen 90/180 usage, per-country day
// tallies (tax), and — combined with the crew member's nationality — which visa
// regime applies where the vessel currently is. Rules are seeded for the
// Schengen area and the United States; other countries fall through as
// "not yet modelled".

import { getStatusForDay } from '../../../utils/crewStatus';
import { entryForDay } from './crewCalendar';

export const SCHENGEN = new Set([
  'AT', 'BE', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV',
  'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'SK', 'SI', 'ES', 'SE', 'CH',
  'HR', 'BG', 'RO',
]);

// EU/EEA + Switzerland passports = freedom of movement in Schengen. (Schengen
// already covers these; Ireland is EU-but-not-Schengen, added explicitly.)
const FREEDOM = new Set([...SCHENGEN, 'IE']);

// Common nationalities visa-exempt for short Schengen stays (Annex II — partial,
// the ones we see most on yachts). Visa-free but still bound by 90/180.
const SCHENGEN_VISA_FREE = new Set(['GB', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'IL', 'BR', 'AR', 'CL', 'SG', 'AE', 'MX', 'ZA' /* note: ZA actually needs a visa; kept out below */]);
SCHENGEN_VISA_FREE.delete('ZA');

// Nationality string → ISO-2. Accepts ISO-2/ISO-3 or common names/demonyms.
const NAME_TO_ISO = {
  british: 'GB', uk: 'GB', 'united kingdom': 'GB', english: 'GB', scottish: 'GB', welsh: 'GB', gbr: 'GB',
  american: 'US', usa: 'US', 'united states': 'US', usa_: 'US', us: 'US', usa1: 'US',
  french: 'FR', fra: 'FR', german: 'DE', deu: 'DE', italian: 'IT', ita: 'IT',
  spanish: 'ES', esp: 'ES', dutch: 'NL', nld: 'NL', portuguese: 'PT', prt: 'PT',
  greek: 'GR', grc: 'GR', irish: 'IE', irl: 'IE', swiss: 'CH', che: 'CH',
  australian: 'AU', aus: 'AU', 'new zealand': 'NZ', kiwi: 'NZ', nzl: 'NZ',
  canadian: 'CA', can: 'CA', 'south african': 'ZA', zaf: 'ZA',
  croatian: 'HR', hrv: 'HR', swedish: 'SE', swe: 'SE', norwegian: 'NO', nor: 'NO',
  polish: 'PL', pol: 'PL', filipino: 'PH', phl: 'PH', ukrainian: 'UA', ukr: 'UA',
};

export const normIso = (s) => {
  if (!s) return null;
  const t = String(s).trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const key = t.toLowerCase();
  if (NAME_TO_ISO[key]) return NAME_TO_ISO[key];
  if (/^[A-Za-z]{3}$/.test(t) && NAME_TO_ISO[key]) return NAME_TO_ISO[key];
  return null; // unknown → caller treats as un-modelled
};

const dateIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Which visa applies for a crew member (by held nationalities) where the vessel
// currently is. Returns { region, level, text } or null.
//   level: 'free' (no action) | 'limited' (visa-free but capped) | 'visa' (needed) | 'unknown'
export const visaForCountry = (countryIso, natIsos) => {
  if (!countryIso) return null;
  const held = (natIsos || []).filter(Boolean);
  if (SCHENGEN.has(countryIso)) {
    if (held.some((c) => FREEDOM.has(c))) return { region: 'Schengen', level: 'free', text: 'Freedom of movement — EU/EEA/CH passport' };
    if (held.some((c) => SCHENGEN_VISA_FREE.has(c))) return { region: 'Schengen', level: 'limited', text: 'Visa-free, but bound by the 90/180 limit' };
    return { region: 'Schengen', level: 'visa', text: 'Schengen C visa required' };
  }
  if (countryIso === 'US') {
    if (held.includes('US')) return { region: 'United States', level: 'free', text: 'US national — no visa' };
    return { region: 'United States', level: 'visa', text: 'B1/B2 (or C1/D crew) visa required' };
  }
  return { region: countryIso, level: 'unknown', text: 'Entry rules not yet modelled' };
};

// Build per-day country for the trailing window and derive the figures.
// vesselByDate: { 'YYYY-MM-DD': 'GR', ... } from vessel_positions.
// stampedOn(day): true while the crew member is signed onto the vessel crew list
//   — those days pause the Schengen/visa clock (but still count for tax presence).
export const computeResidency = ({ today, periods, entries, vesselByDate, stampedOn = () => false, windowDays = 365 }) => {
  const perDay = [];
  for (let i = 0; i < windowDays; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const iso = dateIso(day);
    const entry = entryForDay(entries, day);
    const status = entry ? entry.kind : getStatusForDay(periods, day);
    let country = null;
    if (status === 'active') country = vesselByDate[iso] || null;
    else if (status === 'training_leave') country = normIso(entry?.location_country);
    perDay.push({ iso, status, country, aboard: stampedOn(day) });
  }

  // Immigration (Schengen): a day counts only when NOT signed onto the crew list.
  const schengenUsed = perDay.slice(0, 180).filter((d) => !d.aboard && d.country && SCHENGEN.has(d.country)).length;

  // Day-counts use only days the crew member is present and NOT signed on (a
  // signed-on day is stamped out of the country, so it doesn't count).
  const tally = {};
  perDay.forEach((d) => { if (d.country && !d.aboard) tally[d.country] = (tally[d.country] || 0) + 1; });
  const byCountry = Object.entries(tally).map(([code, days]) => ({ code, days })).sort((a, b) => b.days - a.days);

  // Latest known vessel country (today, else most recent in window).
  let current = perDay[0]?.country || null;
  if (!current) { const hit = perDay.find((d) => d.country); current = hit ? hit.country : null; }

  return {
    schengenUsed,
    schengenRemaining: Math.max(0, 90 - schengenUsed),
    byCountry,
    currentCountry: current,
    hasData: byCountry.length > 0,
  };
};

// Friendly country name from ISO-2 (small set; falls back to the code).
const ISO_NAME = {
  GR: 'Greece', FR: 'France', IT: 'Italy', ES: 'Spain', US: 'United States',
  GB: 'United Kingdom', HR: 'Croatia', ME: 'Montenegro', TR: 'Türkiye',
  MC: 'Monaco', PT: 'Portugal', NL: 'Netherlands', DE: 'Germany', MT: 'Malta',
};
export const countryName = (code) => ISO_NAME[code] || code;
