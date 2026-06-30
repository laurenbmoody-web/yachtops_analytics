// Fill the REAL Transport Malta "Sea Service Testimonial Form — Deck Personnel"
// (S.L. 499.23) from Cargo's logged service, so the crew hand Transport Malta
// *their own* official document, pre-completed, for the master to sign.
//
// The official form is a flat PDF (no AcroForm fields), so we stamp the factual
// service data onto page 1 at coordinates measured against the printed labels.
// The assessment boxes (English/Maltese, conduct, ability), the signature, the
// stamp and the date are deliberately left blank — those belong to the master,
// not to us.
//
// Coordinates are PDF user space (origin bottom-left) on the A4 template
// (595.44 × 841.68). One command spell = one vessel; its service period rows go
// in the table.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TEMPLATE_URL = '/forms/transport_malta_sst_template.pdf';
const INK = rgb(0.11, 0.106, 0.227); // #1C1B3A navy ink

const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y.slice(2)}` : String(iso); };
const str = (v) => (v == null || v === '' ? '' : String(v));

// Truncate to fit a column width at a given font size (Helvetica metrics).
const fit = (font, text, size, maxW) => {
  let s = str(text);
  if (!s) return '';
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -1);
  return s === str(text) ? s : s.replace(/.$/, '…');
};

/**
 * @param {Object} p
 * @param {Object} p.seafarer  { fullName, idNo? }  idNo = passport / ID number
 * @param {Object} p.vessel    { name, type, flag, officialNo?, loaM?, maxPax? }
 * @param {Array}  p.rows      [{ from, to, capacity }]
 * @param {Object} [p.signatory] { name, position }  the master who endorses (name
 *   in full + "Master"); blank when the company signs (own service as master)
 * @param {Object} [p.company]   { name }  named only when there's no master signatory
 * @returns {Uint8Array}
 */
export const buildTransportMaltaSST = async ({ seafarer = {}, vessel = {}, rows = [], signatory = {}, company = {} }) => {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Transport Malta template not found (${res.status})`);
  const bytes = await res.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];

  const draw = (text, x, y, size = 9, maxW) => {
    const s = maxW ? fit(font, text, size, maxW) : str(text);
    if (!s) return;
    page.drawText(s, { x, y, size, font, color: INK });
  };

  const vesselLabel = `${str(vessel.name)}${vessel.type ? ` (${str(vessel.type)})` : ''}`.trim();

  // Header — "I certify ... performed by: [name]  I.D. No. [id]  on board the
  // [vessel]  Off./Reg.No. [no]"
  draw(seafarer.fullName, 72, 666, 10, 210);
  draw(seafarer.idNo, 345, 666, 9, 100);
  draw(vesselLabel, 72, 642, 9, 215);
  draw(vessel.officialNo, 368, 642, 9, 150);

  // Service table — ruled cells measured from the template grid. Column borders
  // at x = 63│132│203│270│401│444│525; data-row baselines at y ≈ 486/461/436/411.
  // Columns: From · To · Capacity(Rank) · Name & Type of Vessel · LOA · Max pax.
  const loa = vessel.loaM != null && vessel.loaM !== '' ? `${vessel.loaM} m` : '';
  const pax = vessel.maxPax != null && vessel.maxPax !== '' ? `${vessel.maxPax} pax` : '—';
  let y = 486;
  const ROW = 25;
  for (const r of rows.slice(0, 4)) {
    draw(fmtUk(r.from), 68, y, 8.5, 60);
    draw(fmtUk(r.to), 137, y, 8.5, 62);
    draw(r.capacity, 206, y, 8.5, 62);
    draw(vesselLabel, 274, y, 8, 124);
    draw(loa, 404, y, 8.5, 40);
    draw(pax, 450, y, 8.5, 72);
    y -= ROW;
  }

  // Endorsement block — the master who signs. "Name in full" + "Master" (the
  // signature/date stay blank for them). When the company signs instead (the
  // crew's own master service), the position is left blank and the company is
  // named underneath. Label baselines: Name in full y≈200.8, position y≈176.7,
  // company y≈152.5; values sit just above each dotted line, after the labels.
  draw(signatory.name, 288, 204, 9, 248);
  draw(signatory.position, 288, 180, 9, 105);
  draw(company.name, 288, 156, 9, 248);

  return new Uint8Array(await pdf.save());
};
