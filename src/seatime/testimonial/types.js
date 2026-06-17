// Sea Service Testimonial Pack — canonical type contracts.
//
// NOTE ON LANGUAGE: the task spec expressed these as TypeScript interfaces.
// This repo's test harness is `node --test` (see package.json), which imports
// plain ESM `.js` — it cannot load `.ts` without a loader. To keep the data
// core unit-testable via the project's own runner, the contracts live here as
// JSDoc typedefs (identical shapes), and the modules are `.js`. The Vite build
// (esbuild) is unaffected.
//
// ONE shared data core -> per-verifier adapter -> rendered pack:
//   buildTestimonialDataset()  -> TestimonialDataset (canonical MIN 642 fields)
//   getVerifierProfiles()      -> VerifierProfile[]  (config-driven)
//   validateTestimonial()      -> ValidationResult   (blocks generation)
//   renderTestimonialPack()    -> { pdfBytes, checklist }

/**
 * @typedef {'seagoing'|'watchkeeping'|'standby'|'yard'} ServiceType
 */

/**
 * @typedef {Object} TestimonialSeafarer
 * @property {string} fullName
 * @property {string} [dob]            // ISO date
 * @property {string} [nationality]
 * @property {string} [dischargeBookNo]
 * @property {string} [noeRef]         // Notice of Eligibility reference
 * @property {string} [cocHeld]        // Certificate of Competency held
 * @property {string} [userId]         // internal — used for self-cert detection
 */

/**
 * @typedef {Object} TestimonialVessel
 * @property {string} name
 * @property {string} flag
 * @property {string} imo
 * @property {string} [mmsi]
 * @property {number} grossTonnage
 * @property {number} registeredLengthM
 * @property {boolean} isOver15m
 * @property {string} vesselType
 */

/**
 * @typedef {Object} TestimonialDay  (extension over the spec — validation needs
 *   day-level facts to be first-pass-clean; totals alone can't prove the 4h /
 *   ≥15m rules)
 * @property {string} date            // ISO date
 * @property {ServiceType} serviceType
 * @property {number} watchHours
 * @property {string} vesselImo
 * @property {boolean} isOver15m
 * @property {boolean} qualifies
 */

/**
 * @typedef {Object} TestimonialSignatory
 * @property {string} name
 * @property {string} [rank]
 * @property {string} [cocNumber]
 * @property {string} [signatureRef]  // storage path of the drawn signature
 * @property {string} [signedAt]      // ISO timestamp
 * @property {string} [userId]        // internal — used for self-cert detection
 */

/**
 * @typedef {Object} TestimonialAssurance
 * @property {string} verificationRef
 * @property {string} contentHash     // SHA-256 hex over the canonical fields
 * @property {string} qrPayload       // verify URL embedded in the QR
 */

/**
 * @typedef {Object} TestimonialDataset
 * @property {TestimonialSeafarer} seafarer
 * @property {TestimonialVessel[]} vessels
 * @property {{ capacity:string, periodFrom:string, periodTo:string,
 *             totals:Record<ServiceType,number> }} service  // totals SEPARATE per type
 * @property {TestimonialSignatory} signatory
 * @property {TestimonialAssurance} assurance
 * @property {TestimonialDay[]} days            // day-level source for validation
 * @property {string[]} supportingDocs          // doc ids the user has attached
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} code
 * @property {string} message    // actionable, human-readable
 * @property {string} [field]
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {ValidationError[]} errors
 */

/**
 * @typedef {Object} VerifierProfile
 * @property {'pya'|'nautilus'|'other'} id
 * @property {string} label
 * @property {string} templateLayout
 * @property {string[]} requiredSupportingDocs
 * @property {{ allowResponsibleOfficial:boolean }} signatoryRules
 * @property {string} submissionInstructions
 * @property {{ logo?:string }} [brandingAssets]
 * @property {string} [lastReviewed]   // MCA Annex C changes over time — date it
 */

/** The four MCA service types, in display order. */
export const SERVICE_TYPES = /** @type {ServiceType[]} */ (['seagoing', 'watchkeeping', 'standby', 'yard']);

export const SERVICE_TYPE_LABELS = {
  seagoing: 'Actual seagoing service',
  watchkeeping: 'Watchkeeping service',
  standby: 'Standby service',
  yard: 'Shipyard service'
};

// Minimum recorded watch (hours in a 24h period) for a day to count as
// watchkeeping. // TODO(MIN642): confirm against the live notice.
export const WATCHKEEPING_MIN_HOURS = 4;

// Vessel length gate (m) for seagoing/OOW service. // TODO(MIN642): confirm.
export const SEAGOING_MIN_LENGTH_M = 15;

// Cap on standby days that may contribute. // TODO(MIN642): confirm exact cap.
export const STANDBY_CAP_DAYS = 90;
