// Emergency-device matchers for the /inventory/weekly page.
//
// Extracted from useGuestConsumables so both the old consumables hook
// (until Phase 3 retires it) and the new usePreferenceLinks hook can
// share one implementation. The matching logic is unchanged from
// Phase 2's targeted emergency rules:
//
//   anaphylaxis triggers (peanut / tree nut / nut / shellfish /
//     anaphylax…) → single adrenaline auto-injector, age-matched
//   asthma                → single inhaler (rescue form, no accessories)
//   diabetes              → single glucose monitor or glucagon
//   angina / cardiac      → single GTN product
//
// Strict 1-device-per-condition cap. No antihistamines, no ancillaries
// (swabs, ampoules, syringes, lancets, spacers, peak-flow meters,
// cleaning supplies). Those live on the full inventory page.

function stripSentinels(str) {
  if (str == null) return str;
  return String(str).replace(/:[A-Z_]+:/g, '').replace(/\s{2,}/g, ' ').trim();
}

function isAdrenalineAutoInjector(name, paediatricGuest) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  const isInjector = /\b(auto[-\s]?injector|jext|epipen|adrenaline\s+pen)\b/.test(lc);
  if (!isInjector) return false;
  if (/\b(vial|ampoule|amp)\b/.test(lc))   return false;
  if (/\b(needle|syringe)\b/.test(lc))     return false;
  const paedMarker = /\b(paed|pediatric|junior|kid|child|0\.15\s*mg|0\.15mg)\b/.test(lc);
  return paediatricGuest ? paedMarker : !paedMarker;
}

function isInhaler(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  if (!/\b(inhaler|salbutamol|ventolin|bronchodilator|puffer)\b/.test(lc)) return false;
  if (/\b(spacer|chamber|peak[-\s]?flow|flow\s*meter|cleaner|case)\b/.test(lc)) return false;
  return true;
}

function isGlucoseDevice(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  return /\b(glucose\s*(monitor|meter)|glucometer|glucagon)\b/.test(lc);
}

function isGTN(name) {
  const lc = stripSentinels(String(name || '')).toLowerCase();
  return /\b(gtn|glyceryl\s+trinitrate|nitroglycerin|nitrolingual|nitro\s*spray)\b/.test(lc);
}

const EMERGENCY_MATCHERS = [
  {
    id:    'anaphylaxis',
    match: /\b(peanut|tree\s*nut|nuts?|shellfish|anaphylax)\w*/i,
    pick:  (items, { paediatric }) => items.find(it => isAdrenalineAutoInjector(it.name, paediatric)),
  },
  {
    id:    'asthma',
    match: /\basthma\w*/i,
    pick:  (items) => items.find(it => isInhaler(it.name)),
  },
  {
    id:    'diabetes',
    match: /\bdiabet\w*/i,
    pick:  (items) => items.find(it => isGlucoseDevice(it.name)),
  },
  {
    id:    'cardiac',
    match: /\b(angina|cardiac)\w*/i,
    pick:  (items) => items.find(it => isGTN(it.name)),
  },
];

export function computeAgeYears(dobStr) {
  if (!dobStr) return null;
  const d = new Date(String(dobStr));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

export function emergencyDevicesForGuest(guest, items) {
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  if (!medText.trim()) return [];

  const age = computeAgeYears(guest?.date_of_birth);
  const paediatric = age != null && age < 12;

  const devices = [];
  const seen = new Set();

  for (const rule of EMERGENCY_MATCHERS) {
    if (seen.has(rule.id)) continue;
    if (!rule.match.test(medText)) continue;
    const picked = rule.pick(items || [], { paediatric });
    if (picked) {
      devices.push({
        ...picked,
        name: stripSentinels(picked.name),
        unit: stripSentinels(picked.unit),
      });
      seen.add(rule.id);
    }
  }

  return devices;
}

export { stripSentinels };
