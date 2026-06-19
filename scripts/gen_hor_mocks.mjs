// Generates three fresh month-end Hours-of-Rest presentation mockups as SVGs.
// Editorial (Cargo) palette + type. Output: /tmp/me_hor_D|E|F.svg
import { writeFileSync } from 'node:fs';

const NAVY = '#1C1B3A', TERRA = '#C65A1A', TERRA_T = '#B14E16';
const MUT = '#8B8478', FAINT = '#AEB4C2', INK2 = '#4B4A66';
const HAIR = '#ECEAE3', HAIR2 = '#F0F1F5', LINE = '#E6E8EF';
const GREEN = '#3F7A52', GREEN_D = '#5C9B6A', INDIGO = '#4A4AB0', INDIGO_D = '#6C6CCF';
const PAGE = '#F8FAFC', CARD = '#FFFFFF', FIELD = '#FAFAF8', PILL = '#FBEFE9';
const SERIF = "'DM Serif Display','DM Serif Text',Georgia,serif";
const SANS = "'Inter','Plus Jakarta Sans',system-ui,sans-serif";

const W = 1080;
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function txt(x, y, s, { size=14, fill=NAVY, weight=400, family=SANS, anchor='start', spacing, italic, transform } = {}) {
  const a = [`x="${x}"`, `y="${y}"`, `font-size="${size}"`, `fill="${fill}"`, `font-weight="${weight}"`, `font-family="${family}"`, `text-anchor="${anchor}"`];
  if (spacing) a.push(`letter-spacing="${spacing}"`);
  if (italic) a.push(`font-style="italic"`);
  if (transform) a.push(`transform="${transform}"`);
  return `<text ${a.join(' ')}>${esc(s)}</text>`;
}
function rect(x,y,w,h,{fill='none',stroke,sw=1,rx=0}={}) {
  const a=[`x="${x}"`,`y="${y}"`,`width="${w}"`,`height="${h}"`,`rx="${rx}"`,`fill="${fill}"`];
  if(stroke){a.push(`stroke="${stroke}"`);a.push(`stroke-width="${sw}"`);}
  return `<rect ${a.join(' ')}/>`;
}
const line=(x1,y1,x2,y2,c=LINE,w=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const dot=(cx,cy,r,fill)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

// shared chrome: page card with eyebrow, category header, and the HOR pack line.
// returns { svg, yAfterLine } so each direction can append its own treatment.
function scaffold(title, sub) {
  const P = 40;            // page padding
  const cardX = 0, cardY = 0;
  let s = '';
  // eyebrow / meta strip
  let y = 54;
  s += dot(P+3, y-4, 3, TERRA);
  s += txt(P+14, y, 'MONTH-END', { size:10, weight:700, spacing:1.6, fill:TERRA });
  s += line(P+96, y-4, P+112, y-4, '#D9D5CA');
  s += txt(P+122, y, 'COMPLIANCE & SAFETY', { size:10, weight:700, spacing:1.4, fill:MUT });
  s += txt(W-P, y, 'MAY 2026', { size:10, weight:700, spacing:1.4, fill:MUT, anchor:'end' });
  // direction title (serif) + caption
  y = 104;
  s += txt(P, y, title, { size:26, family:SERIF, fill:NAVY });
  y = 130;
  s += txt(P, y, sub, { size:13, fill:INK2 });
  // category rule
  y = 168;
  s += txt(P, y, 'Compliance & safety', { size:20, family:SERIF, fill:NAVY });
  s += line(P+200, y-6, W-P, y-6, LINE);
  return { P, startY: 196 };
}

// the HOR pack line itself (shared look across directions). y = top of line.
function horLine(P, y, { actionLink='Review →', expanded=false } = {}) {
  let s = '';
  const h = 62;
  // left accent for "to close"
  s += rect(P-8, y+8, 3, h-16, { fill:TERRA, rx:2 });
  // clock glyph (simple)
  const ix = P+16, iy = y+h/2;
  s += `<circle cx="${ix}" cy="${iy}" r="11" fill="none" stroke="${TERRA}" stroke-width="1.6"/>`;
  s += `<line x1="${ix}" y1="${iy}" x2="${ix}" y2="${iy-6}" stroke="${TERRA}" stroke-width="1.6" stroke-linecap="round"/>`;
  s += `<line x1="${ix}" y1="${iy}" x2="${ix+5}" y2="${iy+2}" stroke="${TERRA}" stroke-width="1.6" stroke-linecap="round"/>`;
  // title + note
  s += txt(P+40, y+27, 'Hours of Rest', { size:18, family:SERIF, fill:NAVY });
  s += txt(P+40, y+46, '3 not started · 1 awaiting approval', { size:11.5, fill:MUT });
  // action link (right)
  s += txt(W-P, y+34, actionLink, { size:12.5, weight:600, fill:TERRA, anchor:'end' });
  return { s, h };
}

// a status pill
function pill(x, y, label, { color=TERRA, bg=PILL, w=null }={}) {
  const pad=11; const ww = w || (label.length*6.6 + pad*2);
  let s = rect(x, y-15, ww, 22, { fill:bg, rx:11 });
  s += txt(x+pad, y, label, { size:11, weight:700, fill:color, spacing:0.3 });
  return { s, w: ww };
}

// crew roster row (compact, hairline). variant: action | confirmed
function crewRow(P, y, { name, role, status, statusColor, meta, action, actionKind }) {
  let s = '';
  const dotC = statusColor;
  s += dot(P+5, y+1, 4.5, dotC);
  s += txt(P+22, y+4, name, { size:14.5, weight:600, fill:NAVY });
  s += txt(P+22, y+21, role, { size:11.5, fill:MUT });
  // status (right-ish)
  const sx = W - P - 250;
  s += txt(sx, y+4, status, { size:12.5, weight:600, fill:statusColor, anchor:'end' });
  if (meta) s += txt(sx, y+21, meta, { size:11, fill:MUT, italic:true, anchor:'end' });
  // action
  if (action) {
    if (actionKind === 'primary') {
      const bw = action.length*7 + 28;
      s += rect(W-P-bw, y-9, bw, 30, { fill:TERRA, rx:8 });
      s += txt(W-P-bw/2, y+10, action, { size:13, weight:600, fill:'#fff', anchor:'middle' });
    } else {
      const bw = action.length*7 + 24;
      s += rect(W-P-bw, y-9, bw, 30, { fill:'#fff', stroke:'#E5E7EB', rx:8 });
      s += txt(W-P-bw/2, y+10, action, { size:13, weight:600, fill:NAVY, anchor:'middle' });
    }
  }
  return s;
}

function wrap(inner, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${SANS}">`
    + rect(0,0,W,h,{fill:PAGE})
    + rect(20,20,W-40,h-40,{fill:CARD, stroke:HAIR, rx:16})
    + inner + `</svg>`;
}

/* ───────────────────────── D · Digest line (never expands) ───────────────── */
{
  const { P, startY } = scaffold(
    'D · Status digest — one line, no expansion',
    'The pack line carries the whole picture: a split bar + counts. “Review” jumps straight to the work.');
  let s = '';
  let y = startY;
  const { s: hs, h } = horLine(P, y, { actionLink:'Review →' });
  s += hs;
  // segmented status bar under the note, spanning the middle
  const barX = P+40, barY = y+54, barW = 520, barH = 7;
  // counts: 6 confirmed, 1 awaiting, 3 not started (total 10)
  const total=10, conf=6, awa=1, ns=3;
  const seg = (n)=> Math.round((n/total)*barW);
  let cx = barX;
  s += rect(barX, barY, barW, barH, { fill:'#EFEDE6', rx:3.5 });
  s += rect(cx, barY, seg(conf), barH, { fill:GREEN_D, rx:3.5 }); cx += seg(conf)+2;
  s += rect(cx, barY, seg(awa), barH, { fill:INDIGO_D, rx:3.5 }); cx += seg(awa)+2;
  s += rect(cx, barY, seg(ns)-2, barH, { fill:TERRA, rx:3.5 });
  s += txt(barX+barW+16, barY+8, '6/10', { size:11.5, weight:600, fill:MUT });
  // legend chips right under
  let ly = y+78; let lx = barX;
  const legend = [['6 confirmed',GREEN_D],['1 to approve',INDIGO_D],['3 not started',TERRA]];
  for (const [lab,c] of legend){ s += dot(lx+4, ly-4, 4, c); s += txt(lx+14, ly, lab, {size:11.5, fill:INK2}); lx += lab.length*6.6+40; }
  // "To close" status pill on the right of the line
  const { s:ps } = pill(W-P-150, y+20, 'TO CLOSE', { color:TERRA, bg:PILL });
  s += ps;
  s += line(P-8, y+108, W-P, y+108, HAIR2);
  // caption footer
  let fy = y+150;
  s += txt(P, fy, 'Why this works', { size:10, weight:700, spacing:1.2, fill:MUT });
  fy+=22;
  s += txt(P, fy, '• The hub never grows — one row regardless of crew size (10 or 25).', {size:13, fill:INK2}); fy+=22;
  s += txt(P, fy, '• You see the shape of the month at a glance (how much is left, and in what state).', {size:13, fill:INK2}); fy+=22;
  s += txt(P, fy, '• “Review” routes to a focused roster (page or drawer) — the list isn’t the hub’s job.', {size:13, fill:INK2});
  const H = fy+40;
  writeFileSync('/tmp/me_hor_D.svg', wrap(s, H));
}

/* ──────────────── E · Actionable peek (confirmed collapse to a count) ─────── */
{
  const { P, startY } = scaffold(
    'E · Actionable peek — only who’s left, inline',
    'Expands on the page, but shows only the crew who need action. The signed-off majority folds to one line.');
  let s = '';
  let y = startY;
  const { s: hs, h } = horLine(P, y, { actionLink:'Hide ▴' });
  s += hs;
  const { s:ps } = pill(W-P-220, y+20, 'TO CLOSE', { color:TERRA, bg:PILL });
  s += ps;
  s += line(P-8, y+h, W-P, y+h, HAIR2);
  // detail region (indented)
  const DX = P+24;
  let dy = y+h+30;
  // section head
  s += txt(DX, dy, 'NEEDS ACTION', { size:10, weight:700, spacing:1.5, fill:MUT });
  // send reminders link/btn
  const rb='Send reminders to all (3)'; const rbw=rb.length*6.8+34;
  s += rect(W-P-rbw, dy-17, rbw, 28, { fill:TERRA, rx:8 });
  s += txt(W-P-rbw/2, dy+2, rb, { size:12.5, weight:600, fill:'#fff', anchor:'middle' });
  dy += 14;
  // action rows
  const rows = [
    { name:'Chief Engineer', role:'Head of House · Interior', status:'Awaiting approval', statusColor:INDIGO, action:'Review & approve', actionKind:'primary' },
    { name:'Claire Dubois', role:'Chief Stewardess · Interior', status:'Not started', statusColor:TERRA_T, meta:'19 days unlogged', action:'Remind', actionKind:'ghost' },
    { name:'Marco Rossi', role:'Second Steward/ess · Interior', status:'Not started', statusColor:TERRA_T, meta:'19 days unlogged', action:'Remind', actionKind:'ghost' },
    { name:'Lauren Moody', role:'Captain · Bridge', status:'Not started', statusColor:TERRA_T, meta:'12 days unlogged', action:'Remind', actionKind:'ghost' },
  ];
  for (const r of rows){ dy+=42; s += crewRow(DX, dy, r); s += line(DX-2, dy+22, W-P, dy+22, HAIR2); }
  // collapsed confirmed line
  dy += 50;
  s += `<path d="M ${DX+2} ${dy-4} l 5 4 l -5 4 z" fill="${GREEN}"/>`; // ▸
  s += dot(DX+20, dy, 4.5, GREEN_D);
  s += txt(DX+34, dy+4, '6 confirmed', { size:13.5, weight:600, fill:GREEN });
  s += txt(DX+150, dy+4, 'Emma Larsen, Sophie van Dijk, James Taylor +3', { size:12, fill:MUT });
  s += txt(W-P, dy+4, 'Show all ▾', { size:12, weight:600, fill:MUT, anchor:'end' });
  s += line(P-8, dy+24, W-P, dy+24, HAIR2);
  // caption
  let fy = dy+62;
  s += txt(P, fy, 'Why this works', { size:10, weight:700, spacing:1.2, fill:MUT }); fy+=22;
  s += txt(P, fy, '• Stays on the page (A’s upside) but the height is bounded by what needs doing, not crew size.', {size:13, fill:INK2}); fy+=22;
  s += txt(P, fy, '• The done crew are one quiet line — present, auditable, but not pushing Sea time off-screen.', {size:13, fill:INK2});
  const H = fy+40;
  writeFileSync('/tmp/me_hor_E.svg', wrap(s, H));
}

/* ──────────────── F · Next-action nudge (no roster, just the to-dos) ──────── */
{
  const { P, startY } = scaffold(
    'F · Next-action nudge — the to-dos, not the roster',
    'The line surfaces only the 1–2 things you can do right now. No per-crew list on the hub at all.');
  let s = '';
  let y = startY;
  const { s: hs } = horLine(P, y, { actionLink:'' });
  s += hs;
  const { s:ps } = pill(W-P-130, y+20, 'TO CLOSE', { color:TERRA, bg:PILL });
  s += ps;
  s += line(P-8, y+62, W-P, y+62, HAIR2);
  // two stacked nudge bars (soft field cards)
  let ny = y+82;
  // nudge 1 — approval (primary)
  s += rect(P+24, ny, W-P-24-(P+24), 56, { fill:PILL, rx:12 });
  s += dot(P+44, ny+28, 4.5, INDIGO_D);
  s += txt(P+62, ny+25, '1 awaiting your approval', { size:14, weight:600, fill:NAVY });
  s += txt(P+62, ny+43, 'Chief Engineer · submitted 12 May', { size:11.5, fill:INK2 });
  { const b='Review & approve'; const bw=b.length*7+28; s+=rect(W-P-24-bw, ny+13, bw, 30, {fill:TERRA, rx:8}); s+=txt(W-P-24-bw/2, ny+33, b, {size:13, weight:600, fill:'#fff', anchor:'middle'}); }
  ny += 70;
  // nudge 2 — not started (remind all)
  s += rect(P+24, ny, W-P-24-(P+24), 56, { fill:FIELD, rx:12, stroke:HAIR });
  s += dot(P+44, ny+28, 4.5, TERRA);
  s += txt(P+62, ny+25, '3 crew not started', { size:14, weight:600, fill:NAVY });
  s += txt(P+62, ny+43, 'Claire Dubois, Marco Rossi, Lauren Moody', { size:11.5, fill:INK2 });
  { const b='Remind all'; const bw=b.length*7+24; s+=rect(W-P-24-bw, ny+13, bw, 30, {fill:'#fff', stroke:'#E5E7EB', rx:8}); s+=txt(W-P-24-bw/2, ny+33, b, {size:13, weight:600, fill:NAVY, anchor:'middle'}); }
  ny += 70;
  // quiet full-roster link
  s += txt(P+24, ny+18, 'See full roster (10) →', { size:12.5, weight:600, fill:MUT });
  s += line(P-8, ny+38, W-P, ny+38, HAIR2);
  // caption
  let fy = ny+76;
  s += txt(P, fy, 'Why this works', { size:10, weight:700, spacing:1.2, fill:MUT }); fy+=22;
  s += txt(P, fy, '• Most compact + most action-forward — the hub answers “what do I do next?”, not “who’s on the list?”.', {size:13, fill:INK2}); fy+=22;
  s += txt(P, fy, '• Collapses many crew into at most two grouped nudges; the full roster is one link away.', {size:13, fill:INK2});
  const H = fy+40;
  writeFileSync('/tmp/me_hor_F.svg', wrap(s, H));
}

console.log('wrote /tmp/me_hor_D.svg, /tmp/me_hor_E.svg, /tmp/me_hor_F.svg');
