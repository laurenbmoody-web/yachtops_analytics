import jsPDF from 'jspdf';

// Provisioning-board PDF exporter.
//
// Captures the in-app board page and embeds it into a paginated
// A4 PDF, then opens it in a new tab via a blob URL — chief gets
// the editorial page they see on screen inside a real PDF viewer
// instead of fighting the browser's print dialog.
//
// Render engine: html-to-image (SVG foreignObject), not html2canvas.
// html2canvas re-rasterises everything itself and famously chokes
// on a handful of CSS that we lean on heavily:
//   * `var()` inside `background` (kills the supplier-progress bar)
//   * baseline alignment inside flex pills (the chip numbers and
//     "received" label drift apart)
//   * pseudo-elements + thin progress-bar fills
//   * custom-loaded fonts that aren't fully cached at capture time
// html-to-image hands the live computed styles to the browser's
// own SVG renderer via foreignObject — what the browser paints on
// screen is what comes back, pills and bars included.
//
// Full bleed: zero page margins, capture target picks the inner
// content host so the page content goes edge-to-edge (the captured
// DOM still has its own padding so it doesn't feel cramped).

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// Class names whose elements should be skipped during capture.
//
//   .cargo-ribbon  — right ribbon holds the Print / PDF button
//                    itself, capturing it would print the trigger.
//   .sg-root       — SummaryGauges (the bottom KPI cards). The
//                    gauges' radial-gradient SVGs + count-up
//                    animation don't survive the foreignObject
//                    snapshot cleanly, so they render as half-
//                    finished partials. Skipping them keeps the
//                    PDF honest rather than printing broken KPIs.
const IGNORED_SELECTORS = [
  '.cargo-ribbon',
  '.sg-root',
];

const shouldFilter = (node) => {
  if (!node || node.nodeType !== 1) return true;
  return !IGNORED_SELECTORS.some((sel) => {
    try { return node.matches?.(sel); } catch { return false; }
  });
};

// Pick the tightest element that wraps the printable board content.
// `.pv-dashboard` is the outer page wrapper and carries the page
// gutter padding, so prefer the EditorialPageShell's inner content
// host when available — the canvas then matches the actual content
// column rather than the gutter.
const pickCaptureTarget = () => {
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

// Slice the tall captured image down into A4-portrait pages and
// push each as a JPEG into the doc. White fills any transparent
// gap so the page edge stays clean.
const paginateImageToPdf = async (image, doc) => {
  const pageContentMm = A4_HEIGHT_MM;
  const pageWidthMm = A4_WIDTH_MM;
  const scale = pageWidthMm / image.naturalWidth;
  const slicePxHeight = Math.floor(pageContentMm / scale);

  let yOffsetPx = 0;
  let firstPage = true;

  while (yOffsetPx < image.naturalHeight) {
    const sliceHeight = Math.min(slicePxHeight, image.naturalHeight - yOffsetPx);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = image.naturalWidth;
    sliceCanvas.height = sliceHeight;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(image, 0, -yOffsetPx);

    const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    if (!firstPage) doc.addPage();
    doc.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, sliceHeight * scale);

    firstPage = false;
    yOffsetPx += sliceHeight;
  }
};

// Wait for any pending @font-face files to resolve before capture,
// otherwise the first paint inside the SVG foreignObject can land
// before DM Serif / Inter are ready and the export renders in a
// fallback serif.
const waitForFonts = async () => {
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch { /* progress regardless */ }
};

// Capture the in-app board and open the resulting PDF in a new tab.
export const openBoardPdf = async () => {
  const target = pickCaptureTarget();
  if (!target) {
    window.alert('Could not find the board content to export.');
    return;
  }

  await waitForFonts();

  // Dynamic import — keeps html-to-image out of the main chunk.
  const { toPng } = await import('html-to-image');

  // pixelRatio: 2 keeps the typography crisp at typical viewing
  // zoom. cacheBust forces any non-data-URL images on the page
  // (tenant logo / supplier marks) to refetch with a CORS-friendly
  // request, so a stale cache hit doesn't taint the canvas.
  const dataUrl = await toPng(target, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: '#FFFFFF',
    filter: shouldFilter,
    width: target.scrollWidth,
    height: target.scrollHeight,
    style: {
      // Pin the captured node's box to its scroll size so html-to-
      // image doesn't truncate when the page has overflowed below
      // the viewport. Inline so it overrides any transient layout
      // animation in flight at capture time.
      transform: 'none',
      width: `${target.scrollWidth}px`,
      height: `${target.scrollHeight}px`,
    },
  });

  // Decode the PNG so paginateImageToPdf can read naturalWidth /
  // naturalHeight and draw slices into the per-page canvases.
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  await paginateImageToPdf(image, doc);

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
