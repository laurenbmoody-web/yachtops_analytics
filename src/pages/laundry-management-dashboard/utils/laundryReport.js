// Printable end-of-charter laundry report — opens a clean, self-contained
// page and triggers the browser print dialog (Save as PDF). Built from a
// logbook period so it mirrors what's on screen, on a branded vessel
// letterhead (name / company / flag / port / IMO / logo) when available.
//
// Each piece shows both its logged and returned dates, any notes / damage
// detail, and — for damaged items — a photo as evidence. A Cargo wordmark
// signs off the footer.

import { LaundryStatus, LaundryPriority, formatLaundryTag } from './laundryStorage';
import { resolveLaundryPhotos } from './laundryPhotos';
import { billingSummary, isBillable, effectiveCharge, money } from './laundryBilling';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { [LaundryStatus.IN_PROGRESS]: 'In progress', [LaundryStatus.READY_TO_DELIVER]: 'Ready', [LaundryStatus.DELIVERED]: 'Returned' };
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

// chargeCell: '' → blank cell, a string → the amount, null → no charge column.
function itemRow(it, photoUrl, chargeCell) {
  const care = (it.tags || []).map(formatLaundryTag).join(', ');
  // area is shown once next to the person's name; keep the row to colour + care
  const meta = [it.colour, care].filter(Boolean).join(' · ');
  const flag = it.flag === 'missing' ? ' — MISSING' : it.flag === 'damaged' ? ' — DAMAGED' : '';
  const urgent = it.priority === LaundryPriority.URGENT ? ' ★' : '';
  const note = [it.notes, it.flagNote].filter(Boolean).join(' · ');
  const thumb = photoUrl ? `<img class="ev" src="${esc(photoUrl)}" alt="" crossorigin="anonymous" onerror="this.style.display='none'" />` : '';
  return `<tr>
    <td class="d">
      <div class="drow">${thumb}<div>
        <span class="dn">${esc(it.description || 'Laundry item')}${urgent}<span class="fl">${esc(flag)}</span></span>
        ${meta ? `<span class="dm">${esc(meta)}</span>` : ''}
        ${note ? `<span class="note">${esc(note)}</span>` : ''}
      </div></div>
    </td>
    <td class="t">${esc(dmy(it.createdAt))}</td>
    <td class="t">${esc(it.deliveredAt ? dmy(it.deliveredAt) : '—')}</td>
    <td class="s">${esc(STATUS[it.status] || it.status || '')}</td>
    ${chargeCell == null ? '' : `<td class="cg-amt">${chargeCell}</td>`}
  </tr>`;
}

// bill = { config, basis } when this is a plus-expenses charter, else null.
function personBlock(p, photoMap, bill) {
  const items = (p.items || []).slice().sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
  const tag = p.area ? `<span class="ptag">${p.kind === 'crew' ? `No. ${esc(p.area)}` : esc(p.area)}</span>` : '';
  const pin = p.colour ? `<span class="ppin" style="background:${esc(p.colour)}"></span>` : '';
  let subtotal = 0;
  const rows = items.map((it) => {
    let cell = null;
    if (bill) {
      const billable = isBillable(it, bill.basis, bill.config);
      const amt = billable ? effectiveCharge(it, bill.config) : 0;
      if (billable) subtotal += amt;
      cell = billable ? esc(money(amt, bill.config.currency)) : '';
    }
    return itemRow(it, photoMap[it.id], cell);
  }).join('');
  const chargeHead = bill ? '<th class="cg-amt">Charge</th>' : '';
  const subtotalRow = (bill && subtotal > 0)
    ? `<tr class="cg-sub-row"><td class="d" colspan="4">Subtotal</td><td class="cg-amt">${esc(money(subtotal, bill.config.currency))}</td></tr>`
    : '';
  return `<section class="person">
    <div class="ph"><h3>${esc(p.name)}${tag}${pin}</h3><span class="pc">${p.count} piece${p.count === 1 ? '' : 's'}</span></div>
    <table>
      <thead><tr><th class="d">Item</th><th class="t">Logged</th><th class="t">Returned</th><th class="s">Status</th>${chargeHead}</tr></thead>
      <tbody>${rows}${subtotalRow}</tbody>
    </table>
  </section>`;
}

