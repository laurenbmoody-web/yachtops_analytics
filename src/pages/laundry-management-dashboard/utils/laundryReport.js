// Printable end-of-charter laundry report — opens a clean, self-contained
// page and triggers the browser print dialog (Save as PDF). Built from a
// logbook period so it mirrors what's on screen, on a branded vessel
// letterhead (name / company / flag / port / IMO / logo) when available.

import { LaundryStatus, LaundryPriority, formatLaundryTag } from './laundryStorage';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { [LaundryStatus.IN_PROGRESS]: 'In progress', [LaundryStatus.READY_TO_DELIVER]: 'Ready', [LaundryStatus.DELIVERED]: 'Returned' };
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

function itemRow(it) {
  const care = (it.tags || []).map(formatLaundryTag).join(', ');
  const meta = [it.area, it.colour, care].filter(Boolean).join(' · ');
  const flag = it.flag === 'missing' ? ' — MISSING' : it.flag === 'damaged' ? ' — DAMAGED' : '';
  const urgent = it.priority === LaundryPriority.URGENT ? ' ★' : '';
  return `<tr>
    <td class="d">${esc(it.description || 'Laundry item')}${urgent}<span class="fl">${esc(flag)}</span></td>
    <td class="m">${esc(meta)}</td>
    <td class="s">${esc(STATUS[it.status] || it.status || '')}</td>
    <td class="t">${esc(dmy(it.deliveredAt || it.createdAt))}</td>
  </tr>`;
}

function personBlock(p) {
  const items = (p.items || []).slice().sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
  return `<section class="person">
    <div class="ph"><h3>${esc(p.name)}</h3><span class="pc">${p.count} piece${p.count === 1 ? '' : 's'}</span></div>
    <table><tbody>${items.map(itemRow).join('')}</tbody></table>
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

export function openTripReport(period, vessel) {
  if (!period) return;
  const people = period.people || [];
  const care = (period.care?.bars || []).map((b) => `${esc(b.label)} ${b.count}`).join(' · ');
  const w = window.open('', '_blank');
  if (!w) return;
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
    h1 { font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 30px; margin: 4px 0 2px; }
    .dates { color: #6E6B85; font-size: 13px; margin-bottom: 18px; }
    .summary { display: flex; gap: 30px; border-top: 1px solid #ECECEE; border-bottom: 1px solid #ECECEE; padding: 14px 0; margin-bottom: 8px; }
    .summary b { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 22px; display: block; }
    .summary span { font: 700 8.5px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #6E6B85; }
    .care { font-size: 12px; color: #6E6B85; margin: 10px 0 22px; }
    .person { margin-bottom: 22px; break-inside: avoid; }
    .ph { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1C1B3A; padding-bottom: 5px; margin-bottom: 4px; }
    .ph h3 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 17px; margin: 0; }
    .pc { font: 700 10px system-ui; letter-spacing: 0.06em; text-transform: uppercase; color: #6E6B85; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 6px 8px 6px 0; font-size: 12.5px; vertical-align: top; border-bottom: 1px solid #F0F1F5; }
    td.d { font-weight: 600; width: 42%; }
    td.m { color: #6E6B85; width: 34%; }
    td.s { width: 12%; }
    td.t { width: 12%; text-align: right; color: #6E6B85; font-variant-numeric: tabular-nums; }
    .fl { color: #C24632; font-weight: 700; }
    .foot { margin-top: 26px; padding-top: 12px; border-top: 1px solid #ECECEE; font-size: 11px; color: #AEB4C2; display: flex; justify-content: space-between; }
    @media print { body { padding: 20px; } }
  </style></head><body>
    ${letterhead(vessel)}
    <h1>${esc(period.name)}${period.type === 'voyage' ? ' — voyage' : ''}</h1>
    <div class="dates">${esc(period.dates)}${period.hero ? ` · ${esc(period.hero)}` : ''}</div>
    <div class="summary">
      <div><b>${period.cleaned}</b><span>Cleaned</span></div>
      <div><b>${esc(period.avg)}</b><span>Avg turnaround</span></div>
      <div><b>${esc(period.kpiA?.[0] ?? '')}</b><span>${esc(period.kpiA?.[1] ?? '')}</span></div>
      <div><b>${esc(period.kpiB?.[0] ?? '')}</b><span>${esc(period.kpiB?.[1] ?? '')}</span></div>
    </div>
    ${care ? `<div class="care"><b>By care type:</b> ${care}</div>` : '<div class="care"></div>'}
    ${people.map(personBlock).join('')}
    <div class="foot"><span>${esc(vessel?.name || vessel?.company || 'Cargo')} · Laundry record</span><span>Generated ${dmy(new Date().toISOString())} · Cargo</span></div>
  </body></html>`;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
}
