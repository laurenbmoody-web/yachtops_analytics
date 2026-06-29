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
import { resolveCountry } from './airports';

export const SCHENGEN = new Set([
  'AT', 'BE', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IT', 'LV',
  'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'SK', 'SI', 'ES', 'SE', 'CH',
  'HR', 'BG', 'RO',
]);

// Passport buckets used by the visa rules below. Approximate and weighted to the
// nationalities/destinations seen on yachts; unmodelled cases fall through to
// "check entry requirements" rather than guessing.
const EEA_CH = new Set([...SCHENGEN, 'IE']); // freedom of movement (EU/EEA/CH)
const SCHENGEN_EXEMPT = new Set(['GB', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'IL', 'BR', 'AR', 'CL', 'SG', 'AE', 'MX', 'HK', 'TW', 'BN', 'MY']);
const US_VWP = new Set([...EEA_CH, 'GB', 'JP', 'KR', 'AU', 'NZ', 'SG', 'CL', 'BN', 'TW']);
const UK_VISA_FREE = new Set([...EEA_CH, 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'IL', 'HK', 'TW', 'MY', 'BR', 'AR', 'CL', 'MX']);
const UAE_VOA = new Set([...EEA_CH, 'GB', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'HK', 'MY', 'IL']);
const TR_VISA_FREE = new Set([...EEA_CH, 'GB', 'JP', 'KR', 'SG', 'NZ', 'BR', 'AR']);
const BROAD_VISA_FREE = new Set([...EEA_CH, 'GB', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'IL']); // Caribbean, Montenegro, etc.
const CARIBBEAN = new Set(['BS', 'SX', 'AG', 'LC', 'BB', 'TC', 'AW', 'GP', 'MQ']);

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
export const visaForCountry = (dest, natIsos) => {
  if (!dest) return null;
  const nats = (natIsos || []).filter(Boolean);
  const some = (set) => nats.some((n) => set.has(n));
  const name = countryName(dest);

  // A national of the destination needs nothing (covers dual passports too).
  if (nats.includes(dest)) return { region: name, level: 'free', text: `${name} national — no visa` };

  if (SCHENGEN.has(dest)) {
    if (some(EEA_CH)) return { region: 'Schengen', level: 'free', text: 'Freedom of movement — EU/EEA/CH passport' };
    if (some(SCHENGEN_EXEMPT)) return { region: 'Schengen', level: 'limited', text: 'Visa-free, but bound by the 90/180 limit' };
    return { region: 'Schengen', level: 'visa', text: 'Schengen C visa required' };
  }
  if (dest === 'US' || dest === 'VI' || dest === 'PR') {
    if (some(US_VWP)) return { region: 'United States', level: 'limited', text: 'ESTA / visa waiver — 90 days (crew: C1/D)' };
    return { region: 'United States', level: 'visa', text: 'B1/B2 (or C1/D crew) visa required' };
  }
  if (dest === 'GB') {
    if (some(UK_VISA_FREE)) return { region: 'United Kingdom', level: 'limited', text: 'Visa-free visit — up to 6 months' };
    return { region: 'United Kingdom', level: 'visa', text: 'UK visa required' };
  }
  if (dest === 'AE') {
    if (some(UAE_VOA)) return { region: 'UAE', level: 'limited', text: 'Visa on arrival — 30–90 days' };
    return { region: 'UAE', level: 'visa', text: 'UAE visa required' };
  }
  if (dest === 'TR') {
    if (some(TR_VISA_FREE)) return { region: 'Türkiye', level: 'limited', text: 'Visa-free — 90 days in 180' };
    return { region: 'Türkiye', level: 'visa', text: 'Türkiye e-Visa required' };
  }
  if (dest === 'ME' || dest === 'GI') {
    if (some(BROAD_VISA_FREE)) return { region: name, level: 'limited', text: 'Visa-free visit — up to 90 days' };
    return { region: name, level: 'visa', text: 'Visa required' };
  }
  if (CARIBBEAN.has(dest)) {
    if (some(BROAD_VISA_FREE)) return { region: name, level: 'limited', text: 'Visa-free visit — typically 90–180 days' };
    return { region: name, level: 'unknown', text: 'Check entry requirements' };
  }
  return { region: name, level: 'unknown', text: 'Entry rules not yet modelled' };
};

