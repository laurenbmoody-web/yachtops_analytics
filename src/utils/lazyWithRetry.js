import React from 'react';

// React.lazy() wrapper that recovers from "stale tab vs. fresh deploy"
// chunk-load failures.
//
// When we deploy a new bundle, the user's open tab is still holding an
// index.html that references the previous chunk hashes (e.g.
// SupplierOverview-Cqb0_G4n.js). On the next route navigation the
// browser asks Netlify for that filename, doesn't find it, gets the
// SPA fallback (text/html) instead, and the dynamic import throws
// `Failed to fetch dynamically imported module`. That bubbles up to
// the ErrorBoundary and the user sees "Something went wrong" through
// no fault of their own.
//
// The cure is to detect the chunk-load failure, force a single hard
// reload (so the browser pulls the freshly-deployed index.html, which
// in turn references the freshly-deployed chunk hashes), and only
// surface the error on persistent failure.
//
// The sessionStorage flag guards against an infinite refresh loop if
// the failure is actually something else (genuinely missing module,
// network outage, etc.) — we only swallow one reload per tab.
const RELOAD_KEY = 'cargo:lazy-reload-attempted';

const isChunkLoadError = (err) => {
  const msg = err?.message || '';
  return (
    err?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk .* failed/i.test(msg) ||
    /Loading CSS chunk .* failed/i.test(msg)
  );
};

export default function lazyWithRetry(importer) {
  return React.lazy(async () => {
    try {
      const mod = await importer();
      // Successful import — clear the one-shot flag so future deploys
      // can recover the same way without the next failure surfacing.
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (_e) {}
      return mod;
    } catch (err) {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1'; } catch (_e) {}
      if (isChunkLoadError(err) && !alreadyReloaded) {
        try { sessionStorage.setItem(RELOAD_KEY, '1'); } catch (_e) {}
        window.location.reload();
        // Hang the Suspense boundary until the reload tears the
        // document down — prevents React from rendering the
        // ErrorBoundary mid-reload.
        return new Promise(() => {});
      }
      throw err;
    }
  });
}
