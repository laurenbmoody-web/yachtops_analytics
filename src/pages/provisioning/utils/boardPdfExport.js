import jsPDF from 'jspdf';

// Provisioning-board PDF exporter.
//
// Captures the in-app board with html2canvas and embeds the
// resulting tall image into a paginated jsPDF, then opens the PDF
// in a new tab via a blob URL. The chief gets the editorial page
// they see on screen (typography, chips, hairlines, terracotta
// accents) inside a viewer that supports orientation / save / print
// without the browser's print dialog.
//
// Full bleed: no page margins — the captured page goes edge to edge
// so the chips and KPI cards render at full readable size instead
// of being shrunk inside a narrow column. The captured DOM still
// carries its own padding so the content has visual breathing room
// against the page edge.

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// Class names whose elements should be skipped during capture.
// The right ribbon hosts the Print / PDF button itself — capturing
// it would print the button that triggered the export.
const IGNORED_SELECTORS = [
  '.cargo-ribbon',
];

const shouldIgnore = (el) => {
  if (!el || el.nodeType !== 1) return false;
  return IGNORED_SELECTORS.some((sel) => {
    try { return el.matches?.(sel); } catch { return false; }
  });
};

// Slice a tall source canvas into A4-page-sized chunks at the given
// scale (canvas px → mm). Each slice is drawn into a fresh canvas
// and pushed as a JPEG to the doc as a separate page.
const paginateCanvasToPdf = (sourceCanvas, doc, { scale }) => {
  const pageContentMm = A4_HEIGHT_MM;
  const slicePxHeight = Math.floor(pageContentMm / scale);
  const usableWidthMm = A4_WIDTH_MM;

  let yOffsetPx = 0;
  let firstPage = true;

  while (yOffsetPx < sourceCanvas.height) {
    const sliceHeight = Math.min(slicePxHeight, sourceCanvas.height - yOffsetPx);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = sourceCanvas.width;
    sliceCanvas.height = sliceHeight;
    const ctx = sliceCanvas.getContext('2d');
    // White background for any transparent regions in the source.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(sourceCanvas, 0, -yOffsetPx);

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    if (!firstPage) doc.addPage();
    doc.addImage(
      imgData,
      'JPEG',
      0,
      0,
      usableWidthMm,
      sliceHeight * scale,
    );

    firstPage = false;
    yOffsetPx += sliceHeight;
  }
};

// Pick the tightest element that wraps the printable board content.
// `.pv-dashboard` is the outer page wrapper and tends to include
// the page's left/right gutter padding (so the resulting capture
// has empty bands on either side and the actual content looks
// small inside a wide canvas). Prefer the EditorialPageShell's
// inner content host when available — that's the column whose
// width matches the title + chips + items table.
const pickCaptureTarget = () => {
  // Tighter selectors first.
  const candidates = [
    '.editorial-shell-content',
    '.editorial-page-shell',
    '.editorial-page',
    '.pv-dashboard',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
};

// Capture the in-app board and open the resulting PDF in a new tab.
export const openBoardPdf = async () => {
  const target = pickCaptureTarget();
  if (!target) {
    window.alert('Could not find the board content to export.');
    return;
  }

  // Dynamic import — keeps html2canvas out of the main chunk.
  const html2canvas = (await import('html2canvas')).default;

  // scale: 2 keeps the typography crisp at common viewing zoom.
  // useCORS lets any tenant logo / supplier mark render instead of
  // tainting the canvas and aborting the export. We pass an
  // explicit width so html2canvas captures the element's own
  // scrollWidth — important when the page has overflowed
  // horizontally on a narrow viewport.
  const canvas = await html2canvas(target, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#FFFFFF',
    logging: false,
    ignoreElements: shouldIgnore,
    width: target.scrollWidth,
    height: target.scrollHeight,
    windowWidth: target.scrollWidth,
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const scale = A4_WIDTH_MM / canvas.width;

  paginateCanvasToPdf(canvas, doc, { scale });

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Pop-up blockers (and some restricted webviews) will return null.
  // Fall back to a same-tab navigation so the chief still gets the
  // PDF — slightly worse UX but never silently broken.
  if (!win) window.location.href = url;
  // The blob URL stays alive until the tab closes; no manual revoke
  // (revoking too early kills the viewer's ability to refresh / save).
};