// Branded letterhead — logo (or a serif monogram fallback) + vessel identity.
function letterhead(v) {
  if (!v || !(v.name || v.company)) {
    return '<div class="eyebrow">Laundry report</div>';
  }
  const meta = [v.flag, v.port, v.imo ? `IMO ${v.imo}` : ''].filter(Boolean).join('  ·  ');
  const mark = v.logoUrl
    ? `<img class="lh-logo" src="${esc(v.logoUrl)}" alt="" crossorigin="anonymous" onerror="this.style.display='none'" />`
    : `<span class="lh-mono">${esc((v.name || v.company || '?').trim().charAt(0).toUpperCase())}</span>`;
  return `<div class="lh">
    ${mark}
    <div class="lh-id">
      <div class="lh-name">${esc(v.name || v.company)}</div>
      ${v.company && v.name ? `<div class="lh-co">${esc(v.company)}</div>` : ''}
      ${meta ? `<div class="lh-meta">${esc(meta)}</div>` : ''}
    </div>
    <div class="lh-tag">Laundry report</div>
  </div>`;
}

// Sign the photos of damaged items only — evidence, and it keeps the signed
// set (and the PDF) small. Missing items have nothing to show.
async function evidenceMap(people) {
  const flagged = [];
  (people || []).forEach((p) => (p.items || []).forEach((it) => {
    if (it.flag === 'damaged' && (it.photos?.length || it.photo)) flagged.push(it);
  }));
  if (!flagged.length) return {};
  try {
    const resolved = await resolveLaundryPhotos(flagged.map((f) => ({ id: f.id, photos: f.photos && f.photos.length ? f.photos : (f.photo ? [f.photo] : []) })));
    const map = {};
    resolved.forEach((r) => { if (r.photos?.[0]) map[r.id] = r.photos[0]; });
    return map;
  } catch (e) {
    return {};
  }
}

// The single charter-charges total under the per-person tables (plus-expenses).
function chargesTotal(period, billing) {
  if (period?.billingBasis !== 'plus_expenses' || !billing) return '';
  const { total, currency } = billingSummary(period.items || [], period.billingBasis, billing);
  if (!total) return '';
  return `<div class="cg-grand"><span>Charter laundry charges — personal laundry, at cost</span><b>${esc(money(total, currency))}</b></div>
  <div class="cg-note">Guests’ personal laundry, chargeable under a plus-expenses (MYBA) charter. Ship’s linen and crew are not charged.</div>`;
}

