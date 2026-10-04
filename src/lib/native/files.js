// Exports in the app. A web view can't "download" — the <a download> click
// that file-saver, jsPDF's doc.save() and every hand-rolled CSV/ZIP export in
// Cargo rely on does nothing on iOS / Android. Instead of touching ~30 export
// call sites, installFileShims() catches those clicks once, writes the file to
// the app's cache and opens the native share sheet (Save to Files, Mail,
// WhatsApp, AirDrop, Print…).

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';

// blob: URL → Blob, recorded at creation. Many exporters revoke the URL right
// after a.click(), before an async read could resolve it, so keep our own
// handle (released a minute after revocation).
const blobsByUrl = new Map();

const EXT_BY_TYPE = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/calendar': 'ics',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function safeName(name, type) {
  let n = String(name || '').split('/').pop().replace(/[^\w.\- ()]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!n) n = `Cargo-${new Date().toISOString().slice(0, 10)}`;
  if (!/\.[a-z0-9]{2,5}$/i.test(n) && EXT_BY_TYPE[type]) n += `.${EXT_BY_TYPE[type]}`;
  return n;
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Write a file to the cache and offer it through the share sheet.
export async function shareFile({ data, base64, filename, type }) {
  const b64 = base64 ?? await blobToBase64(data);
  const path = safeName(filename, type || data?.type);
  const { uri } = await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: path, files: [uri] });
  } catch (e) {
    // Closing the share sheet without picking anything rejects — not an error.
    if (!/cancel/i.test(String(e?.message || e))) throw e;
  }
}

// Save/share whatever a download link points at.
export async function shareUrl(href, filename) {
  if (href.startsWith('blob:')) {
    let blob = blobsByUrl.get(href);
    if (!blob) blob = await (await fetch(href)).blob();
    return shareFile({ data: blob, filename, type: blob.type });
  }
  if (href.startsWith('data:')) {
    const [, meta = '', payload = ''] = href.match(/^data:([^,]*),(.*)$/s) || [];
    const type = meta.split(';')[0];
    const base64 = meta.includes(';base64') ? payload : btoa(unescape(encodeURIComponent(decodeURIComponent(payload))));
    return shareFile({ base64, filename, type });
  }
  // A remote file (signed URL etc.): let the in-app browser show it — it has
  // its own share / save controls.
  return Browser.open({ url: href, presentationStyle: 'popover' });
}

const report = (e) => console.error('[native] export failed', e);

// Returns true when the anchor was a download we handled.
export function handleDownloadAnchor(a) {
  if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
  const href = a.href || a.getAttribute('href') || '';
  if (!href || href === '#') return false;
  shareUrl(href, a.getAttribute('download') || '').catch(report);
  return true;
}

export function installFileShims() {
  const createObjectURL = URL.createObjectURL.bind(URL);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    const url = createObjectURL(obj);
    if (obj instanceof Blob) blobsByUrl.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    setTimeout(() => { blobsByUrl.delete(url); revokeObjectURL(url); }, 60_000);
  };

  // a.click() on a detached anchor (the common exporter pattern) …
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedClick() {
    if (handleDownloadAnchor(this)) return;
    click.call(this);
  };
  // … and a.dispatchEvent(new MouseEvent('click')) (file-saver, jsPDF).
  const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function patchedDispatch(ev) {
    if (ev?.type === 'click' && !this.isConnected && handleDownloadAnchor(this)) return false;
    return dispatch.call(this, ev);
  };
}
