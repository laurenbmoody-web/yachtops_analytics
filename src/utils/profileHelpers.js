import { supabase } from '../lib/supabaseClient';

/**
 * Ensures a profile row exists for the given session user.
 * Safe to call multiple times - uses upsert with smart defaults.
 * Includes retry logic for network errors.
 * 
 * @param {Object} sessionUser - Supabase auth user object
 * @param {number} retries - Number of retries for network errors (default: 2)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const ensureProfileExists = async (sessionUser, retries = 2) => {
  // If no session user, do nothing
  if (!sessionUser) {
    console.log('PROFILE UPSERT: No session user, skipping');
    return { success: true };
  }

  try {
    const userId = sessionUser?.id;
    const email = sessionUser?.email;
    const fullNameFromMeta = sessionUser?.user_metadata?.full_name;

    console.log('PROFILE UPSERT: Starting for user', userId);

    // Verify supabase client is initialized
    if (!supabase) {
      console.error('PROFILE UPSERT: Supabase client not initialized');
      return { success: false, error: 'Database client not initialized' };
    }

    // First, check if profile exists to preserve last_active_tenant_id
    let existingProfile = null;
    let fetchError = null;
    
    try {
      const { data, error } = await supabase?.from('profiles')?.select('id, last_active_tenant_id, account_type')?.eq('id', userId)?.single();
      
      existingProfile = data;
      fetchError = error;
    } catch (err) {
      console.error('PROFILE UPSERT: Exception during fetch:', err);
      
      // Handle AbortError specifically - treat as non-fatal and retry
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        console.warn('PROFILE UPSERT: Query was aborted (timeout or cancellation)');
        if (retries > 0) {
          console.warn(`PROFILE UPSERT: Retrying after abort... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          return ensureProfileExists(sessionUser, retries - 1);
        }
        // If no retries left, treat as success - profile may already exist
        console.warn('PROFILE UPSERT: AbortError after all retries. Treating as non-fatal.');
        return { success: true }; // Don't block bootstrap
      }
      
      // Handle network errors with retry
      if ((err instanceof TypeError || err?.message?.includes('Load failed')) && retries > 0) {
        console.warn(`PROFILE UPSERT: Network error, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        return ensureProfileExists(sessionUser, retries - 1);
      }
      fetchError = err;
    }

    if (fetchError && fetchError?.code !== 'PGRST116') {
      // PGRST116 = not found, which is fine
      console.error('PROFILE UPSERT: Error fetching existing profile:', {
        message: fetchError?.message || 'Unknown error',
        details: fetchError?.details || '',
        hint: fetchError?.hint || '',
        code: fetchError?.code || '',
        name: fetchError?.name || '',
        stack: fetchError?.stack || ''
      });
      
      // Handle AbortError specifically
      if (fetchError?.name === 'AbortError' || fetchError?.message?.includes('aborted')) {
        console.warn('PROFILE UPSERT: Query was aborted (timeout or cancellation)');
        if (retries > 0) {
          console.warn(`PROFILE UPSERT: Retrying after abort... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          return ensureProfileExists(sessionUser, retries - 1);
        }
        // If no retries left, treat as success - profile may already exist
        console.warn('PROFILE UPSERT: AbortError after all retries. Treating as non-fatal.');
        return { success: true }; // Don't block bootstrap
      }
      
      // For network errors, retry if we have attempts left
      if ((fetchError instanceof TypeError || fetchError?.message?.includes('Load failed') || fetchError?.message?.includes('Failed to fetch')) && retries > 0) {
        console.warn(`PROFILE UPSERT: Network error, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        return ensureProfileExists(sessionUser, retries - 1);
      }
      
      // If no retries left, log detailed error but don't fail
      if (fetchError instanceof TypeError || fetchError?.message?.includes('Load failed') || fetchError?.message?.includes('Failed to fetch')) {
        console.error('PROFILE UPSERT: Network error after all retries. Continuing anyway as profile may exist.');
        // Don't return error - continue with upsert attempt
        // The profile might exist, and the upsert will handle it
      } else {
        // For other errors, throw
        throw fetchError;
      }
    }

    // Build upsert payload
    const upsertData = {
      id: userId,
      email: email,
    };

    // Set full_name if available from metadata
    if (fullNameFromMeta) {
      upsertData.full_name = fullNameFromMeta;
    }

    // Preserve existing last_active_tenant_id if it exists
    if (existingProfile?.last_active_tenant_id) {
      upsertData.last_active_tenant_id = existingProfile?.last_active_tenant_id;
    }

    // Set account_type to 'CREW' only if it's currently null
    if (!existingProfile?.account_type) {
      upsertData.account_type = 'CREW';
    } else {
      upsertData.account_type = existingProfile?.account_type;
    }

    // Perform upsert
    let upsertError = null;
    try {
      const { error } = await supabase?.from('profiles')?.upsert(upsertData, { onConflict: 'id' });
      
      upsertError = error;
    } catch (err) {
      console.error('PROFILE UPSERT: Exception during upsert:', err);
      
      // Handle AbortError specifically
      if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
        console.warn('PROFILE UPSERT: Upsert was aborted (timeout or cancellation)');
        if (retries > 0) {
          console.warn(`PROFILE UPSERT: Retrying upsert after abort... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          return ensureProfileExists(sessionUser, retries - 1);
        }
        // If no retries left, treat as success - profile may already exist
        console.warn('PROFILE UPSERT: AbortError during upsert after all retries. Treating as non-fatal.');
        return { success: true }; // Don't block bootstrap
      }
      
      // Handle network errors with retry
      if ((err instanceof TypeError || err?.message?.includes('Load failed') || err?.message?.includes('Failed to fetch')) && retries > 0) {
        console.warn(`PROFILE UPSERT: Network error during upsert, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        return ensureProfileExists(sessionUser, retries - 1);
      }
      upsertError = err;
    }

    if (upsertError) {
      console.error('PROFILE UPSERT: Error during upsert:', upsertError);
      
      // Handle AbortError specifically
      if (upsertError?.name === 'AbortError' || upsertError?.message?.includes('aborted')) {
        console.warn('PROFILE UPSERT: Upsert was aborted (timeout or cancellation)');
        if (retries > 0) {
          console.warn(`PROFILE UPSERT: Retrying upsert after abort... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          return ensureProfileExists(sessionUser, retries - 1);
        }
        // If no retries left, treat as success - profile may already exist
        console.warn('PROFILE UPSERT: AbortError during upsert after all retries. Treating as non-fatal.');
        return { success: true }; // Don't block bootstrap
      }
      
      // Handle network errors during upsert with retry
      if ((upsertError instanceof TypeError || upsertError?.message?.includes('Load failed') || upsertError?.message?.includes('Failed to fetch')) && retries > 0) {
        console.warn(`PROFILE UPSERT: Network error during upsert, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        return ensureProfileExists(sessionUser, retries - 1);
      }
      
      // If no retries left, return error
      if (upsertError instanceof TypeError || upsertError?.message?.includes('Load failed') || upsertError?.message?.includes('Failed to fetch')) {
        console.error('PROFILE UPSERT: Network error during upsert after all retries.');
        return { 
          success: false, 
          error: 'Network error: Unable to save profile. Please check your internet connection and try again.' 
        };
      }
      
      throw upsertError;
    }

    console.log('PROFILE UPSERT OK');
    return { success: true };
  } catch (err) {
    console.error('PROFILE UPSERT: Exception:', err);
    
    // Handle AbortError specifically
    if (err?.name === 'AbortError' || err?.message?.includes('aborted')) {
      console.warn('PROFILE UPSERT: Operation was aborted (timeout or cancellation)');
      if (retries > 0) {
        console.warn(`PROFILE UPSERT: Retrying after abort... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
        return ensureProfileExists(sessionUser, retries - 1);
      }
      // If no retries left, treat as success - profile may already exist
      console.warn('PROFILE UPSERT: AbortError after all retries. Treating as non-fatal.');
      return { success: true }; // Don't block bootstrap
    }
    
    // Handle network errors with retry
    if ((err instanceof TypeError || err?.message?.includes('Load failed') || err?.message?.includes('Failed to fetch')) && retries > 0) {
      console.warn(`PROFILE UPSERT: Network error (exception), retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
      return ensureProfileExists(sessionUser, retries - 1);
    }
    
    // If no retries left, return error
    if (err instanceof TypeError || err?.message?.includes('Load failed') || err?.message?.includes('Failed to fetch')) {
      return { 
        success: false, 
        error: 'Network error: Unable to connect to database. Please check your internet connection and Supabase configuration.' 
      };
    }
    
    return { success: false, error: err?.message || 'Profile upsert failed' };
  }
};
