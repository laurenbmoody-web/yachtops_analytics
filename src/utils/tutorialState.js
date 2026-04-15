import { supabase } from '../lib/supabaseClient';

/**
 * Mark a tutorial step as done for a user.
 * Merges into the existing onboarding_tutorial_state jsonb column.
 * Returns the updated state object.
 */
export async function markTutorialStep(userId, key) {
  if (!userId) return {};
  try {
    const { data } = await supabase
      .from('profiles')
      .select('onboarding_tutorial_state')
      .eq('id', userId)
      .single();
    const next = { ...(data?.onboarding_tutorial_state || {}), [key]: true };
    await supabase
      .from('profiles')
      .update({ onboarding_tutorial_state: next })
      .eq('id', userId);
    return next;
  } catch (err) {
    console.warn('[tutorialState] markTutorialStep failed', err);
    return {};
  }
}

/**
 * Returns true if the given key is done in the tutorial state object.
 */
export function stepDone(state, key) {
  return Boolean(state?.[key]);
}
