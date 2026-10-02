import { supabase } from '../../../lib/supabaseClient';

/**
 * Find a candidate product photo for an item name via the product-image-search
 * edge function (Google image search). Fails soft: returns '' on any error or
 * when image search isn't configured, so the caller just skips the photo.
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
