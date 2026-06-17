// Renders the validated dataset to a PDF pack + a submission checklist.
// jsPDF is lazy-imported so this module loads in the test runner without DOM
// deps, and so the validation-blocked path never touches it.

import { SERVICE_TYPES, SERVICE_TYPE_LABELS } from './types.js';
import { validateTestimonial } from './validate.js';
import { SUPPORTING_DOC_LABELS } from './verifiers.js';

/**
 * Pure: the human submission checklist for the selected verifier (no PDF).
 * @param {import('./types.js').TestimonialDataset} dataset
 * @param {import('./types.js').VerifierProfile} verifier
 */
export const buildSubmissionChecklist = (dataset, verifier) => {
  const supplied = new Set(dataset?.supportingDocs || []);
  const documents = (verifier?.requiredSupportingDocs || []).map(id => ({
    id, label: SUPPORTING_DOC_LABELS[id] || id, required: true, supplied: supplied.has(id)
  }));
  const steps = String(verifier?.submissionInstructions || '')
    .split(/\.\s+/).map(s => s.trim()).filter(Boolean).map(s => s.endsWith('.') ? s : s + '.');
  return { verifier: verifier?.label, verifierId: verifier?.id, documents, steps };
};

const fmt = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return d ? `${d}/${m}/${y}` : iso; // dd/mm/yyyy per Cargo convention
};

/**
 * Render the pack. THROWS (generation blocked) if validation fails — the thrown
 * Error carries `.validation` so the UI can show every reason.
 *
 * @returns {Promise<{ pdfBytes:Uint8Array, checklist:object, dataset:object }>}
 */
export const renderTestimonialPack = async (dataset, verifier, options = {}) => {
  const validation = validateTestimonial(dataset, verifier, options);
  if (!validation.ok) {
    const err = new Error('Testimonial generation blocked: ' + validation.errors.map(e => e.message).join(' '));
    err.code = 'VALIDATION_BLOCKED';
    err.validation = validation;
    throw err;
  }

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15;
  let y = M;
  const line = (txt, size = 10, style = 'normal', dx = 0) => {
    doc.setFont('helvetica', style); doc.setFontSize(size);
    doc.text(String(txt), M + dx, y); y += size * 0.5 + 1.6;
  };
  const rule = () => { doc.setDrawColor(200); doc.line(M, y, 210 - M, y); y += 4; };

  // === Header ===
  // TODO(MIN642): align the exact Annex A field order/labels with the official PDF.
  line('SEA SERVICE TESTIMONIAL', 15, 'bold');
  line(`MCA MIN 642 Annex A · prepared for ${verifier?.label}`, 9, 'normal');
  rule();

  // === Seafarer ===
  const s = dataset.seafarer || {};
  line('Seafarer', 11, 'bold');
  line(`Name: ${s.fullName || '—'}     DOB: ${fmt(s.dob)}     Nationality: ${s.nationality || '—'}`);
  line(`Discharge book: ${s.dischargeBookNo || '—'}     NoE ref: ${s.noeRef || '—'}     CoC held: ${s.cocHeld || '—'}`);
  y += 2; rule();

  // === Vessels ===
  line('Vessels', 11, 'bold');
  line('Name · Flag · IMO · GT · Reg. length (m) · ≥15m · Type', 8, 'bold');
  for (const v of dataset.vessels || []) {
    line(`${v.name} · ${v.flag} · ${v.imo} · ${v.grossTonnage ?? '—'} GT · ${v.registeredLengthM ?? '—'} m · ${v.isOver15m ? 'Yes' : 'No'} · ${v.vesselType}`, 9);
  }
  y += 2; rule();

  // === Service (totals SEPARATE per type) ===
  const svc = dataset.service || {};
  line('Service', 11, 'bold');
  line(`Capacity served: ${svc.capacity || '—'}     Period: ${fmt(svc.periodFrom)} – ${fmt(svc.periodTo)}`);
  y += 1;
  for (const t of SERVICE_TYPES) {
    line(`${SERVICE_TYPE_LABELS[t]}: ${svc.totals?.[t] ?? 0} days`, 10);
  }
  line('(Each service type is totalled separately — not merged.)', 8, 'italic');
  y += 2; rule();

  // === Signatory ===
  const sig = dataset.signatory || {};
  line('Certified by (Master / Responsible Official)', 11, 'bold');
  line(`Name: ${sig.name || '—'}     Rank: ${sig.rank || '—'}     CoC no.: ${sig.cocNumber || '—'}`);
  line(`Signed: ${sig.signedAt ? fmt(String(sig.signedAt).slice(0, 10)) : '—'}`);
  y += 2; rule();

  // === Assurance ===
  const a = dataset.assurance || {};
  line('Verification', 11, 'bold');
  line(`Ref: ${a.verificationRef || '—'}`, 9);
  line(`Integrity (SHA-256): ${a.contentHash || '—'}`, 7);
  line(`Verify: ${a.qrPayload || '—'}`, 7);
  line('Scan to verify this record matches the signed original.', 8, 'italic');
  // TODO: embed an actual QR image of qrPayload (no QR lib in deps yet).

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
  return { pdfBytes, checklist: buildSubmissionChecklist(dataset, verifier), dataset };
};
