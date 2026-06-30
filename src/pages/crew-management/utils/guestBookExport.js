import { jsPDF } from 'jspdf';
import {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, VerticalAlign,
} from 'docx';
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

const hexToRgb = (hex, fallback) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ''));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
};

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
  let photos = {};
  if (ids.length) {
    const [stmtRes, profRes] = await Promise.all([
      supabase
        .from('crew_profile_statements')
        .select('user_id, statement, fun_fact, hometown, languages, interests, favourite_destination, years_yachting')
        .in('user_id', ids),
      supabase.from('profiles').select('id, avatar_url').in('id', ids),
    ]);
    if (stmtRes.error) console.error('[guestbook] statement fetch failed', stmtRes.error);
    for (const row of stmtRes.data || []) statements[row.user_id] = row;
    for (const row of profRes.data || []) photos[row.id] = row.avatar_url || '';
  }
  return crew.map((c) => {
    const uid = c.user_id || c.id;
    const s = statements[uid] || {};
    return {
      userId: uid,
      name: c.fullName || c.full_name || 'Crew member',
      role: c.roleTitle || c.role || '',
      department: c.department || '',
      photo: photos[uid] || c.avatarUrl || c.avatar_url || '',
      statement: s.statement || '',
      funFact: s.fun_fact || '',
      hometown: s.hometown || '',
      languages: s.languages || '',
      interests: s.interests || '',
      favouriteDestination: s.favourite_destination || '',
      yearsYachting: s.years_yachting || '',
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

/** Vessel name + logo for the document (title + letterhead mark). */
export const fetchVesselBrand = async (tenantId) => {
  if (!tenantId) return { name: '', logoUrl: '' };
  const { data } = await supabase.from('vessels').select('name, logo_url').eq('tenant_id', tenantId).maybeSingle();
  return { name: data?.name || '', logoUrl: data?.logo_url || '' };
};

/**
 * Load a logo URL into a PNG data-URL (+ aspect ratio) for jsPDF.addImage.
 * Drawn to a canvas so any format (incl. webp) becomes a PDF-safe PNG; returns
 * null on CORS taint / load failure so the export just omits the mark.
 */
export const loadLogoForPdf = (url) => new Promise((resolve) => {
  if (!url) { resolve(null); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), aspect: img.naturalWidth / img.naturalHeight || 1 });
    } catch { resolve(null); }
  };
  img.onerror = () => resolve(null);
  img.src = url;
});

/** Load a crew photo into a circular PNG data-URL (cover-cropped) for the PDF. */
export const loadAvatarForPdf = (url, size = 180) => new Promise((resolve) => {
  if (!url) { resolve(null); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/png'));
    } catch { resolve(null); }
  };
  img.onerror = () => resolve(null);
  img.src = url;
});

// ---- PDF engine -----------------------------------------------------------

