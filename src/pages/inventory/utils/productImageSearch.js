import { supabase } from '../../../lib/supabaseClient';

/**
 * Find a candidate product photo for an item name via the product-image-search
 * edge function. Fails soft: returns '' on any error or when image search isn't
 * configured, so the caller just skips the photo.
 *
 * @param {string} query  item name (optionally with brand), e.g. "Oral-B iO 10"
 * @returns {Promise<string>} the top image URL, or '' if none
 */
export const findProductImage = async (query) => {
  const q = String(query || '').trim();
  if (!q) return '';
  try {
    const { data, error } = await supabase.functions.invoke('product-image-search', {
      body: { query: q, count: 3 },
    });
    if (error) { console.warn('[productImageSearch] failed:', error?.message); return ''; }
    // Only accept a copy re-hosted in our own storage — never a raw third-party
    // link (those can't be embedded in PDF exports and rot over time).
    return isOwnStorageUrl(data?.image) ? data.image : '';
  } catch (err) {
    console.warn('[productImageSearch] exception:', err?.message);
    return '';
  }
};

/**
 * Search for several candidate product photos to show for review. Returns the
 * raw candidates (full image + thumbnail), plus whether image search is
 * configured at all, so the UI can prompt for setup when it isn't.
 *
 * @param {string} query
 * @param {number} count  how many candidates to request (max 10)
 * @returns {Promise<{ candidates: Array<{full:string,thumb:string,title:string}>, configured: boolean }>}
 */
export const searchImageCandidates = async (query, count = 6) => {
  const q = String(query || '').trim();
  if (!q) return { candidates: [], configured: true };
  try {
    const { data, error } = await supabase.functions.invoke('product-image-search', {
      body: { query: q, count },
    });
    if (error) { console.warn('[searchImageCandidates] failed:', error?.message); return { candidates: [], configured: true }; }
    const candidates = Array.isArray(data?.candidates)
      ? data.candidates.filter((c) => c && typeof c.full === 'string' && c.full)
      : (Array.isArray(data?.images) ? data.images.map((u) => ({ full: u, thumb: u, title: '' })) : []);
    return { candidates, configured: data?.configured !== false };
  } catch (err) {
    console.warn('[searchImageCandidates] exception:', err?.message);
    return { candidates: [], configured: true };
  }
};

/** True when a URL points at this project's own Supabase storage. */
export const isOwnStorageUrl = (url) => {
  const u = String(url || '');
  if (!u) return false;
  const base = String(import.meta.env?.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  if (base) return u.startsWith(`${base}/storage/v1/`);
  return /\.supabase\.co\/storage\/v1\//i.test(u);
};

/**
 * Re-host a chosen remote image URL into the app's item-images bucket, returning
 * a stable public URL. Returns '' if re-hosting fails, so callers never save a
 * raw third-party link.
 *
 * @param {string} url
 * @returns {Promise<string>} stable public URL, or '' on failure
 */
export const rehostImage = async (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  if (isOwnStorageUrl(u)) return u;
  try {
    const { data, error } = await supabase.functions.invoke('product-image-search', {
      body: { url: u },
    });
    if (error) { console.warn('[rehostImage] failed:', error?.message); return ''; }
    return data?.rehosted && isOwnStorageUrl(data?.image) ? data.image : '';
  } catch (err) {
    console.warn('[rehostImage] exception:', err?.message);
    return '';
  }
};

/**
 * Fetch a remote image server-side and return it as a data URL. Used by the PDF
 * export for photos on hosts that don't allow the browser to read them (CORS).
 *
 * @param {string} url
 * @returns {Promise<string>} data URL, or '' on failure
 */
export const fetchImageInline = async (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  try {
    const { data, error } = await supabase.functions.invoke('product-image-search', {
      body: { inline: u },
    });
    if (error) return '';
    const d = data?.dataUrl;
    return typeof d === 'string' && d.startsWith('data:image/') ? d : '';
  } catch {
    return '';
  }
};
