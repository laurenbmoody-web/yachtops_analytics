import { jsPDF } from 'jspdf';
import { supabase } from '../../../lib/supabaseClient';

// ---- palette (mirrors the Cargo editorial system) -------------------------
const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const MUTED = [139, 132, 120];
const FAINT = [174, 180, 194];
const HAIR = [240, 241, 245];
const PAPER = [255, 255, 255];
const DARK_BG = [28, 27, 58];
const DARK_INK = [231, 230, 239];
const DARK_ACCENT = [230, 165, 126];

const initials = (name) =>
  String(name || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

const wordCount = (s) => (String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0);

/**
 * Pull every crew member's profile statement for the tenant and merge it with
 * the crew list the page already holds (name + role). Crew without a statement
 * are still returned (so the Chief can see who's missing one).
 */
export const fetchGuestBookEntries = async (tenantId, crew = []) => {
  const ids = crew.map((c) => c.user_id || c.id).filter(Boolean);
  let statements = {};
  if (ids.length) {
    const { data, error } = await supabase
      .from('crew_profile_statements')
      .select('user_id, statement, headline, hometown, languages, interests')
      .in('user_id', ids);
    if (error) console.error('[guestbook] statement fetch failed', error);
    for (const row of data || []) statements[row.user_id] = row;
  }
  return crew.map((c) => {
    const uid = c.user_id || c.id;
    const s = statements[uid] || {};
    return {
      userId: uid,
      name: c.fullName || c.full_name || 'Crew member',
      role: c.roleTitle || c.role || '',
      department: c.department || '',
      statement: s.statement || '',
      headline: s.headline || '',
      hometown: s.hometown || '',
      languages: s.languages || '',
      interests: s.interests || '',
      words: wordCount(s.statement),
      hasStatement: !!(s.statement && s.statement.trim()),
    };
  });
};

/**
 * "Match my own" — send an image of an existing guest-book / crew-profile page
 * to the AI, which maps it to our layout engine and returns settings:
 * { template, orientation, perPage, rationale }.
 */
export const adaptTemplateFromImage = async ({ imageBase64, mediaType }) => {
  const { data, error } = await supabase.functions.invoke('adapt-guestbook-template', {
    body: { imageBase64, mediaType },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
};

/** Vessel name for the document title (vessels are keyed by tenant). */
export const fetchVesselName = async (tenantId) => {
  if (!tenantId) return '';
  const { data } = await supabase.from('vessels').select('name').eq('tenant_id', tenantId).maybeSingle();
  return data?.name || '';
};

// ---- PDF engine -----------------------------------------------------------

// Per-page count when "auto": fewer cards as statements get wordier, and fewer
// in landscape (cards are wider but shorter).
const autoPerPage = (entries, orientation) => {
  const avg = entries.length ? entries.reduce((a, e) => a + e.words, 0) / entries.length : 60;
  let n = avg > 95 ? 2 : avg > 60 ? 3 : 4;
  if (orientation === 'landscape') n = Math.min(n, 3);
  return Math.max(2, n);
};

// Fit a block of text into a height budget: start at maxPt, shrink toward minPt,
// then truncate lines (…) so it never overflows the slot.
const fitParagraph = (doc, text, width, hBudget, maxPt, minPt) => {
  for (let pt = maxPt; pt >= minPt; pt -= 0.5) {
    doc.setFontSize(pt);
    const lh = pt * 0.42; // mm per line at this size
    const lines = doc.splitTextToSize(text, width);
    if (lines.length * lh <= hBudget) return { pt, lines, lh };
  }
  doc.setFontSize(minPt);
  const lh = minPt * 0.42;
  let lines = doc.splitTextToSize(text, width);
  const maxLines = Math.max(1, Math.floor(hBudget / lh));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S*$/, '') + '…';
  }
  return { pt: minPt, lines, lh };
};

const drawCard = (doc, t, x, y, w, h, entry, template, minFont) => {
  const dark = template === 'editorial';
  const ink = dark ? DARK_INK : NAVY;
  const accent = dark ? DARK_ACCENT : TERRA;
  const pad = 4;

  const monogram = (cx, cy, r) => {
    doc.setFillColor(dark ? 51 : 233, dark ? 50 : 228, dark ? 90 : 220);
    doc.circle(cx, cy, r, 'F');
    doc.setTextColor(dark ? 200 : 160, dark ? 199 : 142, dark ? 220 : 125);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(r * 2.4);
    doc.text(initials(entry.name), cx, cy + r * 0.32, { align: 'center' });
  };

  if (template === 'side') {
    // photo/monogram left, text right
    const r = Math.min(11, h / 2 - pad);
    monogram(x + r + pad, y + r + pad, r);
    const tx = x + 2 * r + pad * 2 + 4;
    const tw = x + w - tx;
    let cy = y + pad + 5;
    doc.setTextColor(...ink); doc.setFont('times', 'normal'); doc.setFontSize(15);
    doc.text(entry.name, tx, cy); cy += 5;
    if (entry.role) {
      doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.text(entry.role.toUpperCase(), tx, cy); cy += 4;
    }
    doc.setTextColor(dark ? 185 : 75, dark ? 184 : 74, dark ? 207 : 94);
    doc.setFont('helvetica', 'normal');
    const fit = fitParagraph(doc, entry.statement || '—', tw, y + h - cy - pad, 11, minFont);
    doc.setFontSize(fit.pt);
    fit.lines.forEach((ln, i) => doc.text(ln, tx, cy + 3 + i * fit.lh));
  } else {
    // classic / editorial — centred portrait
    const cx = x + w / 2;
    const r = Math.min(11, h * 0.16);
    monogram(cx, y + pad + r, r);
    let cy = y + pad + 2 * r + 5;
    doc.setTextColor(...ink); doc.setFont('times', 'normal'); doc.setFontSize(15);
    doc.text(entry.name, cx, cy, { align: 'center' }); cy += 5;
    if (entry.role) {
      doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.text(entry.role.toUpperCase(), cx, cy, { align: 'center' }); cy += 4;
    }
    doc.setTextColor(dark ? 185 : 75, dark ? 184 : 74, dark ? 207 : 94);
    doc.setFont('helvetica', 'normal');
    const tw = w - 2 * pad - 8;
    const fit = fitParagraph(doc, entry.statement || '—', tw, y + h - cy - pad, 11, minFont);
    doc.setFontSize(fit.pt);
    fit.lines.forEach((ln, i) => doc.text(ln, cx, cy + 3 + i * fit.lh, { align: 'center' }));
  }
};

/**
 * Render the guest book to a PDF and trigger a download.
 * opts: { title, subtitle, entries (ordered), template, orientation, perPage, minFont, includeMissing }
 */
export const exportGuestBookPDF = ({
  title = 'Our crew', subtitle = '', entries = [],
  template = 'classic', orientation = 'portrait', perPage = 3, minFont = 9,
  includeMissing = false,
}) => {
  const list = includeMissing ? entries : entries.filter((e) => e.hasStatement);
  if (!list.length) return { pages: 0, count: 0 };

  const dark = template === 'editorial';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientation === 'landscape' ? 'landscape' : 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16;
  const per = perPage === 'auto' ? autoPerPage(list, orientation) : Number(perPage);

  const headerH = 22;
  const footerH = 12;
  const colCount = orientation === 'landscape' && per >= 3 ? 2 : 1;
  const rows = Math.ceil(per / colCount);

  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));

  pages.forEach((pageEntries, pIdx) => {
    if (pIdx > 0) doc.addPage();
    if (dark) { doc.setFillColor(...DARK_BG); doc.rect(0, 0, pageW, pageH, 'F'); }

    // page header
    doc.setTextColor(...(dark ? PAPER : NAVY));
    doc.setFont('times', 'normal'); doc.setFontSize(20);
    doc.text(title, pageW / 2, M, { align: 'center' });
    if (subtitle) {
      doc.setTextColor(...(dark ? DARK_ACCENT : MUTED));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text(subtitle.toUpperCase(), pageW / 2, M + 5, { align: 'center', charSpace: 0.6 });
    }
    doc.setDrawColor(...(dark ? [51, 50, 90] : HAIR));
    doc.line(M, M + 9, pageW - M, M + 9);

    // card grid
    const gridY = M + 14;
    const gridH = pageH - gridY - footerH;
    const gridW = pageW - 2 * M;
    const colW = (gridW - (colCount - 1) * 8) / colCount;
    const rowH = (gridH - (rows - 1) * 6) / rows;

    pageEntries.forEach((entry, idx) => {
      const c = idx % colCount;
      const r = Math.floor(idx / colCount);
      const x = M + c * (colW + 8);
      const y = gridY + r * (rowH + 6);
      drawCard(doc, null, x, y, colW, rowH, entry, template, minFont);
      // hairline between stacked cards
      if (r < rows - 1 || (idx + colCount < pageEntries.length)) {
        doc.setDrawColor(...(dark ? [44, 43, 78] : HAIR));
        doc.line(x, y + rowH + 3, x + colW, y + rowH + 3);
      }
    });

    // footer
    doc.setTextColor(...(dark ? [120, 120, 150] : FAINT));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(`${title} · Guest information`, M, pageH - 7);
    doc.text(`${pIdx + 1} / ${pages.length}`, pageW - M, pageH - 7, { align: 'right' });
  });

  const safe = String(title || 'crew').replace(/[^\w]+/g, '-');
  doc.save(`Guest-book-${safe}.pdf`);
  return { pages: pages.length, count: list.length };
};
