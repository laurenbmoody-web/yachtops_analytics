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

// Friendly per-guest condition label for the emergency row. Takes the
// triggering regex match phrase and normalises to what a stew would
// actually say: "peanut allergy", "tree nut allergy", "shellfish allergy",
// "asthma", "diabetes", "cardiac".
function conditionLabelFor(ruleId, matchedPhrase) {
  if (ruleId === 'anaphylaxis') {
    const phrase = String(matchedPhrase ?? '').toLowerCase().trim();
    // Normalise plurals + specific shapes.
    if (/tree\s*nut/.test(phrase))  return 'tree nut allergy';
    if (/^nuts?$/.test(phrase))     return 'nut allergy';
    if (/peanut/.test(phrase))      return 'peanut allergy';
    if (/shellfish/.test(phrase))   return 'shellfish allergy';
    if (/anaphylax/.test(phrase))   return 'anaphylaxis';
    return phrase ? `${phrase.replace(/s$/, '')} allergy` : 'allergy';
  }
  if (ruleId === 'asthma')   return 'asthma';
  if (ruleId === 'diabetes') return 'diabetes';
  if (ruleId === 'cardiac')  return 'cardiac';
  return ruleId;
}

// Like emergencyDevicesForGuest, but each entry carries the triggering
// condition id + a pre-formatted condition_label + the guest reference,
// so the page can render "Jext 0.3mg — for John (nut allergy), Jane
// (peanut allergy)" in the new item-first layout. Use this from
// useInventoryConsumables; the original function stays for the legacy
// per-guest hook until it's removed in cleanup.
export function emergencyResponsesForGuest(guest, items) {
  const medText = `${guest?.allergies ?? ''} ${guest?.health_conditions ?? ''}`;
  if (!medText.trim()) return [];

  const age = computeAgeYears(guest?.date_of_birth);
  const paediatric = age != null && age < 12;

  const responses = [];
  const seen = new Set();

  for (const rule of EMERGENCY_MATCHERS) {
    if (seen.has(rule.id)) continue;
    const match = rule.match.exec(medText);
    if (!match) continue;
    const picked = rule.pick(items || [], { paediatric });
    if (picked) {
      responses.push({
        condition:       rule.id,           // 'anaphylaxis' | 'asthma' | 'diabetes' | 'cardiac'
        condition_label: conditionLabelFor(rule.id, match[0]),
        device: {
          ...picked,
          name: stripSentinels(picked.name),
          unit: stripSentinels(picked.unit),
        },
        guest,
      });
      seen.add(rule.id);
    }
  }

  return responses;
}

export { stripSentinels };
