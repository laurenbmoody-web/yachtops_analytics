// The ONE shared data core. buildTestimonialDataset() does IO (pulls from the
// existing Supabase sea-time store); assembleTestimonialDataset() is the pure,
// unit-tested assembler. Totals are kept PER SERVICE TYPE, never merged.

import { SERVICE_TYPES, SEAGOING_MIN_LENGTH_M } from './types.js';
import { buildAssurance } from './assurance.js';

const mode = (arr) => {
  const counts = {};
  let best = '', bestN = 0;
  for (const v of arr) {
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestN) { bestN = counts[v]; best = v; }
  }
  return best;
};

/**
 * Pure assembler — given a seafarer, the normalised sea-service entries, a
 * signatory and the attached docs, produce the canonical dataset.
 *
 * @param {Object} input
 * @param {import('./types.js').TestimonialSeafarer} input.seafarer
 * @param {Array} input.entries  normalised entries: { date, serviceType,
 *   watchHours, grossTonnage, lengthM, vesselName, vesselFlag, vesselImo,
 *   vesselMmsi?, vesselType, capacityServed, qualifiesForSelectedPath }
 * @param {import('./types.js').TestimonialSignatory} [input.signatory]
 * @param {string[]} [input.supportingDocs]
 * @param {{ from?:string, to?:string }} [input.period]
 * @returns {import('./types.js').TestimonialDataset}
 */
export const assembleTestimonialDataset = ({ seafarer, entries = [], signatory = {}, supportingDocs = [], period = {} }) => {
  // Group distinct vessels (by IMO, falling back to name).
  const vesselMap = new Map();
  for (const e of entries) {
    const key = e?.vesselImo || e?.vesselName || 'unknown';
    if (!vesselMap.has(key)) {
      const lengthM = e?.lengthM != null ? Number(e.lengthM) : null;
      vesselMap.set(key, {
        name: e?.vesselName || '',
        flag: e?.vesselFlag || '',
        imo: e?.vesselImo || '',
        mmsi: e?.vesselMmsi || undefined,
        grossTonnage: e?.grossTonnage != null ? Number(e.grossTonnage) : null,
        registeredLengthM: lengthM,
        isOver15m: lengthM != null ? lengthM >= SEAGOING_MIN_LENGTH_M : false,
        vesselType: e?.vesselType || ''
      });
    }
  }
  const vessels = Array.from(vesselMap.values());

  // Day-level records (validation needs these to prove the 4h / ≥15m rules).
  const days = entries.map(e => {
    const lengthM = e?.lengthM != null ? Number(e.lengthM) : null;
    return {
      date: e?.date,
      serviceType: e?.serviceType,
      watchHours: e?.watchHours != null ? Number(e.watchHours) : 0,
      vesselImo: e?.vesselImo || '',
      isOver15m: lengthM != null ? lengthM >= SEAGOING_MIN_LENGTH_M : false,
      qualifies: !!e?.qualifiesForSelectedPath
    };
  });

  // Totals — one count per service type, kept SEPARATE.
  const totals = SERVICE_TYPES.reduce((o, t) => { o[t] = 0; return o; }, {});
  for (const d of days) {
    if (totals[d.serviceType] != null) totals[d.serviceType] += 1;
  }

  const dates = entries.map(e => e?.date).filter(Boolean).sort();
  const dataset = {
    seafarer: { ...seafarer },
    vessels,
    service: {
      capacity: mode(entries.map(e => e?.capacityServed)),
      periodFrom: period?.from || dates[0] || null,
      periodTo: period?.to || dates[dates.length - 1] || null,
      totals
    },
    signatory: { ...signatory },
    days,
    supportingDocs: [...supportingDocs]
  };

  dataset.assurance = buildAssurance(dataset);
  return dataset;
};

/**
 * IO wrapper: pull the seafarer's entries from the existing Supabase store for
 * the period (and optional vessel filter), then assemble.
 * Lazy-imports the service so the pure module stays test-hermetic.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.seafarerId
 * @param {import('./types.js').TestimonialSeafarer} params.seafarer
 * @param {import('./types.js').TestimonialSignatory} [params.signatory]
 * @param {{ from:string, to:string }} params.period
 * @param {string[]} [params.vesselIds]   filter by vessel IMO/name
 * @param {string[]} [params.supportingDocs]
 * @param {string} [params.pathId]
 */
export const buildTestimonialDataset = async (params) => {
  const { tenantId, seafarerId, seafarer, signatory, period, vesselIds, supportingDocs, pathId = 'mca-oow-yachts' } = params;
  const { fetchEntriesForUser } = await import('../../pages/crew-profile/utils/seaTimeService.js');

  let entries = await fetchEntriesForUser(tenantId, seafarerId, pathId);

  if (period?.from) entries = entries.filter(e => e.date >= period.from);
  if (period?.to) entries = entries.filter(e => e.date <= period.to);
  if (vesselIds?.length) {
    const set = new Set(vesselIds);
    entries = entries.filter(e => set.has(e.vesselImo) || set.has(e.vesselName));
  }

  return assembleTestimonialDataset({ seafarer, entries, signatory, supportingDocs, period });
};
