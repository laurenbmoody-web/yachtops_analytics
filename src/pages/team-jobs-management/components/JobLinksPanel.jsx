import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  INVENTORY,
  EQUIPMENT,
  ABOUT,
  USES,
  loadJobLinks,
  addJobLink,
  setJobLinkQty,
  setJobLinkPurpose,
  removeJobLink,
  adjustConsumedQty,
  searchLinkTargets,
  isVariantItem,
  suggestsConsumption,
} from '../utils/jobLinks';
import '../job-modals.css';

/**
 * What this job is about: the stock it uses and the equipment it services.
 *
 * Every stock link says which of the two it is. A reference just puts the job
 * in the item's history. "Uses stock" is a promise the app keeps — completing
 * the job takes that many off the shelf and writes it to the movements ledger,
 * and reopening puts them back — so it is a deliberate choice on the row, not
 * something inferred from whether a quantity happens to be filled in.
 *
 * A job whose title reads as consuming something ("replace the filter") opens
 * with Uses preselected. That is a starting point, not a decision: the toggle
 * is on the row and the panel says why it guessed.
 */
const JobLinksPanel = ({ job, activeTenantId, currentUserId, canInteract = true }) => {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ items: [], equipment: [] });
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Links this session preselected from the job title, so the panel can own up
  // to the guess rather than leaving someone wondering who set it.
  const [suggested, setSuggested] = useState([]);

  const jobStatus = job?.status || null;
  const jobId = job?.supabase_id || job?.id || null;

  const refresh = useCallback(async () => {
    if (!jobId || !activeTenantId) { setLoading(false); return; }
    try {
      setLinks(await loadJobLinks({ job, tenantId: activeTenantId }));
      setError(null);
    } catch (err) {
      console.warn('[JobLinksPanel] load failed:', err);
      setError('Could not load what this job is linked to.');
    } finally {
      setLoading(false);
    }
    // job is rebuilt each render; its id is what decides what to load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, activeTenantId]);

  // Re-read on status change too: completing the job stamps every consumed
  // link, and an open panel should show that rather than stale quantities.
  useEffect(() => { refresh(); }, [refresh, jobStatus]);

  // ── Search, debounced so typing does not fire a query per keystroke ──
  useEffect(() => {
    if (!picking || !activeTenantId) return undefined;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchLinkTargets({ tenantId: activeTenantId, query });
        if (!cancelled) setResults(found);
      } catch (err) {
        console.warn('[JobLinksPanel] search failed:', err);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [picking, query, activeTenantId]);

  const linkedIds = new Set(links?.map(l => l?.item?.id || l?.equipment?.id));

  const handleAdd = async (kind, target) => {
    if (linkedIds?.has(target?.id)) return;
    setBusyId(target?.id);
    // "Replace the ice maker filter" almost certainly uses one, so open on that
    // rather than making someone set it every time. Never for a size-tracked
    // item, which cannot be deducted at all.
    const guess = kind === INVENTORY
      && !isVariantItem(target)
      && suggestsConsumption(job?.title);
    try {
      await addJobLink({
        job,
        tenantId: activeTenantId,
        kind,
        targetId: target?.id,
        purpose: guess ? USES : ABOUT,
        qty: guess ? 1 : null,
        userId: currentUserId,
      });
      if (guess) setSuggested(prev => [...prev, target?.id]);
      setQuery('');
      setPicking(false);
      await refresh();
    } catch (err) {
      console.warn('[JobLinksPanel] add failed:', err);
      setError('That did not link. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleQty = async (link, raw) => {
    const value = raw === '' ? null : Math.max(0, Number(raw) || 0);
    const qty = value === 0 ? null : value;
    setLinks(prev => prev?.map(l => (l?.id === link?.id ? { ...l, qty } : l)));
    try {
      await setJobLinkQty({ linkId: link?.id, qty });
    } catch (err) {
      console.warn('[JobLinksPanel] qty save failed:', err);
      setError('That quantity did not save.');
    }
  };

  const handlePurpose = async (link, purpose) => {
    const qty = purpose === USES ? (link?.qty || 1) : null;
    setLinks(prev => prev?.map(l => (l?.id === link?.id ? { ...l, purpose, qty } : l)));
    try {
      await setJobLinkPurpose({ linkId: link?.id, purpose, qty });
    } catch (err) {
      console.warn('[JobLinksPanel] purpose save failed:', err);
      setError('That did not save.');
    }
  };

  // Correcting a completed job. The guess and the pre-round estimate are both
  // estimates; what actually came off the shelf is only known afterwards, so
  // stock follows the correction rather than the other way round.
  const handleAdjust = async (link, raw) => {
    const next = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
    if (next === (Number(link?.qty) || 0)) return;
    setBusyId(link?.id);
    try {
      const r = await adjustConsumedQty({
        link, tenantId: activeTenantId, userId: currentUserId, newQty: next,
      });
      if (r?.refused) {
        setError(`${r?.name} is tracked by size, so adjust it from the item itself.`);
      } else if (r?.shortfall > 0) {
        setError(`Only ${r?.moved} were left in stock, so ${r?.shortfall} more is unaccounted for.`);
      }
      await refresh();
    } catch (err) {
      console.warn('[JobLinksPanel] adjust failed:', err);
      setError('That correction did not save. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (link) => {
    setBusyId(link?.id);
    try {
      await removeJobLink({ linkId: link?.id });
      await refresh();
    } catch (err) {
      console.warn('[JobLinksPanel] remove failed:', err);
      setError('Could not unlink that.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;

  const stockOf = (item) => Number(item?.total_qty ?? item?.quantity) || 0;

  const renderLink = (link) => {
    const isStock = link?.kind === INVENTORY;
    const target = isStock ? link?.item : link?.equipment;
    const variant = isStock && isVariantItem(link?.item);
    return (
      <div key={link?.id} className="jl-row">
        <span className={`jl-ico${isStock ? '' : ' equip'}`}>
          <Icon name={isStock ? 'Package' : 'Wrench'} size={14} />
        </span>

        <div className="jl-main">
          <p className="jl-name">{link?.name}</p>
          <p className="jl-sub">
            {isStock
              ? [
                  link?.item?.sub_location || link?.item?.location,
                  `${stockOf(link?.item)} ${link?.item?.unit || 'in stock'}`,
                ]?.filter(Boolean)?.join(' · ')
              : [link?.equipment?.code, link?.equipment?.manufacturer, link?.equipment?.location_label]
                  ?.filter(Boolean)?.join(' · ') || 'Equipment'}
          </p>
        </div>

        {isStock && (
          <div className="jl-qty">
            {link?.consumedAt ? (
              canInteract ? (
                <span className="jl-usededit" title="Correct how many were actually used">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="jm-input jl-qtyfield used"
                    defaultValue={link?.qty ?? ''}
                    disabled={busyId === link?.id}
                    onBlur={(e) => handleAdjust(link, e?.target?.value)}
                  />
                  <span className="jl-unit">{link?.item?.unit || ''} used</span>
                </span>
              ) : (
                <span className="jl-used">
                  <Icon name="Check" size={11} />
                  {link?.qty} used
                </span>
              )
            ) : (
              <>
                {/* What the link is for. Reference is the default and moves
                    nothing; Uses is the deliberate choice that deducts. */}
                <div className="jl-mode" role="group" aria-label="What this link is for">
                  <button
                    type="button"
                    className={`jl-modebtn${link?.purpose !== USES ? ' on' : ''}`}
                    disabled={!canInteract}
                    onClick={() => handlePurpose(link, ABOUT)}
                    title="The job is about this item — nothing comes out of stock"
                  >
                    Reference
                  </button>
                  <button
                    type="button"
                    className={`jl-modebtn${link?.purpose === USES ? ' on' : ''}`}
                    disabled={!canInteract || variant}
                    onClick={() => handlePurpose(link, USES)}
                    title={variant
                      ? 'This item is tracked by size, so it cannot be deducted automatically'
                      : 'The job uses this up — completing it takes the quantity out of stock'}
                  >
                    Uses
                  </button>
                </div>
                {link?.purpose === USES && (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="jm-input jl-qtyfield"
                      placeholder="Qty"
                      defaultValue={link?.qty ?? ''}
                      disabled={!canInteract}
                      title="How many this job uses"
                      onBlur={(e) => handleQty(link, e?.target?.value)}
                    />
                    <span className="jl-unit">{link?.item?.unit || ''}</span>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {canInteract && !link?.consumedAt && (
          <button
            type="button"
            className="jl-x"
            title="Unlink"
            disabled={busyId === link?.id}
            onClick={() => handleRemove(link)}
          >
            <Icon name="X" size={14} />
          </button>
        )}
      </div>
    );
  };

  // Say what the quantity is for, before it does anything. A number in a box
  // that silently moves real stock when the job is ticked is the kind of thing
  // people discover afterwards, so the panel states it either way: what will
  // happen once a quantity is set, and exactly what will move when one is.
  const stockLinks = links?.filter(l => l?.kind === INVENTORY);
  const pending = stockLinks?.filter(l => l?.purpose === USES && l?.qty > 0 && !l?.consumedAt);
  const needsQty = stockLinks?.filter(l => l?.purpose === USES && !(l?.qty > 0) && !l?.consumedAt);
  const references = stockLinks?.filter(l => l?.purpose !== USES && !l?.consumedAt);
  const consumedLinks = stockLinks?.filter(l => l?.consumedAt);
  const guessed = stockLinks?.some(l => suggested?.includes(l?.item?.id) && l?.purpose === USES);

  const listOf = (ls) => ls
    ?.map(l => `${l?.qty} ${l?.name}${l?.item?.unit && l?.item?.unit !== 'each' ? ` ${l.item.unit}` : ''}`)
    ?.join(', ');

  return (
    <div className="jl">
      <div className="jm-secthead-row">
        <p className="jm-secthead">
          <Icon name="Link2" size={14} />
          Linked to
        </p>
        {canInteract && (
          <button type="button" className="dc-bulk" onClick={() => setPicking(!picking)}>
            <Icon name={picking ? 'X' : 'Plus'} size={13} />
            {picking ? 'Cancel' : 'Link an item'}
          </button>
        )}
      </div>

      {error && (
        <div className="jm-notice danger" style={{ marginBottom: 12 }}>
          <Icon name="AlertCircle" size={15} />
          <span>{error}</span>
        </div>
      )}

      {links?.length > 0 ? (
        <div className="jl-list">{links?.map(renderLink)}</div>
      ) : (
        !picking && <p className="jm-hint" style={{ marginTop: 0 }}>Nothing linked yet.</p>
      )}

      {pending?.length > 0 && (
        <p className="jm-hint">
          Marking this job complete takes <strong>{listOf(pending)}</strong> off the
          shelf and records it against the item. Reopening the job puts it back.
        </p>
      )}
      {needsQty?.length > 0 && (
        <p className="jm-hint">
          Set a quantity for {needsQty?.map(l => l?.name)?.join(', ')} — how many the
          job uses.
        </p>
      )}
      {guessed && (
        <p className="jm-hint">
          Set to <strong>Uses</strong> because this job reads as replacing something.
          Switch it to Reference if nothing actually comes out of stock.
        </p>
      )}
      {pending?.length === 0 && needsQty?.length === 0 && references?.length > 0 && (
        <p className="jm-hint">
          Linked for reference — completing this job won’t change any stock. Switch a
          row to <strong>Uses</strong> if the job consumes it.
        </p>
      )}
      {consumedLinks?.length > 0 && (
        <p className="jm-hint">
          {canInteract
            ? 'Already taken out of stock. Change the number if a different amount was actually used — stock adjusts to match, and zero puts it all back.'
            : 'Already taken out of stock when this job was completed.'}
        </p>
      )}

      {picking && (
        <div className="jl-picker">
          <input
            autoFocus
            type="text"
            className="jm-input"
            placeholder="Search stock and equipment…"
            value={query}
            onChange={(e) => setQuery(e?.target?.value)}
          />

          <div className="jl-results">
            {searching && <p className="jm-hint">Searching…</p>}

            {!searching && results?.items?.length === 0 && results?.equipment?.length === 0 && (
              <p className="jm-hint">Nothing matched that.</p>
            )}

            {results?.items?.length > 0 && (
              <>
                <p className="jl-grouphead">Stock</p>
                {results?.items?.map(item => (
                  <button
                    key={item?.id}
                    type="button"
                    className="jl-result"
                    disabled={linkedIds?.has(item?.id) || busyId === item?.id}
                    onClick={() => handleAdd(INVENTORY, item)}
                  >
                    <span className="jl-ico"><Icon name="Package" size={13} /></span>
                    <span className="jl-main">
                      <span className="jl-name">{item?.name}</span>
                      <span className="jl-sub">
                        {[item?.sub_location || item?.location, `${stockOf(item)} ${item?.unit || ''}`.trim()]
                          ?.filter(Boolean)?.join(' · ')}
                      </span>
                    </span>
                    {linkedIds?.has(item?.id)
                      ? <span className="jl-added">Linked</span>
                      : <Icon name="Plus" size={14} />}
                  </button>
                ))}
              </>
            )}

            {results?.equipment?.length > 0 && (
              <>
                <p className="jl-grouphead">Equipment</p>
                {results?.equipment?.map(eq => (
                  <button
                    key={eq?.id}
                    type="button"
                    className="jl-result"
                    disabled={linkedIds?.has(eq?.id) || busyId === eq?.id}
                    onClick={() => handleAdd(EQUIPMENT, eq)}
                  >
                    <span className="jl-ico equip"><Icon name="Wrench" size={13} /></span>
                    <span className="jl-main">
                      <span className="jl-name">{eq?.name}</span>
                      <span className="jl-sub">
                        {[eq?.code, eq?.manufacturer, eq?.location_label]?.filter(Boolean)?.join(' · ') || 'Equipment'}
                      </span>
                    </span>
                    {linkedIds?.has(eq?.id)
                      ? <span className="jl-added">Linked</span>
                      : <Icon name="Plus" size={14} />}
                  </button>
                ))}
              </>
            )}

            {/* The equipment register is a real table with nothing in it yet, so
                say that rather than letting an empty group read as a failed
                search. */}
            {!searching && results?.equipment?.length === 0 && results?.items?.length > 0 && (
              <p className="jm-hint">No equipment matched — the equipment register is still empty.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default JobLinksPanel;
