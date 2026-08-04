import { supabase } from '../../../lib/supabaseClient';

// Ask the parse-garment-photos edge function to read a garment's photos
// (front/back + brand and care labels) and return catalogue fields to pre-fill
// the Add form. Fails soft — returns an empty object so the manual flow is never
// blocked. Pass the app's allowed lists so the model's output stays in-vocabulary.
export async function parseGarmentPhotos(images, { types, genders, conditions, careTags } = {}) {
  const imgs = (images || []).filter((s) => typeof s === 'string' && s.startsWith('data:'));
  if (!imgs.length) return {};
  try {
    const { data, error } = await supabase.functions.invoke('parse-garment-photos', {
      body: { images: imgs, types, genders, conditions, careTags },
    });
    if (error) { console.error('[garmentAi] invoke failed', error); return {}; }
    return data?.fields || {};
  } catch (e) {
    console.error('[garmentAi] error', e);
    return {};
  }
}
