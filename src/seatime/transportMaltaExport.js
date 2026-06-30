// Build the Transport Malta "Sea Service Testimonial Form — Deck Personnel"
// (Commercial Vessels Regulations S.L. 499.23) from Cargo's logged service, so
// crew on the Transport Malta verification route hand their signatory a
// pre-filled testimonial in the right format. The official form is a flat PDF
// (no AcroForm fields), so we render a faithful equivalent from scratch with
// jsPDF — the same approach as the MIN 642 pack export.
//
// Cargo pre-fills: the seafarer's name and the service table (Period / Capacity /
// Vessel / Length Overall / Max passengers). The master's assessment block
// (English & Maltese knowledge, experience, conduct, behaviour/sobriety) and the
// signature / company / stamp are left BLANK — those belong to the signatory.

const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };
const s = (v) => (v == null || v === '' ? '' : String(v));

/**
 * @param {Object} p
 * @param {Object} p.seafarer  { fullName }
 * @param {Object} p.vessel    { name, type, flag, loaM, lengthM, maxPax }
 * @param {Array}  p.rows      [{ from, to, capacity }] service lines for this vessel/spell
 * @returns {Promise<Uint8Array>}
 */
export const buildTransportMaltaSST = async ({ seafarer = {}, vessel = {}, rows = [] }) => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 14, RIGHT = 210 - M;
  let y = M;
  const set = (size, style = 'normal', col = [28, 27, 58]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(col[0], col[1], col[2]); };
  const text = (str, x, yy = y) => doc.text(String(str ?? ''), x, yy);
  const rule = (yy = y, col = [200, 198, 190]) => { doc.setDrawColor(col[0], col[1], col[2]); doc.line(M, yy, RIGHT, yy); };
  const box = (x, yy, on = false) => { doc.setDrawColor(120, 120, 120); doc.rect(x, yy - 3, 3.4, 3.4); if (on) { doc.setLineWidth(0.4); doc.line(x + 0.5, yy - 1.3, x + 1.4, yy - 0.4); doc.line(x + 1.4, yy - 0.4, x + 3, yy - 2.6); doc.setLineWidth(0.2); } };

  // ── Header band ──────────────────────────────────────────────────────────
  set(13, 'bold');
  text('SEA SERVICE TESTIMONIAL FORM — DECK PERSONNEL', M, y); y += 5.5;
  set(8, 'normal', [120, 120, 120]);
  text('issued in accordance with the Commercial Vessels Regulations (S.L. 499.23)', M, y); y += 4;
  text('Ports & Yachting Directorate · Transport Malta', M, y); y += 6;
  rule(); y += 7;

  // ── Certify line ─────────────────────────────────────────────────────────
  set(10, 'normal');
  text('I certify that the following is a full and true statement of the sea service performed by:', M, y); y += 7;
  set(7.5, 'bold', [150, 150, 150]); text('NAME OF SEAFARER', M, y);
  set(13, 'normal'); text(seafarer.fullName || '—', M, y + 5.5); y += 12;

  // ── Service table ────────────────────────────────────────────────────────
  const cols = { from: M, to: 38, cap: 62, vessel: 92, loa: 150, pax: 176 };
  set(7, 'bold', [150, 150, 150]);
  text('PERIOD OF SERVICE', cols.from, y);
  text('CAPACITY (RANK)', cols.cap, y);
  text('NAME & TYPE OF VESSEL', cols.vessel, y);
  text('LOA (m)', cols.loa, y);
  text('MAX PAX', cols.pax, y); y += 1.5;
  set(6.5, 'normal', [150, 150, 150]); text('From dd/mm/yyyy', cols.from, y + 3); text('To dd/mm/yyyy', cols.to, y + 3);
  y += 5; rule(y, [60, 80, 128]); y += 5;

  const vName = [vessel.name, vessel.type].filter(Boolean).join(' · ') || '—';
  const loa = vessel.loaM != null ? vessel.loaM : (vessel.lengthM != null ? vessel.lengthM : null);
  const pax = vessel.maxPax != null ? vessel.maxPax : null;
  const lines = rows.length ? rows : [{ from: null, to: null, capacity: '' }];
  set(9, 'normal', [28, 27, 58]);
  for (const r of lines) {
    text(fmtUk(r.from) || '—', cols.from, y);
    text(fmtUk(r.to) || '—', cols.to, y);
    text(s(r.capacity) || '—', cols.cap, y);
    doc.text(doc.splitTextToSize(vName, cols.loa - cols.vessel - 4), cols.vessel, y);
    text(loa != null ? String(loa) : '—', cols.loa, y);
    text(pax != null ? String(pax) : '—', cols.pax, y);
    y += 7; doc.setDrawColor(235, 233, 227); doc.line(M, y - 2.5, RIGHT, y - 2.5);
  }
  set(6.5, 'normal', [150, 150, 150]);
  text('* Attach a copy of the Certificate of Registry / CVC for each vessel.', M, y + 1); y += 8;

  // ── Master's report block (left blank for the signatory to tick) ─────────
  set(10, 'bold'); text('My report on the above during this service period is stated as follows:', M, y); y += 4;
  set(7, 'normal', [120, 120, 120]); text('Tick the appropriate box.', M, y + 3); y += 8;

  const tri = (label, opts, yy) => {
    set(8.5, 'bold', [90, 90, 110]); text(label, M, yy);
    set(8, 'normal', [60, 60, 60]);
    let x = 70;
    for (const o of opts) { box(x, yy, false); text(o, x + 5, yy); x += 30; }
  };
  tri('Knowledge of English', ['Speak', 'Read', 'Write'], y); y += 6;
  tri('Knowledge of Maltese', ['Speak', 'Read', 'Write'], y); y += 6;
  tri('Experience / Ability', ['Very good', 'Good', 'Fair'], y); y += 6;
  tri('Conduct', ['Very good', 'Good', 'Fair'], y); y += 6;
  tri('Behaviour / Sobriety', ['Very good', 'Good', 'Fair'], y); y += 10;

  rule(); y += 8;
  // ── Signature block (blank — the master/owner signs) ─────────────────────
  const sigField = (label, x, w) => { set(7, 'bold', [150, 150, 150]); text(label, x, y); doc.setDrawColor(170, 170, 170); doc.line(x, y + 9, x + w, y + 9); };
  sigField('SIGNATURE', M, 78); sigField('NAME IN FULL', 110, RIGHT - 110); y += 16;
  sigField('MASTER OR POSITION IN COMPANY (if applicable)', M, 78); sigField('NAME OF COMPANY (if applicable)', 110, RIGHT - 110); y += 16;
  set(7, 'bold', [150, 150, 150]); text('STAMP', M, y); doc.setDrawColor(170, 170, 170); doc.rect(M, y + 2, 44, 20);

  // Footer
  set(6.5, 'normal', [150, 150, 150]);
  doc.text('Prepared in Cargo from captain-attested service. The signatory and Transport Malta complete the assessment, signature and verification.', M, 290);

  return new Uint8Array(doc.output('arraybuffer'));
};
