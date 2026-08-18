import { supabase } from '../../../lib/supabaseClient';

/**
 * @typedef {{
 *   name: string, quantity: number, folder: string, isNew: boolean,
 *   confidence: 'high'|'medium'|'low', description: string
 * }} Detection
 */

/**
 * Identify the inventory item(s) in one photo and suggest which sub-folder of the
 * current department each belongs in. A photo may contain a single item or several
 * distinct products, so this returns a list — one entry per distinct product.
 *
 * @param {string} image        data URL (data:image/...;base64,...)
 * @param {object} ctx
 * @param {string} ctx.departmentName  e.g. "Galley"
 * @param {string} [ctx.currentPath]   sub_location being filed from ("" = department root)
 * @param {string[]} [ctx.folders]     existing sub_location paths to prefer
 * @returns {Promise<Detection[]>} detections (empty if nothing could be identified;
 *   caller falls back to manual entry).
 */
export const detectInventoryItems = async (image, { departmentName, currentPath = '', folders = [] } = {}) => {
  try {
    const { data, error } = await supabase.functions.invoke('detect-inventory-item', {
      body: { image, departmentName, currentPath, folders },
    });
    if (error) { console.warn('[itemVisionAi] detect failed:', error?.message); return []; }
    // New contract returns `detections`; fall back to the legacy single `detection`
    // so the client keeps working regardless of edge-function deploy order.
    if (Array.isArray(data?.detections)) return data.detections;
    return data?.detection ? [data.detection] : [];
  } catch (err) {
    console.warn('[itemVisionAi] detect exception:', err?.message);
    return [];
  }
};
