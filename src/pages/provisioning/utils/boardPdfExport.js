import jsPDF from 'jspdf';

// Provisioning-board PDF exporter.
//
// Earlier passes tried to lay the board out from scratch in jsPDF
// (first as a heavy autoTable, then as an editorial rewrite). Both
// read worse than the in-app page they were trying to mirror —
// jsPDF only ships Helvetica and our typography is half the point.
//
// This pass takes the simpler route the user asked for: capture the
// in-app page exactly as rendered (html2canvas → canvas), paginate
// the resulting tall image across A4 pages, and open the PDF in a
// new tab. The chief gets the editorial page they're already
// looking at, but in a viewer that supports orientation / save /
// print without the browser's print dialog.
//
// html2canvas is loaded dynamically so it doesn't bloat the main
// chunk — only the user who clicks Print / PDF pays for it.

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_MARGIN_MM = 10;

// Class names whose elements should be skipped during capture.
// The right ribbon hosts the Print / PDF button itself — capturing
// it would print the button that triggered the export. Tabs /
// search bar / bulk-action chrome are interactive controls that
// don't help anyone reading a printed copy.
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
const paginateCanvasToPdf = (sourceCanvas, doc, { scale, marginMm }) => {
  const pageContentMm = A4_HEIGHT_MM - marginMm * 2;
  const slicePxHeight = Math.floor(pageContentMm / scale);
  const usableWidthMm = A4_WIDTH_MM - marginMm * 2;

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
      marginMm,
      marginMm,
      usableWidthMm,
      sliceHeight * scale,
    );

    firstPage = false;
    yOffsetPx += sliceHeight;
  }
};

// Capture the in-app board and open the resulting PDF in a new tab.
// `targetSelector` defaults to the board's outer wrapper; callers
// can pass a tighter selector if they only want part of the page.
export const openBoardPdf = async ({ targetSelector = '.pv-dashboard' } = {}) => {
  const target = document.querySelector(targetSelector);
  if (!target) {
    window.alert('Could not find the board content to export.');
    return;
  }

  // Dynamic import — keeps html2canvas out of the main chunk.
  const html2canvas = (await import('html2canvas')).default;

  // scale: 2 keeps the typography crisp at common viewing zoom.
  // useCORS lets any tenant logo / supplier mark render instead of
  // tainting the canvas and aborting the export.
  const canvas = await html2canvas(target, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#FFFFFF',
    logging: false,
    ignoreElements: shouldIgnore,
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const usableWidthMm = A4_WIDTH_MM - PAGE_MARGIN_MM * 2;
  const scale = usableWidthMm / canvas.width;

  paginateCanvasToPdf(canvas, doc, { scale, marginMm: PAGE_MARGIN_MM });

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
