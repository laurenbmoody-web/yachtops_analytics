// Rasterise a GA PDF to a single PNG in the browser, so the deck-plan backdrop
// is always a raster the framing/crop math can work on. Multi-page GAs (a page
// per deck band) are stacked vertically into one tall sheet. Uses the same
// pdfjs-dist + worker wiring as the inventory PDF importer.
export async function pdfToPngBlob(file, { scale = 2, maxWidth = 2600 } = {}) {
  const pdfjs = await import('pdfjs-dist');
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  const pages = [];
  let totalH = 0;
  let maxW = 0;
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    let s = scale;
    let vp = page.getViewport({ scale: s });
    if (vp.width > maxWidth) { s = scale * (maxWidth / vp.width); vp = page.getViewport({ scale: s }); }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(vp.width));
    canvas.height = Math.max(1, Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(canvas);
    totalH += canvas.height;
    maxW = Math.max(maxW, canvas.width);
  }

  const combo = document.createElement('canvas');
  combo.width = maxW;
  combo.height = totalH;
  const cctx = combo.getContext('2d');
  cctx.fillStyle = '#ffffff';
  cctx.fillRect(0, 0, combo.width, combo.height);
  let y = 0;
  for (const c of pages) { cctx.drawImage(c, 0, y); y += c.height; }

  return new Promise((resolve) => combo.toBlob(resolve, 'image/png', 0.92));
}