// Build per-day country for the trailing window and derive the figures.
// vesselByDate: { 'YYYY-MM-DD': 'GR', ... } from vessel_positions.
// stampedOn(day): true while the crew member is signed onto the vessel crew list
//   — those days pause the Schengen/visa clock (but still count for tax presence).
export const computeResidency = ({ today, periods, entries, vesselByDate, stampedOn = () => false, windowDays = 365 }) => {
  // Travel legs, oldest first — each is a flight/ferry into a country. Ashore
  // days take the country of the last inbound leg (you're there until you leave).
  const legs = (entries || [])
    .filter((e) => e.kind === 'travelling')
    .map((e) => ({ sd: String(e.start_date).slice(0, 10), to: resolveCountry(e.to_location), from: resolveCountry(e.from_location) }))
    .sort((a, b) => a.sd.localeCompare(b.sd));
  const arrivalAsOf = (iso) => {
    let c = null;
    for (const lg of legs) { if (lg.sd <= iso) { if (lg.to) c = lg.to; } else break; }
    return c;
  };

  const perDay = [];
  for (let i = 0; i < windowDays; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const iso = dateIso(day);
    const entry = entryForDay(entries, day);
    const status = entry ? entry.kind : getStatusForDay(periods, day);
    let country = null;
    if (status === 'active') {
      // Aboard → the vessel's AIS position (handles sea crossings between countries).
      country = vesselByDate[iso] || null;
    } else if (status === 'travelling' && entry) {
      // A travel day counts as the Schengen side if either end is Schengen
      // (entry and exit days both count as presence), else the arrival.
      const to = resolveCountry(entry.to_location);
      const from = resolveCountry(entry.from_location);
      country = (to && SCHENGEN.has(to)) ? to : (from && SCHENGEN.has(from)) ? from : (to || from || arrivalAsOf(iso));
    } else if (status === 'training_leave') {
      country = normIso(entry?.location_country) || arrivalAsOf(iso);
    } else {
      // Leave / other off-vessel day → wherever they last flew into.
      country = arrivalAsOf(iso);
    }
    perDay.push({ iso, status, country, aboard: stampedOn(day) });
  }

  // Immigration (Schengen): a day counts only when NOT signed onto the crew list.
  // perDay runs today → back, so the last counted entry is the oldest in-window
  // day — it ages out of the rolling 180 on its date + 180, easing the tally.
  const countedDays = perDay.slice(0, 180).filter((d) => !d.aboard && d.country && SCHENGEN.has(d.country));
  const schengenUsed = countedDays.length;
  let schengenEasesOn = null;
  if (countedDays.length) {
    const [yy, mm, dd] = countedDays[countedDays.length - 1].iso.split('-').map(Number);
    const roll = new Date(yy, mm - 1, dd);
    roll.setDate(roll.getDate() + 180);
    schengenEasesOn = dateIso(roll);
  }

  // Days by country = physical presence (for tax tests like the UK SRT), so it
  // counts every day the body was in a country — signed-on days included. Only
  // the Schengen/immigration count above pauses for the crew-list stamp.
  const tally = {};
  perDay.forEach((d) => { if (d.country) tally[d.country] = (tally[d.country] || 0) + 1; });
  const byCountry = Object.entries(tally).map(([code, days]) => ({ code, days })).sort((a, b) => b.days - a.days);

  // Vessel's current country (today, else most recent position) — for the visa
  // card, which is about where the boat is, not where the crew member is.
  const todayKey = dateIso(today);
  let vesselCountry = vesselByDate[todayKey] || null;
  if (!vesselCountry) {
    const ks = Object.keys(vesselByDate).filter((k) => k <= todayKey).sort();
    vesselCountry = ks.length ? vesselByDate[ks[ks.length - 1]] : null;
  }

  return {
    schengenUsed,
    schengenRemaining: Math.max(0, 90 - schengenUsed),
    schengenEasesOn,
    byCountry,
    vesselCountry,
    hasData: byCountry.length > 0,
  };
};

// Friendly country name from ISO-2 (small set; falls back to the code).
const ISO_NAME = {
  GR: 'Greece', FR: 'France', IT: 'Italy', ES: 'Spain', US: 'United States',
  GB: 'United Kingdom', HR: 'Croatia', ME: 'Montenegro', TR: 'Türkiye',
  MC: 'Monaco', PT: 'Portugal', NL: 'Netherlands', DE: 'Germany', MT: 'Malta',
  IE: 'Ireland', CY: 'Cyprus', GI: 'Gibraltar', CH: 'Switzerland', AT: 'Austria',
  BE: 'Belgium', DK: 'Denmark', NO: 'Norway', SE: 'Sweden', FI: 'Finland',
  AE: 'United Arab Emirates', QA: 'Qatar', BS: 'Bahamas', SX: 'Sint Maarten',
  AG: 'Antigua & Barbuda', LC: 'St Lucia', BB: 'Barbados',
};
export const countryName = (code) => ISO_NAME[code] || code;
