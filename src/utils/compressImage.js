// Downscale a picked photo to a JPEG data URL (~200KB). Phone cameras produce
// several MB; this keeps uploads reliable and keeps offline-queued photos
// (lib/offline outbox, type 'upload') small on the device. Falls back to the
// raw data URL if the image can't be drawn, or '' if the file can't be read.
export const compressImage = (file, maxDim = 1600, quality = 0.82) => new Promise((res) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        res(canvas.toDataURL('image/jpeg', quality));
      } catch { res(reader.result); }
    };
    img.onerror = () => res(reader.result);
    img.src = reader.result;
  };
  reader.onerror = () => res('');
  reader.readAsDataURL(file);
});
