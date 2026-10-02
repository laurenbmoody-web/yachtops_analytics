// Rasterise each page of a PDF to a JPEG blob, so an uploaded packing list /
// order PDF can run through the same vision scan as a photo (one page = one
// "photo"). Uses the same pdfjs-dist + worker wiring as the rest of the app.
export async function pdfToPageBlobs(file, { scale = 2, maxWidth = 1600, maxPages = 20 } = {}) {
  const pdfjs = await import('pdfjs-dist');
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const count = Math.min(doc.numPages, maxPages);

  const blobs = [];
  for (let i = 1; i <= count; i += 1) {
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
    const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
    if (blob) blobs.push(blob);
  }
  return blobs;
}
