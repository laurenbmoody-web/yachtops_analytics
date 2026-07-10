// PYA Sea Service Testimonial (SST) autofill payload.
//
// Maps the ONE shared testimonial dataset onto the exact fields of the PYA
// online "Verify Sea Service Testimonial" form (member.pya.org/.../sst-request/
// create). The bookmarklet in ./pyaBookmarklet.js consumes this payload and
// types it into the live form by matching each field's visible label.
//
// Day-bucket mapping is per PYA's own field tooltips:
//   • "Actual days at Sea"  = days underway with main propulsion ≥4h/24h
//        → our seagoing + watchkeeping (watchkeeping days ARE at-sea days).
//   • "Deck Watchkeeping"   = the subset of at-sea days stood as OOW in full
//        charge of a nav watch  → our watchkeeping (a component, NOT additive;
//        PYA: "can never be higher than days at sea").
//   • "Stand-by Service"    = our standby.
//   • "Shipyard Service"    = our yard.
//   • "Leave of absence"    = leave days (fetched separately; entries exclude them).
// Engine boxes, Night Watch Hours, rotation weeks, nautical miles and the flag /
// areas-cruised pickers are intentionally left for manual entry (we either don't
// hold the data, or the value is ambiguous — filling it wrong is worse than blank).

const round = (n) => Math.max(0, Math.round(Number(n) || 0));

/** Map our free-text capacity/rank onto one PYA capacity checkbox label. Null =
 *  unknown (the user ticks it by hand). Labels mirror PYA's exact option text
 *  across all four SST types (Deck, Engineering, Dual, Interior). Engine is
 *  tested BEFORE deck so "Engineer Watchkeeper"/"EOOW" isn't read as a deck OOW,
 *  and chief/second before the generic Engineer. */
export const mapCapacity = (cap) => {
  const c = String(cap || '').toLowerCase();
  if (!c) return null;
  // ── Engine department
  if (/\beto\b|electro[- ]?tech/.test(c)) return 'ETO';
  if (/engineer|motorman|\boiler\b|eoow|\beng\b/.test(c)) {
    if (/chief|c\/e/.test(c)) return 'Chief Engineer';
    if (/2nd|second/.test(c)) return 'Second Engineer';
    if (/watch|eoow/.test(c)) return 'Engineer Watchkeeper';
    return 'Engineer';
  }
  // ── Deck department
  if (/\bmaster\b|captain/.test(c) && !/chase/.test(c)) return 'Master';
  if (/chief\s*(mate|officer)|c\/o|1st officer|first officer/.test(c)) return 'Chief Mate';
  if (/oow|officer of the watch|watch\s?keep|2nd officer|second officer|3rd officer|third officer|\bmate\b/.test(c)) return 'OOW';
  if (/chase/.test(c)) return 'Chase Boat Captain';
  if (/bosun|boatswain/.test(c)) return 'Bosun';
  if (/deck/.test(c)) return 'Deckhand';
  // ── Interior / galley
  if (/purser/.test(c)) return 'Purser';
  if (/chief\s*stew|head\s*of\s*(interior|service)/.test(c)) return 'Chief steward / ess';
  if (/stew/.test(c)) return 'Steward / ess';
  if (/chef/.test(c)) return 'Chef';
  if (/cook/.test(c)) return 'Cook';
  return null;
};

/** Sail vs motor for the PYA "Vessel Type" radio. */
export const mapVesselType = (t) => (/sail/i.test(String(t || '')) ? 'Sail Yacht' : 'Motor Yacht');

/** Drop a vessel-type prefix (M/Y, S/Y, MV, …) from the name — PYA captures
 *  sail-vs-motor in its own Vessel Type selector, so the Name field is bare. */
export const cleanVesselName = (name) => String(name || '').replace(/^\s*(m\/y|s\/y|m\/v|s\/v|my|sy|mv|sv)\.?\s+/i, '').trim();

