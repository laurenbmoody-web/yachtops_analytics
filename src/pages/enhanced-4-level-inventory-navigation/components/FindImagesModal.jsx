import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { searchImageCandidates, rehostImage } from '../../inventory/utils/productImageSearch';
import './find-images.css';

// How many image searches to run at once. Modest so a big galley doesn't fire
// hundreds of provider calls in one burst.
const CONCURRENCY = 4;

// Build the search query for an item: brand + name, but don't repeat the brand
// when the name already starts with it (common after an import).
const queryFor = (it) => {
  const name = String(it?.name || '').trim();
  const brand = String(it?.brand || '').trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) return `${brand} ${name}`;
  return name;
};

// Run async tasks with a concurrency cap.
async function runPool(items, worker, concurrency) {
  let i = 0;
  const next = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

export default function FindImagesModal({ items = [], scopeLabel = 'Inventory', onClose, onApplied }) {
  // One row per item lacking a photo.
  const initialRows = useMemo(
    () => (items || []).map((it) => ({
      id: it.id,
      name: it.name || '(unnamed item)',
      brand: it.brand || '',
      query: queryFor(it),
      status: 'pending',      // pending | loading | ready | none
      candidates: [],
      idx: 0,
      skipped: false,
    })),
    [items],
  );

  const [rows, setRows] = useState(initialRows);
  const [phase, setPhase] = useState('intro'); // intro | searching | review | saving | done | unconfigured
  const [progress, setProgress] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const cancelRef = useRef(false);

  const total = rows.length;

  const patchRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // ── Find candidate photos for every item ──────────────────────────────────
  const runSearch = async () => {
    cancelRef.current = false;
    setPhase('searching');
    setProgress(0);
    let done = 0;
    let unconfigured = false;

    await runPool(rows, async (row) => {
      if (cancelRef.current || unconfigured) return;
      patchRow(row.id, { status: 'loading' });
      const { candidates, configured } = await searchImageCandidates(row.query, 6);
      if (!configured) { unconfigured = true; return; }
      done += 1;
      setProgress(done);
      patchRow(row.id, {
        status: candidates.length ? 'ready' : 'none',
        candidates,
        idx: 0,
      });
    }, CONCURRENCY);

    if (unconfigured) { setPhase('unconfigured'); return; }
    setPhase('review');
  };

  const cycle = (id, dir) => setRows((prev) => prev.map((r) => {
    if (r.id !== id || !r.candidates.length) return r;
    const n = r.candidates.length;
    return { ...r, idx: (r.idx + dir + n) % n };
  }));

  const toggleSkip = (id) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, skipped: !r.skipped } : r)));

  const chosenCount = rows.filter((r) => r.status === 'ready' && !r.skipped).length;

  // ── Save the chosen photos to the items ───────────────────────────────────
  const runSave = async () => {
    const toSave = rows.filter((r) => r.status === 'ready' && !r.skipped);
    if (!toSave.length) return;
    setPhase('saving');
    setProgress(0);
    let saved = 0;

    for (const row of toSave) {
      const picked = row.candidates[row.idx];
      const src = picked?.full || picked?.thumb || '';
      if (src) {
        try {
          const stable = await rehostImage(src);
          if (stable) {
            await supabase.from('inventory_items').update({ image_url: stable }).eq('id', row.id);
            saved += 1;
          }
        } catch (err) {
          console.warn('[FindImages] save failed for', row.name, err?.message);
        }
      }
      setProgress((p) => p + 1);
    }

    setSavedCount(saved);
    setPhase('done');
  };

  const handleDone = () => { onApplied?.(); onClose?.(); };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ModalShell onClose={onClose} panelClassName="fim-modal bg-card w-full flex flex-col max-w-3xl max-h-[90vh]">
      <div className="fim-top">
        <p className="fim-meta">
          <span className="dot">●</span>
          <span>{String(scopeLabel).toUpperCase()}</span>
          <span className="bar" />
          <span className="muted">{total} without a photo</span>
        </p>
        <button onClick={onClose} className="fim-x" aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto fim-body">
        {phase === 'intro' && (
          <div className="fim-stage">
            <h2 className="fim-hero">Find the <em>photos</em>.</h2>
            <p className="fim-lede">
              I&rsquo;ll look up a product photo for each of the {total} {scopeLabel} item{total !== 1 ? 's' : ''} with
              no picture. You review every suggestion and pick before anything is saved &mdash; nothing changes until you hit save.
            </p>
            <div className="fim-cta">
              <button className="fim-pill" onClick={runSearch} disabled={!total}>
                <Icon name="Sparkles" size={16} />Find photos for {total} item{total !== 1 ? 's' : ''}
              </button>
              <button className="fim-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}

        {phase === 'unconfigured' && (
          <div className="fim-stage">
            <div className="fim-empty-ic"><Icon name="KeyRound" size={26} /></div>
            <h2 className="fim-hero">One quick setup step.</h2>
            <p className="fim-lede">
              Image search needs a search key before it can find photos. Add a <strong>SerpAPI</strong> key (simplest &mdash;
              one value) or Google Custom Search keys under Supabase &rarr; Edge Function Secrets, then reopen this.
              I&rsquo;ve left exact steps with Lauren.
            </p>
            <div className="fim-cta"><button className="fim-ghost" onClick={onClose}>Close</button></div>
          </div>
        )}

        {(phase === 'searching' || phase === 'review' || phase === 'saving') && (
          <div className="fim-stage">
            {phase === 'searching' && (
              <>
                <h2 className="fim-hero">Looking for <em>photos</em>&hellip;</h2>
                <p className="fim-lede">{progress} of {total} searched</p>
                <div className="fim-bar"><i style={{ width: `${total ? Math.round((progress / total) * 100) : 0}%` }} /></div>
              </>
            )}
            {phase === 'review' && (
              <>
                <h2 className="fim-hero">{chosenCount} photo{chosenCount !== 1 ? 's' : ''}, <em>ready</em>.</h2>
                <p className="fim-lede">
                  Flip through the options with the arrows, skip any that don&rsquo;t match, then save. Only ticked items get a photo.
                </p>
              </>
            )}
            {phase === 'saving' && (
              <>
                <h2 className="fim-hero">Saving <em>photos</em>&hellip;</h2>
                <p className="fim-lede">{progress} of {chosenCount} saved</p>
                <div className="fim-bar"><i style={{ width: `${chosenCount ? Math.round((progress / chosenCount) * 100) : 0}%` }} /></div>
              </>
            )}

            {phase !== 'searching' || progress > 0 ? (
              <div className="fim-grid">
                {rows.map((r) => {
                  const pick = r.candidates[r.idx];
                  const thumb = pick?.thumb || pick?.full || '';
                  const active = r.status === 'ready' && !r.skipped;
                  return (
                    <div key={r.id} className={`fim-card${r.skipped ? ' skipped' : ''}${r.status === 'none' ? ' none' : ''}`}>
                      <div className="fim-thumb">
                        {r.status === 'loading' && <span className="fim-spin" />}
                        {r.status === 'ready' && thumb && <img src={thumb} alt="" loading="lazy" />}
                        {r.status === 'none' && <Icon name="ImageOff" size={20} />}
                        {r.status === 'pending' && <Icon name="Image" size={20} />}
                        {r.status === 'ready' && r.candidates.length > 1 && (
                          <>
                            <button className="fim-nav l" onClick={() => cycle(r.id, -1)} aria-label="Previous option"><Icon name="ChevronLeft" size={16} /></button>
                            <button className="fim-nav r" onClick={() => cycle(r.id, 1)} aria-label="Next option"><Icon name="ChevronRight" size={16} /></button>
                            <span className="fim-count">{r.idx + 1}/{r.candidates.length}</span>
                          </>
                        )}
                      </div>
                      <div className="fim-name" title={r.name}>{r.name}</div>
                      {r.status === 'ready' && (
                        <button className={`fim-toggle${active ? ' on' : ''}`} onClick={() => toggleSkip(r.id)}>
                          {active ? <><Icon name="Check" size={13} />Use</> : <><Icon name="Plus" size={13} />Skipped</>}
                        </button>
                      )}
                      {r.status === 'none' && <span className="fim-nomatch">No match</span>}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {phase === 'done' && (
          <div className="fim-stage">
            <div className="fim-empty-ic ok"><Icon name="CheckCircle2" size={26} /></div>
            <h2 className="fim-hero">All <em>done</em>.</h2>
            <p className="fim-lede">{savedCount} photo{savedCount !== 1 ? 's' : ''} added to your {scopeLabel} items.</p>
            <div className="fim-cta"><button className="fim-pill" onClick={handleDone}>Done<Icon name="Check" size={16} /></button></div>
          </div>
        )}
      </div>

      {phase === 'review' && (
        <div className="fim-foot">
          <button className="fim-ghost" onClick={onClose}>Cancel</button>
          <button className="fim-pill" onClick={runSave} disabled={!chosenCount}>
            Save {chosenCount} photo{chosenCount !== 1 ? 's' : ''}<Icon name="ArrowRight" size={16} />
          </button>
        </div>
      )}
    </ModalShell>
  );
}
