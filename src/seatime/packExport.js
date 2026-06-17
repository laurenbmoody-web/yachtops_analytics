// Real testimonial pack export: a canonical SHA-256 assurance, a scannable QR,
// and a MIN 642 certificate PDF. Used by the certificate's Download button.
//
// The on-screen seal and this export share ONE assurance so the printed hash,
// the QR, and the verify ref all match.

import { sha256Hex } from './testimonial/sha256.js';

// Public no-login verify endpoint embedded in the QR. // TODO(MIN642): final host/route.
export const VERIFY_BASE_URL = 'https://app.cargocrew.io/verify/sea-time';

const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
};

/** SHA-256 assurance over the canonical MCA content of an engine dataset. */
export const buildAssurance = (dataset) => {
  const content = {
    seafarer: {
      fullName: dataset?.seafarer?.fullName ?? null,
      dob: dataset?.seafarer?.dob ?? null,
      nationality: dataset?.seafarer?.nationality ?? null,
      dischargeBookNo: dataset?.seafarer?.dischargeBookNo ?? null,
      cocHeld: dataset?.seafarer?.cocHeld ?? null
    },
    vessels: (dataset?.vessels || []).map(v => ({ name: v.name, flag: v.flag, imo: v.imo, gt: v.gt, lengthM: v.lengthM }))
      .sort((a, b) => String(a.imo).localeCompare(String(b.imo))),
    service: { capacity: dataset?.service?.capacity ?? null, totals: dataset?.service?.totals ?? {} },
    signatory: dataset?.signatory ?? null
  };
  const contentHash = sha256Hex(canonical(content));
  const verificationRef = 'CARGO-STT-' + contentHash.slice(0, 6).toUpperCase();
  return { contentHash, verificationRef, qrPayload: `${VERIFY_BASE_URL}/${verificationRef}#${contentHash}` };
};

/** Scannable QR as a PNG data URL (lazy-imports qrcode so tests stay light). */
export const makeQrDataUrl = async (text) => {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(text, { margin: 1, width: 240, color: { dark: '#1A2233', light: '#FFFFFF' } });
};

const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };

/**
 * Render the MIN 642 testimonial certificate to a PDF (Uint8Array).
 * @param {Object} p
 * @param {Object} p.dataset      engine.buildTestimonialDataset output
 * @param {Object} p.verifier     verifier profile
 * @param {Object} p.assurance    buildAssurance output
 * @param {string} [p.qrDataUrl]  PNG data URL of the QR
 * @param {Object} [p.signatoryMeta] { name, rank, cocNumber, signedAt }
 */
export const renderPackPdf = async ({ dataset, verifier, assurance, qrDataUrl, signatoryMeta }) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 16;
  let y = M;
  const text = (s, size = 10, style = 'normal', x = M) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.text(String(s), x, y); };
  const rule = (gold) => { doc.setDrawColor(gold ? 205 : 26, gold ? 187 : 34, gold ? 146 : 51); doc.line(M, y, 210 - M, y); };

  // Header
  doc.setTextColor(198, 90, 26);
  text('MARITIME & COASTGUARD AGENCY · MIN 642 ANNEX A', 8, 'bold'); y += 7;
  doc.setTextColor(26, 34, 51);
  text('Testimonial of Sea Service', 20, 'bold'); y += 7;
  doc.setTextColor(120, 120, 120);
  text(`Prepared for ${verifier?.name || verifier?.label || ''}`, 9); y += 5;
  rule(false); y += 8;
  doc.setTextColor(26, 34, 51);

  // Seafarer fields
  const s = dataset.seafarer || {};
  const field = (label, val, x) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(150, 150, 150); doc.text(label.toUpperCase(), x, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(26, 34, 51); doc.text(String(val || '—'), x, y + 5); };
  field('Seafarer', s.fullName, M); field('DOB · Nationality', `${fmtDate(s.dob)} · ${s.nationality || '—'}`, 110); y += 13;
  field('Discharge book / NoE', s.dischargeBookNo, M); field('Capacity', dataset.service?.capacity, 110); y += 13;
  field('Service period', `${fmtDate(s.periodFrom)} – ${fmtDate(s.periodTo)}`, M); field('CoC held', s.cocHeld, 110); y += 14;

  // Vessels
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
  doc.text('VESSELS', M, y); y += 5;
  doc.setFontSize(9); doc.setTextColor(26, 34, 51);
  doc.text('Name', M, y); doc.text('Flag · IMO', 80, y); doc.text('GT', 150, y); doc.text('Length', 175, y); y += 2;
  rule(true); y += 5;
  doc.setFont('helvetica', 'normal');
  for (const v of dataset.vessels || []) {
    doc.text(String(v.name || '—'), M, y); doc.text(`${v.flag || '—'} · IMO ${v.imo || '—'}`, 80, y);
    doc.text(`${v.gt ?? '—'}`, 150, y); doc.text(`${v.lengthM ?? '—'} m`, 175, y); y += 6;
  }
  y += 4;

  // Totals — separate
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
  doc.text('SERVICE TOTALS — TOTALLED SEPARATELY', M, y); y += 7;
  const totals = dataset.service?.totals || {};
  const boxes = [['Seagoing', totals.seagoing], ['Watchkeeping', totals.watchkeeping], ['Standby', totals.standby], ['Shipyard', totals.yard]];
  let bx = M;
  for (const [lab, n] of boxes) {
    doc.setDrawColor(228, 223, 207); doc.roundedRect(bx, y, 42, 18, 2, 2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26, 34, 51); doc.text(String(n ?? 0), bx + 4, y + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(138, 127, 99); doc.text(`${lab} days`, bx + 4, y + 14);
    bx += 45;
  }
  y += 26;

  // Signatory
  doc.setTextColor(26, 34, 51); doc.setFont('helvetica', 'italic'); doc.setFontSize(15);
  doc.text(signatoryMeta?.name || '—', M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
  doc.text(`${signatoryMeta?.rank || ''}${signatoryMeta?.cocNumber ? ' · CoC ' + signatoryMeta.cocNumber : ''}${signatoryMeta?.signedAt ? ' · ' + fmtDate(signatoryMeta.signedAt) : ''}`, M, y);

  // QR + verification (right column)
  if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', 150, y - 30, 30, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(138, 127, 99);
  doc.text('SCAN TO VERIFY', 150, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  doc.text(assurance.verificationRef, 150, y + 4);
  doc.text(`sha256:${assurance.contentHash}`.slice(0, 38), 150, y + 8);
  doc.text(`sha256…${assurance.contentHash.slice(38)}`, 150, y + 11);

  // Footer instructions
  y = 280;
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  const lines = doc.splitTextToSize(verifier?.instructions || '', 178);
  doc.text(lines, M, y);

  return new Uint8Array(doc.output('arraybuffer'));
};

export const downloadBytes = (bytes, filename) => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
