import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  INVENTORY,
  EQUIPMENT,
  loadJobLinks,
  addJobLink,
  setJobLinkQty,
  removeJobLink,
  searchLinkTargets,
  isVariantItem,
} from '../utils/jobLinks';
import '../job-modals.css';

/**
 * What this job is about: the stock it uses and the equipment it services.
 *
 * A quantity on a stock link is a promise the app keeps — completing the job
 * takes that many off the shelf and writes it to the movements ledger, and
 * reopening puts them back. So the quantity field says so out loud rather than
 * letting someone discover it.
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
    try {
      await addJobLink({
        job, tenantId: activeTenantId, kind, targetId: target?.id, userId: currentUserId,
      });
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
              <span className="jl-used">
                <Icon name="Check" size={11} />
                {link?.qty} used
              </span>
            ) : (
              <>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="jm-input jl-qtyfield"
                  placeholder="Qty"
                  defaultValue={link?.qty ?? ''}
                  disabled={!canInteract || variant}
                  title={variant
                    ? 'This item is tracked by size, so it cannot be deducted automatically'
                    : 'How many this job uses'}
                  onBlur={(e) => handleQty(link, e?.target?.value)}
                />
                <span className="jl-unit">{link?.item?.unit || ''}</span>
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
  const pending = stockLinks?.filter(l => l?.qty > 0 && !l?.consumedAt);
  const unquantified = stockLinks?.filter(l => !(l?.qty > 0) && !l?.consumedAt);
  const consumedLinks = stockLinks?.filter(l => l?.consumedAt);

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
      {pending?.length === 0 && unquantified?.length > 0 && (
        <p className="jm-hint">
          Set a quantity to have completing this job take that many out of stock.
          Leave it blank and the link is just a reference.
        </p>
      )}
      {consumedLinks?.length > 0 && (
        <p className="jm-hint">
          Already taken out of stock when this job was completed.
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
