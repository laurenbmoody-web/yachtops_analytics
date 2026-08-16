import { supabase } from '../../../lib/supabaseClient';

/**
 * Identify a single inventory item from one photo and suggest which sub-folder
 * of the current department it belongs in.
 *
 * @param {string} image        data URL (data:image/...;base64,...)
 * @param {object} ctx
 * @param {string} ctx.departmentName  e.g. "Galley"
 * @param {string} [ctx.currentPath]   sub_location being filed from ("" = department root)
 * @param {string[]} [ctx.folders]     existing sub_location paths to prefer
 * @returns {Promise<null | {
 *   name: string, quantity: number, folder: string, isNew: boolean,
 *   confidence: 'high'|'medium'|'low', description: string
 * }>} detection, or null if it couldn't be identified (caller falls back to manual entry).
 */
export const detectInventoryItem = async (image, { departmentName, currentPath = '', folders = [] } = {}) => {
  try {
    const { data, error } = await supabase.functions.invoke('detect-inventory-item', {
      body: { image, departmentName, currentPath, folders },
    });
    if (error) { console.warn('[itemVisionAi] detect failed:', error?.message); return null; }
    return data?.detection || null;
  } catch (err) {
    console.warn('[itemVisionAi] detect exception:', err?.message);
    return null;
  }
};
