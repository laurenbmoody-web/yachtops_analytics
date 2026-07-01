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
  y += 24; // clear the full 18mm box height so the section rule never strikes through

  // ── Signatory (left) + verification (right), as one clean band ─────────────
  rule(false); y += 8;
  // `unsigned` = a blank testimonial the endorsing officer still has to sign by
  // hand (the MCA Discharge-Book / PYA routes). We draw a signature line + stamp
  // and date blanks and print the name as a LABEL — never a cursive pseudo-
  // signature, which would misrepresent an unsigned document as signed.
  const unsigned = signatoryMeta?.unsigned && !signatoryMeta?.signatureImage;
  const rankWord = signatoryMeta?.rank || 'Master';
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(150, 150, 150);
  doc.text(unsigned ? `TO BE SIGNED BY THE ${String(rankWord).toUpperCase()}` : 'SIGNED BY THE MASTER', M, y);
  let ny = y + 5;
  if (unsigned) {
    doc.setDrawColor(150, 150, 150); doc.line(M, ny + 9, M + 80, ny + 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(138, 127, 99);
    doc.text('Signature & ship’s official stamp', M, ny + 13);
    doc.setFontSize(9.5); doc.setTextColor(26, 34, 51);
    doc.text(`Name: ${signatoryMeta?.name || '—'}`, M, ny + 22);
    doc.text(`Capacity: ${rankWord}`, M, ny + 27);
    doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text('CoC no.: __________________     Date: ______________', M, ny + 32);
  } else {
    // The drawn signature itself, when present, then the printed name beneath it.
    if (signatoryMeta?.signatureImage) {
      try { doc.addImage(signatoryMeta.signatureImage, 'PNG', M, ny, 48, 15); } catch { /* bad image */ }
      ny += 18;
    }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(15); doc.setTextColor(26, 34, 51);
    doc.text(signatoryMeta?.name || '—', M, ny + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(`${rankWord}${signatoryMeta?.cocNumber ? ' · CoC ' + signatoryMeta.cocNumber : ''}${signatoryMeta?.signedAt ? ' · ' + fmtDate(signatoryMeta.signedAt) : ''}`, M, ny + 10);
  }

  // QR (right) with the verification text clearly BELOW it — never overlapping.
  const qx = 152, qy = y + 2;
  if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', qx, qy, 24, 24);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(138, 127, 99);
  doc.text('SCAN TO VERIFY', qx, qy + 29);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120);
  doc.text(assurance.verificationRef, qx, qy + 32.5);
  doc.text(`sha256:${assurance.contentHash.slice(0, 30)}…`, qx, qy + 36);

  // Footer instructions
  y = 280;
  doc.setFontSize(7.5); doc.setTextColor(120, 120, 120);
  const lines = doc.splitTextToSize(verifier?.instructions || '', 178);
  doc.text(lines, M, y);

  return new Uint8Array(doc.output('arraybuffer'));
};

// Base64-encode PDF bytes for transport to the store-testimonial edge function.
export const bytesToBase64 = (bytes) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  return btoa(bin);
};

// Build a single-command-spell Testimonial of Sea Service (Uint8Array) — used
// when a master signs, so each ship gets its own stored, verifiable PDF. Reuses
// renderPackPdf by shaping a one-vessel dataset; totals come from the periods.
export const buildSpellTestimonialPdf = async ({ seafarer, vessel, periods = [], signatory, verifier }) => {
  const totals = { seagoing: 0, watchkeeping: 0, standby: 0, yard: 0 };
  for (const p of periods) { const k = p.type; if (totals[k] != null) totals[k] += (p.days || 0); }
  const froms = periods.map(p => p.from).filter(Boolean).sort();
  const tos = periods.map(p => p.to).filter(Boolean).sort();
  const dataset = {
    seafarer: {
      fullName: seafarer?.fullName || 'Seafarer', dob: seafarer?.dob || null, nationality: seafarer?.nationality || null,
      dischargeBookNo: seafarer?.dischargeBookNo || '', cocHeld: seafarer?.cocHeld || '',
      periodFrom: froms[0] || null, periodTo: tos[tos.length - 1] || null,
    },
    vessels: [{ name: vessel?.name, flag: vessel?.flag, imo: vessel?.imo, gt: vessel?.gt, lengthM: vessel?.lengthM }],
    service: { capacity: periods[0]?.capacity || '', totals },
    signatory: signatory || null,
  };
  const assurance = buildAssurance(dataset);
  let qrDataUrl = null;
  try { qrDataUrl = await makeQrDataUrl(assurance.qrPayload); } catch { /* QR is optional */ }
  const v = verifier || { name: 'Maritime & Coastguard Agency', label: 'MCA', instructions: 'Testimonial of sea service signed by the master under MSN 1858 — retain with your Discharge Book and Notice of Eligibility.' };
  return renderPackPdf({ dataset, verifier: v, assurance, qrDataUrl, signatoryMeta: signatory });
};

export const downloadBytes = (bytes, filename, type = 'application/pdf') => {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
