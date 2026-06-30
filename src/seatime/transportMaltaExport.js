// Fill the REAL Transport Malta "Sea Service Testimonial Form" (S.L. 499.23)
// from Cargo's logged service, so the crew hand Transport Malta *their own*
// official document, pre-completed, for the endorser to sign.
//
// Two official variants share the same A4 layout but differ in the header field
// positions and the service-table columns:
//   • Deck personnel        — columns: From · To · Capacity · Name & Type ·
//                             Length Overall & Max passengers.
//   • Engineering personnel — columns: Name of Vessel/s · Period (From · To) ·
//                             Capacity (Rank) · Type of vessel & Engine type and
//                             power in kilowatts.
//
// Both official forms are flat PDFs (no AcroForm fields), so we stamp the factual
// service data onto page 1 at coordinates measured against the printed labels and
// the table's ruled grid. The assessment boxes (English/Maltese, conduct,
// ability), the signature, the stamp and the date are deliberately left blank —
// those belong to the endorsing officer, not to us.
//
// Coordinates are PDF user space (origin bottom-left) on the A4 template
// (595.44 × 841.68). One command spell = one vessel; its service rows go in the
// table.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const DECK_TEMPLATE_URL = '/forms/transport_malta_sst_template.pdf';
const ENGINE_TEMPLATE_URL = '/forms/transport_malta_sst_engine_template.pdf';
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

// Shared loader: fetch the template, embed Helvetica, return a draw() bound to
// the first page that truncates to a column width.
const openTemplate = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Transport Malta template not found (${res.status})`);
  const pdf = await PDFDocument.load(await res.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPages()[0];
  const draw = (text, x, y, size = 9, maxW) => {
    const s = maxW ? fit(font, text, size, maxW) : str(text);
    if (!s) return;
    page.drawText(s, { x, y, size, font, color: INK });
  };
  return { pdf, page, draw };
};

/**
 * Deck Personnel testimonial (S.L. 499.23).
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
  const { pdf, draw } = await openTemplate(DECK_TEMPLATE_URL);

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

/**
 * Engineering Personnel testimonial (S.L. 499.23). Same A4 form, but the header
 * sits ~14pt higher and the service table reads Name · From · To · Capacity ·
 * Type & engine power (kW). Grid measured from the template's ruled lines:
 *   columns x = 72│178│256│340│443│537; row rules y = 529.9│505│480│455.5│431.2,
 *   so the four data-row baselines are y ≈ 510/486/461/436.
 * The endorsing officer is the Chief Engineer (or "position in Company"), not the
 * master — the position line reads "Engineer or position in Company".
 * @param {Object} p
 * @param {Object} p.seafarer  { fullName, idNo? }
 * @param {Object} p.vessel    { name, type, flag, officialNo?, powerKW? }
 * @param {Array}  p.rows      [{ from, to, capacity }]
 * @param {Object} [p.signatory] { name, position }  endorsing engineer (name in
 *   full + position, e.g. "Chief Engineer"); blank when the company signs
 * @param {Object} [p.company]   { name }
 * @returns {Uint8Array}
 */
export const buildTransportMaltaEngineSST = async ({ seafarer = {}, vessel = {}, rows = [], signatory = {}, company = {} }) => {
  const { pdf, draw } = await openTemplate(ENGINE_TEMPLATE_URL);

  const vesselLabel = `${str(vessel.name)}${vessel.type ? ` (${str(vessel.type)})` : ''}`.trim();

  // Header — "performed by: [name]  I.D. No. [id]  on board the [vessel]
  // Off./Reg.No. [no]". The engineering form's header rows sit higher than deck.
  draw(seafarer.fullName, 74, 680, 10, 210);
  draw(seafarer.idNo, 350, 680, 9, 105);
  draw(vesselLabel, 74, 656, 9, 210);
  draw(vessel.officialNo, 372, 656, 9, 150);

  // Service table — columns: Name of Vessel/s · From · To · Capacity (Rank) ·
  // Type of vessel & Engine type and power in kW. The engine-power column is
  // composed from the vessel type and (where Cargo holds it) propulsion power;
  // otherwise the type alone, with the endorsing engineer confirming the kW.
  const power = vessel.powerKW != null && vessel.powerKW !== '' ? ` · ${vessel.powerKW} kW` : '';
  const typePower = `${str(vessel.type) || 'Vessel'}${power}`.trim();
  let y = 510;
  const ROW = 24.6;
  for (const r of rows.slice(0, 4)) {
    draw(vesselLabel, 76, y, 8, 98);
    draw(fmtUk(r.from), 182, y, 8.5, 70);
    draw(fmtUk(r.to), 260, y, 8.5, 74);
    draw(r.capacity, 345, y, 8.5, 94);
    draw(typePower, 447, y, 7.5, 86);
    y -= ROW;
  }

  // Endorsement block — "Name in full" y≈204, "Engineer or position in Company"
  // y≈180, "Name of Company" y≈156; dotted lines all start at x≈288.
  draw(signatory.name, 292, 204, 9, 245);
  draw(signatory.position, 292, 180, 9, 245);
  draw(company.name, 292, 156, 9, 245);

  return new Uint8Array(await pdf.save());
};
