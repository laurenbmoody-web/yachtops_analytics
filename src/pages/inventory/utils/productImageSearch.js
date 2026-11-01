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
    // Prefer the re-hosted stable URL; fall back to a raw candidate.
    const images = Array.isArray(data?.images) ? data.images : [];
    return data?.image || images[0] || '';
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

/**
 * Re-host a chosen remote image URL into the app's item-images bucket, returning
 * a stable public URL. Falls back to the original URL if re-hosting fails.
 *
 * @param {string} url
 * @returns {Promise<string>} stable public URL (or the original on failure, '' if none)
 */
export const rehostImage = async (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  try {
    const { data, error } = await supabase.functions.invoke('product-image-search', {
      body: { url: u },
    });
    if (error) { console.warn('[rehostImage] failed:', error?.message); return u; }
    return data?.image || u;
  } catch (err) {
    console.warn('[rehostImage] exception:', err?.message);
    return u;
  }
};