export async function openTripReport(period, vessel, billing) {
  if (!period) return;
  // Open synchronously so the browser doesn't block the pop-up, then fill it
  // once the evidence photos are signed.
  const w = window.open('', '_blank');
  if (!w) return;
  try { w.document.write('<!doctype html><meta charset="utf-8"><title>Laundry report</title><body style="font-family:system-ui,sans-serif;color:#8B8478;padding:44px">Preparing report…</body>'); } catch (e) { /* noop */ }

  const people = period.people || [];
  // Charter charges apply only on a plus-expenses (MYBA) voyage.
  const bill = (period.billingBasis === 'plus_expenses' && billing) ? { config: billing, basis: period.billingBasis } : null;
  const photoMap = await evidenceMap(people);
  const care = (period.care?.bars || []).map((b) => `${esc(b.label)} ${b.count}`).join(' · ');
  const cargoLogo = `${(typeof window !== 'undefined' && window.location ? window.location.origin : '')}/centered-logo.svg`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Laundry — ${esc(period.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; margin: 0; padding: 40px 46px; }
    /* Letterhead */
    .lh { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; margin-bottom: 20px; border-bottom: 2px solid #1C1B3A; }
    .lh-logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; flex: none; }
    .lh-mono { width: 52px; height: 52px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center;
      background: #FBEFE9; color: #C65A1A; font-family: 'DM Serif Display', Georgia, serif; font-size: 26px; }
    .lh-id { flex: 1; min-width: 0; }
    .lh-name { font-family: 'DM Serif Display', Georgia, serif; font-size: 24px; line-height: 1.05; }
    .lh-co { font-size: 12px; color: #6E6B85; margin-top: 2px; }
    .lh-meta { font: 700 8.5px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #8B8478; margin-top: 5px; }
    .lh-tag { font: 700 9px system-ui; letter-spacing: 0.14em; text-transform: uppercase; color: #C65A1A; align-self: flex-start; padding-top: 3px; }
    .eyebrow { font: 700 10px system-ui; letter-spacing: 0.14em; text-transform: uppercase; color: #C65A1A; }
    .titlerow { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; border-bottom: 1px solid #ECECEE; padding-bottom: 14px; margin-bottom: 18px; }
    h1 { font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 30px; margin: 4px 0 2px; }
    .dates { color: #6E6B85; font-size: 13px; }
    .summary { display: flex; gap: 28px; flex: none; }
    .summary div { text-align: right; }
    .summary b { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 22px; display: block; line-height: 1.05; }
    .summary span { font: 700 8.5px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #6E6B85; }
    .care { font-size: 12px; color: #6E6B85; margin: 10px 0 22px; }
    .person { margin-bottom: 22px; break-inside: avoid; }
    .ph { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1C1B3A; padding-bottom: 5px; margin-bottom: 4px; }
    .ph h3 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 17px; margin: 0; }
    .ptag { font: 700 8.5px system-ui; letter-spacing: 0.04em; color: #6E6B85; background: #F6F5F2; border: 1px solid #ECEAE3; border-radius: 999px; padding: 2px 8px; margin-left: 9px; vertical-align: middle; }
    .ppin { display: inline-block; width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(28,27,58,0.2); margin-left: 6px; vertical-align: middle; }
    .pc { font: 700 10px system-ui; letter-spacing: 0.06em; text-transform: uppercase; color: #6E6B85; }
    table { width: 100%; border-collapse: collapse; }
    th { font: 700 8px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #AEB4C2; text-align: left; padding: 4px 8px 6px 0; border-bottom: 1px solid #ECECEE; }
    th.t, th.s { text-align: left; }
    td { padding: 7px 8px 7px 0; font-size: 12.5px; vertical-align: top; border-bottom: 1px solid #F0F1F5; }
    td.d { width: auto; }
    .drow { display: flex; gap: 9px; align-items: flex-start; }
    .ev { width: 38px; height: 38px; object-fit: cover; border-radius: 5px; border: 1px solid #ECECEE; flex: none; }
    .dn { font-weight: 600; display: block; }
    .dm { display: block; color: #6E6B85; font-size: 11.5px; margin-top: 1px; }
    .note { display: block; color: #8B8478; font-size: 11px; margin-top: 2px; font-style: italic; }
    td.t { width: 15%; color: #4A4863; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.s { width: 14%; }
    .fl { color: #C24632; font-weight: 700; }
    th.cg-amt, td.cg-amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 14%; }
    td.cg-amt { font-weight: 600; color: #C65A1A; }
    .cg-sub-row td { border-top: 1px solid #ECECEE; border-bottom: none; font-weight: 700; color: #1C1B3A; padding-top: 8px; }
    .cg-sub-row td.cg-amt { color: #1C1B3A; }
    .cg-grand { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; margin-top: 18px; padding-top: 12px; border-top: 2px solid #1C1B3A; break-inside: avoid; }
    .cg-grand span { font: 700 10px system-ui; letter-spacing: 0.06em; text-transform: uppercase; color: #1C1B3A; }
    .cg-grand b { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 22px; color: #C65A1A; }
    .cg-note { font-size: 11px; color: #8B8478; margin-top: 8px; font-style: italic; }
    .foot { margin-top: 26px; padding-top: 12px; border-top: 1px solid #ECECEE; font-size: 11px; color: #AEB4C2; display: flex; align-items: center; justify-content: space-between; }
    .foot .cg { display: inline-flex; align-items: center; gap: 6px; }
    .cargo-mark { height: 15px; opacity: 0.8; }
    @media print {
      body { padding: 20px 20px 52px; }
      /* Pin the footer to the bottom of the page instead of letting it
         flow onto an orphan page after the last person block. */
      .foot { position: fixed; left: 20px; right: 20px; bottom: 14px; margin-top: 0; padding-top: 8px; background: #FFFFFF; }
    }
  </style></head><body>
    ${letterhead(vessel)}
    <div class="titlerow">
      <div class="titleblock">
        <h1>${esc(period.name)}</h1>
        <div class="dates">${esc(period.dates)}${period.hero ? ` · ${esc(period.hero)}` : ''}</div>
      </div>
      <div class="summary">
        <div><b>${period.cleaned}</b><span>Cleaned</span></div>
        <div><b>${esc(period.avg)}</b><span>Avg turnaround</span></div>
        <div><b>${esc(period.kpiA?.[0] ?? '')}</b><span>${esc(period.kpiA?.[1] ?? '')}</span></div>
        <div><b>${esc(period.kpiB?.[0] ?? '')}</b><span>${esc(period.kpiB?.[1] ?? '')}</span></div>
      </div>
    </div>
    ${care ? `<div class="care"><b>By care type:</b> ${care}</div>` : '<div class="care"></div>'}
    ${people.map((p) => personBlock(p, photoMap, bill)).join('')}
    ${chargesTotal(period, billing)}
    <div class="foot">
      <span>${esc(vessel?.name || vessel?.company || 'Cargo')} · Laundry record · Generated ${dmy(new Date().toISOString())}</span>
      <span class="cg"><img class="cargo-mark" src="${esc(cargoLogo)}" alt="Cargo" onerror="this.style.display='none'" /></span>
    </div>
  </body></html>`;
  try {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 400);
  } catch (e) { /* window closed */ }
}
