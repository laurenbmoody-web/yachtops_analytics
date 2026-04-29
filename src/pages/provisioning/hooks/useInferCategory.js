import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const DEBOUNCE_MS = 800;

// Module-level cache shared across hook instances within a session.
// Key: `${departmentName}::${normalisedItemName}` (lowercase + trim).
// Value: category string (one of validCategories, or 'Uncategorised').
// Not persisted across page reloads — see Sprint 4B Phase 4 spec.
const cache = new Map();

/**
 * useInferCategory — debounced wrapper around the infer-item-category edge
 * function. Designed for the AddItemRow on ProvisioningBoardDetail.
 *
 *   const { inferring, inferredCategory, infer, cancel, clearInference } =
 *     useInferCategory();
 *
 *   // call infer when the name input blurs / debounces
 *   infer(name, deptName, categoriesForDept(deptName));
 *
 *   // when the result arrives, the consumer can copy inferredCategory
 *   // into its own form state via a guarded useEffect (so a user-picked
 *   // value isn't overwritten — that policy is the consumer's, not the
 *   // hook's).
 *
 *   // call clearInference() when switching contexts (different add row,
 *   // empty input, etc.) so a stale result doesn't auto-fill the wrong
 *   // surface.
 */
export const useInferCategory = () => {
  const [inferring, setInferring] = useState(false);
  const [inferredCategory, setInferredCategory] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const cancel = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Bumping the request id invalidates any in-flight response. The
    // network call itself can't be aborted (supabase-js doesn't accept an
    // AbortSignal), but we drop the result on arrival.
    requestIdRef.current += 1;
    setInferring(false);
  }, []);

  const clearInference = useCallback(() => {
    cancel();
    setInferredCategory(null);
  }, [cancel]);

  const infer = useCallback((itemName, departmentName, validCategories) => {
    cancel();
    const trimmed = (itemName || '').trim();
    if (!trimmed || !departmentName || !Array.isArray(validCategories) || validCategories.length === 0) {
      setInferredCategory(null);
      return;
    }
    const cacheKey = `${departmentName}::${trimmed.toLowerCase()}`;
    if (cache.has(cacheKey)) {
      setInferredCategory(cache.get(cacheKey));
      return;
    }
    const myId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      setInferring(true);
      try {
        const { data, error } = await supabase.functions.invoke('infer-item-category', {
          body: { itemName: trimmed, departmentName, validCategories },
        });
        if (myId !== requestIdRef.current) return;  // stale — newer call took over
        const cat = error || !data?.category ? 'Uncategorised' : data.category;
        cache.set(cacheKey, cat);
        setInferredCategory(cat);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        console.error('[useInferCategory] failed', err);
        setInferredCategory('Uncategorised');
      } finally {
        if (myId === requestIdRef.current) setInferring(false);
      }
    }, DEBOUNCE_MS);
  }, [cancel]);

  // Cleanup any pending debounce on unmount
  useEffect(() => cancel, [cancel]);

  return { inferring, inferredCategory, infer, cancel, clearInference };
};
