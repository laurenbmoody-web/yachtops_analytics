// Fill the real Nautilus "Sea and Onboard Service Testimonial" (Parts 1–2) from
// Cargo's logged service, so the crew hand Nautilus *their own* document,
// pre-completed, for the master to sign and Nautilus to verify.
//
// The template is a LiveCycle/XFA form; pdf-lib drops the XFA layer on load and
// the underlying AcroForm fills cleanly (verified). Parts 3–5 (duties, conduct,
// the master's endorsement and the Nautilus verification block) are deliberately
// left blank — those belong to the master and Nautilus, not us.
//
// Field names were mapped from the form's field geometry against the printed
// labels (see the PR notes). Parts 3–5 live on page 2 and are untouched.

import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';

const TEMPLATE_URL = '/forms/nautilus_sst_template.pdf';
const P = 'Organization[0].#subform[0].'; // page-1 subform prefix

const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };
const str = (v) => (v == null || v === '' ? '' : String(v));

// Set a text field; ignore missing/again-typed fields rather than throwing.
const setText = (form, name, val) => {
  const s = str(val);
  if (!s) return;
  try { form.getTextField(P + name).setText(s); }
  catch (e) { console.warn('[nautilus] text field skipped:', name, e?.message); }
};
// Set a choice (dropdown) field, adding the value as an option so it renders even
// if it isn't in the template's built-in list.
const setChoice = (form, name, val) => {
  const s = str(val);
  if (!s) return;
  try { const dd = form.getDropdown(P + name); dd.addOptions([s]); dd.select(s); }
  catch (e) { console.warn('[nautilus] choice field skipped:', name, e?.message); }
};

// Standby-passages table: 10 rows of (voyage started, voyage ended, days). The
// field names are non-sequential — this is the geometry-derived order.
const PASSAGE_FIELDS = [
  ['DateTimeField3[0]',  'DateTimeField4[0]',  'NumericField1[0]'],
  ['DateTimeField3[2]',  'DateTimeField3[1]',  'NumericField1[1]'],
  ['DateTimeField3[3]',  'DateTimeField4[1]',  'NumericField1[2]'],
  ['DateTimeField3[5]',  'DateTimeField3[4]',  'NumericField1[3]'],
  ['DateTimeField3[6]',  'DateTimeField3[7]',  'NumericField1[4]'],
  ['DateTimeField3[8]',  'DateTimeField4[2]',  'NumericField1[5]'],
  ['DateTimeField3[10]', 'DateTimeField3[9]',  'NumericField1[6]'],
  ['DateTimeField3[11]', 'DateTimeField4[3]',  'NumericField1[7]'],
  ['DateTimeField3[13]', 'DateTimeField3[12]', 'NumericField1[8]'],
  ['DateTimeField3[14]', 'DateTimeField3[15]', 'NumericField1[9]'],
];

/**
 * Build the filled Nautilus SST (Uint8Array).
 * @param {Object} p
 * @param {Object} p.seafarer { fullName, dob, dischargeBook, nationalId, nautilusNo, email }
 * @param {Object} p.vessel   { type, flag, name, imo, officialNo, lengthM, gt, kw }
 * @param {Object} p.company  { shipowner, addr1, addr2, zip, country, phone, email }
 * @param {Object} p.service  { capacity, from, to, totalDaysOnboard, leaveDays, actualSea, standby, yard, watchkeeping }
 * @param {Array}  [p.standbyPassages]  [{ from, to, days }]
 */
export const buildNautilusSST = async ({ seafarer = {}, vessel = {}, company = {}, service = {}, standbyPassages = [] }) => {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error(`Nautilus template not found (${res.status})`);
  const bytes = await res.arrayBuffer();
  const pdf = await PDFDocument.load(bytes); // pdf-lib strips XFA here
  const form = pdf.getForm();

  // Part 1 — company / contact
  setText(form, 'ShipOwner[0]', company.shipowner);
  setText(form, 'Adress[0]', company.addr1);
  setText(form, 'Adress[1]', company.addr2);
  setText(form, 'Adress[2]', company.zip);
  setText(form, 'Phone[0]', company.phone);
  setText(form, 'email[0]', company.email);
  setChoice(form, 'Country[0]', company.country);

  // Part 2 — seafarer
  setChoice(form, 'DropDownList1[0]', service.capacity);
  setText(form, 'Name[0]', seafarer.fullName);
  setText(form, 'NautilusSRB[1]', seafarer.dischargeBook);
  setText(form, 'DoB[0]', fmtUk(seafarer.dob));
  setText(form, 'NautilusSRB[2]', seafarer.nationalId);
  setText(form, 'NautilusSRB[0]', seafarer.nautilusNo);
  setText(form, 'email[1]', seafarer.email);

  // Part 2 — vessel
  setChoice(form, 'DropDownList2[0]', vessel.type);
  setChoice(form, 'Country[1]', vessel.flag);
  setText(form, 'Name[1]', vessel.name);
  setText(form, 'OfficialNo[1]', vessel.imo);
  setText(form, 'OfficialNo[0]', vessel.officialNo);
  setText(form, 'Name[2]', vessel.lengthM);
  setText(form, 'Name[3]', vessel.gt);
  setText(form, 'Name[4]', vessel.kw);

  // Part 2 — period + service totals
  setText(form, 'From[0]', fmtUk(service.from));
  setText(form, 'From[1]', fmtUk(service.to));
  setText(form, 'TotalDays[1]', service.leaveDays);
  setText(form, 'TotalDays[0]', service.totalDaysOnboard);
  setText(form, 'TotalDays[2]', service.actualSea);
  setText(form, 'TotalDays[3]', service.standby);
  setText(form, 'TotalDays[4]', service.yard);
  setText(form, 'TotalDays[5]', service.watchkeeping);

  // Part 2 — standby passages table (first 10)
  standbyPassages.slice(0, PASSAGE_FIELDS.length).forEach((pp, i) => {
    const [fStart, fEnd, fDays] = PASSAGE_FIELDS[i];
    setText(form, fStart, fmtUk(pp.from));
    setText(form, fEnd, fmtUk(pp.to));
    setText(form, fDays, pp.days);
  });

  // Ask viewers to regenerate field appearances so the values render.
  try {
    const acro = pdf.context.lookup(pdf.catalog.get(PDFName.of('AcroForm')));
    acro?.set?.(PDFName.of('NeedAppearances'), PDFBool.True);
  } catch { /* non-fatal */ }
  try { form.updateFieldAppearances(); } catch { /* non-fatal */ }

  return new Uint8Array(await pdf.save());
};