// Free-text cruising region(s) → PYA's exact "areas cruised" checkbox labels.
// Coarse by design (a vessel's region is usually broad) — the user can tick/untick
// after; better to seed the obvious ones than leave them all blank.
const AREA_RULES = [
  { re: /\bmed\b|mediterran/i,               a: ['Mediterranean (East)', 'Mediterranean (West)'] },
  { re: /carib/i,                            a: ['Caribbean'] },
  { re: /baham|cayman/i,                     a: ['Bahamas/Cayman Islands'] },
  { re: /atlantic/i,                         a: ['Atlantic Ocean'] },
  { re: /pacific/i,                          a: ['Pacific Ocean'] },
  { re: /indian/i,                           a: ['Indian Ocean'] },
  { re: /baltic|nth europe|northern europe|scandinav/i, a: ['Northern Europe/Baltic'] },
  { re: /persian|middle east|\bgulf\b|\buae\b|arabian/i, a: ['Persian Gulf/Middle East'] },
  { re: /usa? ?east|florida|new england|us east/i, a: ['USA East'] },
  { re: /usa? ?west|california|us west/i,     a: ['USA West'] },
  { re: /\basia\b|far east|thailand|indonesia/i, a: ['Asia'] },
  { re: /australasia|australia|new zealand/i, a: ['Australasia'] },
  { re: /africa/i,                           a: ['Africa'] },
  { re: /arctic|alaska|\bcanada\b/i,          a: ['Arctic/Canada/Alaska'] },
  { re: /antarctic/i,                        a: ['Antarctica'] },
  { re: /central america/i,                  a: ['Central America'] },
  { re: /south america/i,                    a: ['South America'] },
];

/** Map a free-text region string onto PYA area-checkbox labels (deduped). */
export const mapAreas = (regionText) => {
  const t = String(regionText || '');
  if (!t.trim()) return [];
  const out = new Set();
  for (const r of AREA_RULES) if (r.re.test(t)) r.a.forEach(x => out.add(x));
  return [...out];
};

/**
 * Build the PYA autofill payload from the assembled testimonial dataset.
 *
 * @param {Object} p
 * @param {import('../testimonial/types.js').TestimonialDataset} p.dataset
 * @param {number|null} [p.leaveDays]      leave/absence days in the period
 * @param {number|null} [p.guestDays]      guest-on days in the period
 * @param {string} [p.signatoryEmail]      attesting captain's email
 * @param {string} [p.sstType]             'Deck Testimonial' (default) | 'Engineering Testimonial' | …
 */
export const buildPyaPayload = ({ dataset, leaveDays = null, guestDays = null, signatoryEmail = '', sstType = 'Deck Testimonial', operatingRegions = '', propulsionKw = null, engineType = '' }) => {
  const v = (dataset?.vessels && dataset.vessels[0]) || {};
  const t = dataset?.service?.totals || {};
  const atSea = round(t.seagoing) + round(t.watchkeeping);

  const text = {};
  if (v.name) text['Name'] = cleanVesselName(v.name);
  if (v.imo) text['IMO'] = String(v.imo);
  if (v.officialNumber) text['Official Number'] = String(v.officialNumber);
  if (v.grossTonnage != null) text['Gross tonnage (GT)'] = String(round(v.grossTonnage));
  if (v.registeredLengthM != null) text['Load Line Length (m)'] = String(v.registeredLengthM);
  if (propulsionKw != null && propulsionKw !== '') text['Propulsion power (kW)'] = String(round(propulsionKw));
  if (engineType && String(engineType).trim()) text['Type of Main Engine'] = String(engineType).trim();

  const service = {
    'Actual days at Sea': atSea,
    'Deck Watchkeeping': round(t.watchkeeping),
    'Stand-by Service': round(t.standby),
    'Shipyard Service': round(t.yard),
  };
  if (leaveDays != null) service['Leave of absence'] = round(leaveDays);
  if (guestDays != null && round(guestDays) > 0) service['Days with guests'] = round(guestDays);

  const areas = mapAreas(operatingRegions);
  const flag = v.flag || '';

  // Fields we can't fill (no data, or a custom widget we don't drive).
  const manual = ['Night Watch Hours'];
  if (!text['Type of Main Engine']) manual.push('Type of Main Engine');
  if (!text['Propulsion power (kW)']) manual.push('Propulsion power (kW)');
  if (!text['Official Number']) manual.push('Official Number');
  if (!areas.length) manual.push('Areas cruised');
  if (!flag) manual.push('Flag (country picker)');

  return {
    format: 'New Digital SST',
    radios: [{ label: 'New Digital SST' }, { label: sstType }],
    capacity: mapCapacity(dataset?.service?.capacity),
    vesselType: mapVesselType(v.vesselType),
    text,
    service,
    areas,
    flag,
    dates: { from: dataset?.service?.periodFrom || '', to: dataset?.service?.periodTo || '' },
    signatoryEmail: signatoryEmail || '',
    manual,
  };
};