// Per-page count when "auto": fewer cards as statements get wordier, and fewer
// in landscape (cards are wider but shorter).
export const autoPerPage = (entries, orientation) => {
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

// One crew member as a horizontal strip: a vertically-centred monogram on one
// side, name/role/statement on the other. Side-by-side uses the card's WIDTH
// (not its height), so the statement fits cleanly at any per-page count and in
// landscape — and the photo alternates side ('classic') for editorial rhythm.
const drawCard = (doc, x, y, w, h, entry, template, minFont, idx = 0, avatar = null, valign = 'center', ink = NAVY, accent = TERRA) => {
  const bodyInk = [75, 74, 94];
  const pad = 4;
  const photoLeft = template === 'classic' ? (idx % 2 === 0) : true;

  const r = Math.min(14, h / 2 - pad);
  const photoCX = photoLeft ? x + pad + r : x + w - pad - r;
  const gap = 6;
  const tx = photoLeft ? x + 2 * r + pad + gap : x + pad;
  const tw = w - 2 * r - pad * 2 - gap;

  // Measure the text block first, then centre the whole card (photo + text)
  // within its slot — short statements sit with balanced space above/below
  // rather than all the gap dropping to the bottom.
  const nameH = 5.4;
  const roleH = entry.role ? 4.5 : 0;
  doc.setFont('helvetica', 'normal');
  const fit = fitParagraph(doc, entry.statement || '—', tw, h - 2 * pad - nameH - roleH, 11, minFont);
  const blockH = nameH + roleH + 3 + fit.lines.length * fit.lh;
  const contentH = Math.max(blockH, 2 * r);
  const topY = valign === 'top' ? y + pad : y + Math.max(0, (h - contentH) / 2);
  const photoCY = topY + contentH / 2;

  // photo — real avatar (circular PNG) if we have one, else a monogram disc
  if (avatar) {
    try { doc.addImage(avatar, 'PNG', photoCX - r, photoCY - r, 2 * r, 2 * r); } catch { /* fall through */ }
  } else {
    doc.setFillColor(dark ? 51 : 233, dark ? 50 : 228, dark ? 90 : 220);
    doc.circle(photoCX, photoCY, r, 'F');
    doc.setTextColor(dark ? 200 : 160, dark ? 199 : 142, dark ? 220 : 125);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(r * 2.2);
    doc.text(initials(entry.name), photoCX, photoCY + r * 0.32, { align: 'center' });
  }

  let cy = topY + nameH;
  doc.setTextColor(...ink); doc.setFont('times', 'normal'); doc.setFontSize(14.5);
  doc.text(entry.name, tx, cy);
  if (entry.role) {
    doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text(entry.role.toUpperCase(), tx, cy + roleH, { charSpace: 0.4 });
  }
  cy += roleH + 3;
  doc.setTextColor(...bodyInk); doc.setFont('helvetica', 'normal'); doc.setFontSize(fit.pt);
  fit.lines.forEach((ln, i) => doc.text(ln, tx, cy + 3 + i * fit.lh));
};

/**
 * Render the guest book to a PDF and trigger a download.
 * opts: { title, subtitle, entries (ordered), template, orientation, perPage, minFont, includeMissing }
 */
export const buildGuestBookPDF = ({
  title = 'Our crew', subtitle = '', entries = [],
  template = 'classic', orientation = 'portrait', perPage = 3, minFont = 9,
  includeMissing = false, logo = null, avatars = {}, valign = 'center', showTitle = true,
  headingColor = '#1C1B3A', accentColor = '#C65A1A', titleSize = 20, subtitleSize = 8,
}) => {
  const list = includeMissing ? entries : entries.filter((e) => e.hasStatement);
  if (!list.length) return { doc: null, pages: 0, count: 0 };

  const headingRgb = hexToRgb(headingColor, NAVY);
  const accentRgb = hexToRgb(accentColor, TERRA);
  const dark = false;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientation === 'landscape' ? 'landscape' : 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 16;
  const per = perPage === 'auto' ? autoPerPage(list, orientation) : Number(perPage);

  const footerH = 12;
  // Full-width horizontal strips, one per row — the statement reads across the
  // page width, so it fits at any per-page count and in landscape.
  const colCount = 1;
  const rows = per;

  // Letterhead logo (centred above the title) — sized from its aspect ratio.
  const logoH = logo?.dataUrl ? 13 : 0;
  const logoW = logo?.dataUrl ? Math.min(50, logoH * (logo.aspect || 1)) : 0;

  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));

  pages.forEach((pageEntries, pIdx) => {
    if (pIdx > 0) doc.addPage();
    if (dark) { doc.setFillColor(...DARK_BG); doc.rect(0, 0, pageW, pageH, 'F'); }

    // page header — optional logo, then title + subtitle + hairline
    let hy = M - 5;
    if (logo?.dataUrl) {
      try { doc.addImage(logo.dataUrl, 'PNG', pageW / 2 - logoW / 2, hy, logoW, logoH); } catch { /* skip */ }
      hy += logoH + 3;
    }
    if (showTitle && title) {
      doc.setTextColor(...headingRgb);
      doc.setFont('times', 'normal'); doc.setFontSize(titleSize);
      doc.text(title, pageW / 2, hy + titleSize * 0.3, { align: 'center' });
      hy += titleSize * 0.42;
    }
    if (subtitle) {
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(subtitleSize);
      doc.text(subtitle.toUpperCase(), pageW / 2, hy + 4, { align: 'center', charSpace: 0.6 });
      hy += 5;
    }
    doc.setDrawColor(...(dark ? [51, 50, 90] : HAIR));
    doc.line(M, hy + 4, pageW - M, hy + 4);

    // card grid
    const gridY = hy + 9;
    const gridH = pageH - gridY - footerH;
    const gridW = pageW - 2 * M;
    const colW = (gridW - (colCount - 1) * 8) / colCount;
    const rowH = (gridH - (rows - 1) * 6) / rows;

    pageEntries.forEach((entry, idx) => {
      const x = M;
      const y = gridY + idx * (rowH + 6);
      drawCard(doc, x, y, colW, rowH, entry, template, minFont, idx, avatars[entry.userId], valign, headingRgb, accentRgb);
      // hairline between stacked strips
      if (idx < pageEntries.length - 1) {
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

  return { doc, pages: pages.length, count: list.length };
};

/** Build + download the guest-book PDF. */
export const exportGuestBookPDF = (opts) => {
  const { doc, pages, count } = buildGuestBookPDF(opts);
  if (!doc || !count) return { pages: 0, count: 0 };
  const safe = String(opts.title || 'crew').replace(/[^\w]+/g, '-');
  doc.save(`Guest-book-${safe}.pdf`);
  return { pages, count };
};

// ---- Word (.docx) export --------------------------------------------------
// An editable version of the guest book: a borderless photo|text table per crew
// member, so the master can rearrange spacing, move people or retype in Word.

const dataUrlToBytes = (dataUrl) => {
  const bin = atob(String(dataUrl).split(',')[1] || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const NO_BORDERS = ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical']
  .reduce((o, k) => { o[k] = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }; return o; }, {});

export const exportGuestBookDOCX = async ({
  title = 'Our crew', subtitle = '', entries = [], includeMissing = false, logo = null, avatars = {}, showTitle = true,
  headingColor = '#1C1B3A', accentColor = '#C65A1A', titleSize = 20, subtitleSize = 8,
}) => {
  const list = includeMissing ? entries : entries.filter((e) => e.hasStatement);
  if (!list.length) return { count: 0 };
  const headHex = String(headingColor || '#1C1B3A').replace('#', '');
  const accHex = String(accentColor || '#C65A1A').replace('#', '');

  const head = [];
  if (logo?.dataUrl) {
    const h = 64; const w = Math.round(h * (logo.aspect || 1));
    head.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 60 },
      children: [new ImageRun({ data: dataUrlToBytes(logo.dataUrl), transformation: { width: w, height: h } })],
    }));
  }
  if (showTitle && title) {
    head.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: subtitle ? 40 : 200 },
      children: [new TextRun({ text: title, bold: true, size: Math.round(titleSize * 2), font: 'Georgia', color: headHex })],
    }));
  }
  if (subtitle) {
    head.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 220 },
      children: [new TextRun({ text: subtitle.toUpperCase(), size: Math.round(subtitleSize * 2), color: '8B8478', characterSpacing: 30 })],
    }));
  }

  // One borderless 2-column row per crew member: photo cell + text cell.
  const personTable = (e) => {
    const avatar = avatars[e.userId];
    const photoChildren = avatar
      ? [new ImageRun({ data: dataUrlToBytes(avatar), transformation: { width: 76, height: 76 } })]
      : [new TextRun({ text: initials(e.name), bold: true, size: 30, color: 'A08E7D' })];
    const textChildren = [
      new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: e.name, bold: true, size: 26, font: 'Georgia', color: headHex })] }),
    ];
    if (e.role) {
      textChildren.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: e.role.toUpperCase(), size: 15, color: accHex, characterSpacing: 20 })] }));
    }
    textChildren.push(new Paragraph({ children: [new TextRun({ text: e.statement || '—', size: 20, color: '4B4A5E' })] }));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({
        children: [
          new TableCell({ width: { size: 16, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: photoChildren })] }),
          new TableCell({ width: { size: 84, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, verticalAlign: VerticalAlign.CENTER, children: textChildren }),
        ],
      })],
    });
  };

  const body = [];
  list.forEach((e, i) => {
    if (i > 0) body.push(new Paragraph({ spacing: { before: 200, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'ECEAE3' } }, children: [] }));
    body.push(personTable(e));
  });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children: [...head, ...body],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const safe = String(title || 'crew').replace(/[^\w]+/g, '-');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Guest-book-${safe}.docx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { count: list.length };
};
