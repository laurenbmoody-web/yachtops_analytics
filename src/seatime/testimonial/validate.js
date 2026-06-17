// First-pass-clean validation: block generation (with an actionable reason) on
// anything an MCA-approved verifier would bounce. The headline rule is the
// self-certification hard fail — MCA will not accept self-certified seagoing
// service, so we make producing one impossible.

import { WATCHKEEPING_MIN_HOURS, SEAGOING_MIN_LENGTH_M, STANDBY_CAP_DAYS } from './types.js';
import { SUPPORTING_DOC_LABELS } from './verifiers.js';

// Combining diacritical marks U+0300–U+036F (built from escapes to keep this
// source file ASCII-clean).
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const normName = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD')                 // accents -> base char + combining mark
  .replace(COMBINING_MARKS, '')      // remove the marks (don't split the word)
  .replace(/[^a-z0-9]+/g, ' ')       // collapse remaining punctuation to spaces
  .trim();

/**
 * @param {import('./types.js').TestimonialDataset} dataset
 * @param {import('./types.js').VerifierProfile} verifierProfile
 * @param {{ standbyCapDays?:number }} [options]
 * @returns {import('./types.js').ValidationResult}
 */
export const validateTestimonial = (dataset, verifierProfile, options = {}) => {
  const errors = [];
  const push = (code, message, field) => errors.push({ code, message, field });

  const standbyCap = options.standbyCapDays ?? STANDBY_CAP_DAYS;
  const days = dataset?.days || [];
  const vessels = dataset?.vessels || [];

  // 1) Self-certification — HARD FAIL. By name and, if present, by id.
  const seaName = normName(dataset?.seafarer?.fullName);
  const sigName = normName(dataset?.signatory?.name);
  const sameId = dataset?.seafarer?.userId && dataset?.signatory?.userId &&
    dataset.seafarer.userId === dataset.signatory.userId;
  if (sigName && (sameId || (seaName && sigName === seaName))) {
    push('SELF_CERTIFICATION',
      'The signatory is the seafarer — MCA will not accept self-certificated ' +
      'seagoing service. A Master or Responsible Official must sign.', 'signatory.name');
  }

  // 2) No signatory assigned.
  if (!sigName) {
    push('NO_SIGNATORY', 'Assign a signatory (Master / Responsible Official) before generating.', 'signatory');
  }

  // 3) Watchkeeping day with < the 4h/24h minimum.
  const badWatch = days.filter(d => d.serviceType === 'watchkeeping' && Number(d.watchHours) < WATCHKEEPING_MIN_HOURS);
  if (badWatch.length) {
    push('WATCHKEEPING_UNDER_4H',
      `${badWatch.length} day(s) are tagged watchkeeping but record under ${WATCHKEEPING_MIN_HOURS}h of watch ` +
      `(e.g. ${badWatch[0].date}). MCA counts a watchkeeping day only at ≥${WATCHKEEPING_MIN_HOURS}h. ` +
      'Fix the watch hours or re-tag the day.', 'days');
  }

  // 4) Standby days exceed the regulatory cap. // TODO(MIN642): confirm cap.
  const standbyTotal = dataset?.service?.totals?.standby ?? 0;
  if (standbyTotal > standbyCap) {
    push('STANDBY_CAP_EXCEEDED',
      `${standbyTotal} standby days exceed the ${standbyCap}-day cap. Only ${standbyCap} may be claimed.`,
      'service.totals.standby');
  }

  // 5) Seagoing/watchkeeping claimed on a vessel < the ≥15m pathway gate.
  const underSize = days.filter(d => (d.serviceType === 'seagoing' || d.serviceType === 'watchkeeping') && d.isOver15m === false);
  if (underSize.length) {
    const imos = [...new Set(underSize.map(d => d.vesselImo).filter(Boolean))];
    push('SEAGOING_UNDER_15M',
      `${underSize.length} seagoing/watchkeeping day(s) are on a vessel under ${SEAGOING_MIN_LENGTH_M}m ` +
      `(${imos.join(', ') || 'unknown vessel'}); this pathway requires ≥${SEAGOING_MIN_LENGTH_M}m. ` +
      'Remove these days or use a pathway that accepts them.', 'days');
  }

  // 6) Vessel missing the gating facts.
  for (const v of vessels) {
    if (v.grossTonnage == null || v.registeredLengthM == null) {
      push('VESSEL_MISSING_DATA',
        `Vessel "${v.name || v.imo || 'unknown'}" is missing ${v.grossTonnage == null ? 'gross tonnage' : ''}` +
        `${v.grossTonnage == null && v.registeredLengthM == null ? ' and ' : ''}` +
        `${v.registeredLengthM == null ? 'registered length' : ''}.`, 'vessels');
    }
  }

  // 7) Required supporting doc for the selected verifier is missing.
  const supplied = new Set(dataset?.supportingDocs || []);
  for (const doc of verifierProfile?.requiredSupportingDocs || []) {
    if (!supplied.has(doc)) {
      push('MISSING_SUPPORTING_DOC',
        `${verifierProfile.label} requires: ${SUPPORTING_DOC_LABELS[doc] || doc}. Attach it before generating.`,
        'supportingDocs');
    }
  }

  return { ok: errors.length === 0, errors };
};
