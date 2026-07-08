// Location Management — the Gallery. Each deck is its own card; zones and their
// space-scans nest inside. Flow ↔ static toggle, drag-to-reorder (grips),
// collapse/expand (chevrons), and a ⋯ menu per deck/zone for actions.
// Reads via getVesselGallery; writes via locationsHierarchyStorage. "Add scan"
// hands off to the map's upload flow with the space pre-linked.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { getVesselGallery } from '../utils/locationsGalleryStorage';
import {
  createDeck, createZone, createSpace,
  updateDeck, updateZone, updateSpace,
  archiveDeck, archiveZone, archiveSpace,
  reorderLocations,
} from '../utils/locationsHierarchyStorage';
import AddScanModal from './AddScanModal';
import ScanMotif from './ScanMotif';
import '../location-gallery.css';

const FlowIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="7.5" y="4" width="5" height="12" rx="1.5" /><path d="M4.5 6.5v7M15.5 6.5v7" strokeLinecap="round" />
  </svg>
);
const GridIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.3" /><rect x="11" y="3.5" width="5.5" height="5.5" rx="1.3" />
    <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.3" /><rect x="11" y="11" width="5.5" height="5.5" rx="1.3" />
  </svg>
);
const GripIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="7" cy="5" r="1.3" /><circle cx="13" cy="5" r="1.3" /><circle cx="7" cy="10" r="1.3" />
    <circle cx="13" cy="10" r="1.3" /><circle cx="7" cy="15" r="1.3" /><circle cx="13" cy="15" r="1.3" />
  </svg>
);
const ChevIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const DotsIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="10" cy="4" r="1.7" /><circle cx="10" cy="10" r="1.7" /><circle cx="10" cy="16" r="1.7" />
  </svg>
);

// ── local tree helpers for optimistic drag-reorder ──
const moveInList = (list, fromId, toId) => {
  const arr = [...list];
  const from = arr.findIndex((x) => x.id === fromId);
  const to = arr.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0 || from === to) return list;
  const [m] = arr.splice(from, 1);
  arr.splice(to, 0, m);
  return arr;
};
const reorderTree = (data, level, parentId, fromId, toId) => {
  if (level === 'deck') return { ...data, decks: moveInList(data.decks, fromId, toId) };
  return {
    ...data,
    decks: data.decks.map((deck) => {
      if (level === 'zone') return deck.id === parentId ? { ...deck, zones: moveInList(deck.zones, fromId, toId) } : deck;
      return { ...deck, zones: deck.zones.map((z) => (z.id === parentId ? { ...z, spaces: moveInList(z.spaces, fromId, toId) } : z)) };
    }),
  };
};
const siblingIds = (data, level, parentId) => {
  if (!data) return [];
  if (level === 'deck') return data.decks.map((d) => d.id);
  for (const deck of data.decks) {
    if (level === 'zone' && deck.id === parentId) return deck.zones.map((z) => z.id);
    if (level === 'space') { const z = deck.zones.find((zz) => zz.id === parentId); if (z) return z.spaces.map((s) => s.id); }
  }
  return [];
};

export default function LocationGallery({ onStats, hideStats = false } = {}) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('lg-view')) || 'static');
  const [edit, setEdit] = useState(null); // {mode, id, value, error, saving}
  const [menu, setMenu] = useState(null); // `deck:${id}` | `zone:${id}`
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dragId, setDragId] = useState(null);
  const [addScanSpace, setAddScanSpace] = useState(null);
  const rootRef = useRef(null);
  const dataRef = useRef(null);
  const initedRef = useRef(false);
  const dragRef = useRef(null);   // {level, id, parentId}
  const grabRef = useRef(false);  // true only while a grip is held

  useEffect(() => { dataRef.current = data; }, [data]);

  const load = useCallback(async () => {
    const g = await getVesselGallery();
    setData(g);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // collapse every deck by default when the section first opens
  useEffect(() => {
    if (!data || initedRef.current) return;
    if (data.decks && data.decks.length) {
      initedRef.current = true;
      setCollapsed(new Set(data.decks.map((d) => d.id)));
    }
  }, [data]);

  // report stats up (e.g. to the Vessel Hub masthead dateline)
  useEffect(() => {
    if (!onStats || !data) return;
    onStats({
      scanned: data.coverage?.scanned || 0,
      total: data.coverage?.total || 0,
      decks: data.decks?.length || 0,
      zones: (data.decks || []).reduce((n, d) => n + d.zoneCount, 0),
    });
  }, [data, onStats]);

  const setViewPersist = (v) => { setView(v); try { localStorage.setItem('lg-view', v); } catch { /* ignore */ } };

  // close kebab on any outside click
  useEffect(() => {
    if (!menu) return undefined;
    const h = () => setMenu(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [menu]);

  // a grip release anywhere clears the grab intent
  useEffect(() => {
    const up = () => { grabRef.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const isClosed = (id) => collapsed.has(id);
  const toggleCollapse = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── cover-flow shaping (flow mode only) ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const rows = [...root.querySelectorAll('.row')];
    if (view !== 'flow') {
      root.querySelectorAll('.lg-cf').forEach((cf) => { cf.style.transform = ''; cf.style.opacity = ''; cf.style.zIndex = ''; });
      return undefined;
    }
    const shape = (row) => {
      const rect = row.getBoundingClientRect();
      const focus = rect.left + rect.width / 2;
      const span = rect.width * 0.6;
      row.querySelectorAll('.lg-cf').forEach((cf) => {
        const r = cf.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - focus;
        const t = Math.max(-1, Math.min(1, dx / span));
        cf.style.transform = `translateZ(${-Math.abs(t) * 140}px) rotateY(${-t * 42}deg) scale(${1 - Math.min(Math.abs(t) * 0.9, 0.34)})`;
        cf.style.opacity = String(1 - Math.min(Math.abs(t) * 1.1, 0.6));
        cf.style.zIndex = String(1000 - Math.round(Math.abs(dx)));
      });
    };
    const cleanups = rows.map((row) => {
      const cards = [...row.querySelectorAll('.lg-cf')];
      const rooms = cards.filter((c) => !c.classList.contains('addcard'));
      const focus = rooms[rooms.length - 1] || cards[0];
      if (focus) row.scrollLeft = focus.offsetLeft + focus.offsetWidth / 2 - row.clientWidth / 2;
      shape(row);
      const onScroll = () => requestAnimationFrame(() => shape(row));
      row.addEventListener('scroll', onScroll, { passive: true });
      return () => row.removeEventListener('scroll', onScroll);
    });
    const onResize = () => rows.forEach(shape);
    window.addEventListener('resize', onResize);
    return () => { cleanups.forEach((c) => c()); window.removeEventListener('resize', onResize); };
  }, [view, data, collapsed]);

  // ── mutations ──
  const startEdit = (mode, id = null, value = '') => setEdit({ mode, id, value, error: '', saving: false });
  const submitEdit = async () => {
    if (!edit) return;
    const v = edit.value.trim();
    if (!v) { setEdit((e) => ({ ...e, error: 'Enter a name.' })); return; }
    setEdit((e) => ({ ...e, saving: true, error: '' }));
    try {
      const { mode, id } = edit;
      if (mode === 'new-deck') await createDeck(v);
      else if (mode === 'add-zone') await createZone(id, v);
      else if (mode === 'add-space') await createSpace(id, v);
      else if (mode === 'rename-deck') await updateDeck(id, v);
      else if (mode === 'rename-zone') await updateZone(id, v);
      else if (mode === 'rename-space') await updateSpace(id, v);
      setEdit(null);
      await load();
    } catch (err) {
      console.error('[loc-gallery] save error:', err);
      setEdit((e) => ({ ...e, saving: false, error: err?.message || 'Could not save.' }));
    }
  };
  const doArchive = async (level, id) => {
    try {
      if (level === 'deck') await archiveDeck(id);
      else if (level === 'zone') await archiveZone(id);
      else await archiveSpace(id);
      await load();
    } catch (err) { console.error('[loc-gallery] archive error:', err); }
  };

  // ── drag-to-reorder (initiated from a grip; siblings only) ──
  const grab = () => { grabRef.current = true; };
  const startDrag = (level, id, parentId) => (e) => {
    if (!grabRef.current) { e.preventDefault(); return; }
    e.stopPropagation();
    dragRef.current = { level, id, parentId };
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
  };
  const allowDrop = (e) => { if (dragRef.current) e.preventDefault(); };
  const enterItem = (level, id, parentId) => (e) => {
    const d = dragRef.current;
    if (!d || d.level !== level || d.parentId !== parentId || d.id === id) return;
    e.preventDefault();
    e.stopPropagation();
    setData((prev) => reorderTree(prev, level, parentId, d.id, id));
  };
  const endDrag = async (e) => {
    e.stopPropagation();
    grabRef.current = false;
    const d = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    if (!d) return;
    const ids = siblingIds(dataRef.current, d.level, d.parentId);
    try { await reorderLocations(ids); } catch (err) { console.error('[loc-gallery] reorder error:', err); await load(); }
  };

  const addScan = (space) => setAddScanSpace(space);
  const viewOnMap = (space) => navigate(`/vessel/map?scan=${space.scan.id}`);
  const openSpace = (space) => {
    if (space.scan?.id && space.scan.status === 'ready') viewOnMap(space);
    else addScan(space);
  };
  const removeScan = async (space) => {
    const scan = space.scan;
    if (!scan) return;
    try {
      await supabase.from('vessel_scans').delete().eq('id', scan.id);
      const paths = [scan.storagePath, scan.thumbPath].filter(Boolean);
      if (paths.length) await supabase.storage.from('vessel-scans').remove(paths);
    } catch (err) { console.error('[loc-gallery] remove scan error:', err); }
    await load();
  };
  const replaceScan = async (space) => { await removeScan(space); setAddScanSpace({ id: space.id, name: space.name }); };

  const InlineEditor = ({ placeholder }) => (
    <div className="lg-inline">
      <input
        autoFocus
        placeholder={placeholder}
        value={edit.value}
        disabled={edit.saving}
        onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') submitEdit(); if (e.key === 'Escape') setEdit(null); }}
      />
      <button className="save" onClick={submitEdit} disabled={edit.saving}>{edit.saving ? 'Saving…' : 'Save'}</button>
      <button className="cancel" onClick={() => setEdit(null)} disabled={edit.saving}>Cancel</button>
      {edit.error && <span className="err">{edit.error}</span>}
    </div>
  );

  const Kebab = ({ id, items }) => (
    <div className={`lg-kebab${menu === id ? ' open' : ''}`}>
      <button aria-label="Actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === id ? null : id); }}><DotsIcon /></button>
      {menu === id && (
        <div className="lg-menu" onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) => (it.sep
            ? <div key={i} className="lg-sep" />
            : <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { setMenu(null); it.on(); }}>{it.label}</button>))}
        </div>
      )}
    </div>
  );

  const SpaceCard = (space, zoneId) => {
    const scan = space.scan;
    const scanned = scan?.status === 'ready';
    return (
      <div
        key={space.id}
        className={`lg-cf${scanned ? '' : ' dim'}${dragId === space.id ? ' dragging' : ''}`}
        draggable
        onDragStart={startDrag('space', space.id, zoneId)}
        onDragEnd={endDrag}
        onDragEnter={enterItem('space', space.id, zoneId)}
        onDragOver={allowDrop}
        onClick={() => openSpace(space)}
      >
        <span className="cf-grip" onMouseDown={grab} title="Drag to reorder"><GripIcon /></span>
        {scanned && (
          <div className="cf-menu">
            <Kebab id={`space:${space.id}`} items={[
              { label: 'View on map', on: () => viewOnMap(space) },
              { label: 'Replace scan', on: () => replaceScan(space) },
              { sep: true },
              { label: 'Remove scan', danger: true, on: () => removeScan(space) },
            ]} />
          </div>
        )}
        <div className="card">
          {scanned && scan.thumbUrl ? (
            <div className="img" style={{ backgroundImage: `url("${scan.thumbUrl}")` }} />
          ) : scanned ? (
            <div className="img motif"><ScanMotif /></div>
          ) : (
            <div className="noscan" onClick={(e) => { e.stopPropagation(); addScan(space); }}>
              <span className="sc">＋ Add scan</span>
            </div>
          )}
          <div className="foot">
            <span className="nm">{space.name}</span>
            <span className={`st ${scanned ? 'on' : 'off'}`}>{scanned ? 'Scanned' : 'No scan'}</span>
          </div>
        </div>
      </div>
    );
  };

  const coverage = data?.coverage || { scanned: 0, total: 0 };
  const pct = coverage.total ? Math.round((coverage.scanned / coverage.total) * 100) : 0;
  const decksTotal = data?.decks?.length || 0;
  const zonesTotal = (data?.decks || []).reduce((n, d) => n + d.zoneCount, 0);

  return (
    <div className={`lg ${view}`} ref={rootRef}>
      <div className="lg-wrap">
        <div className="lg-pane">
          {/* meta bar: stats left, controls right */}
          <div className={`lg-metabar${hideStats ? ' controls-only' : ''}`}>
            {!hideStats && (
              <div className="lg-meta">
                <div className="m cov">
                  <span className="k">Scanned</span>
                  <span className="v">{coverage.scanned} / {coverage.total}</span>
                  <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                </div>
                <div className="m"><span className="k">Decks</span><span className="v">{decksTotal}</span></div>
                <div className="m"><span className="k">Zones</span><span className="v">{zonesTotal}</span></div>
                <div className="m"><span className="k">Spaces</span><span className="v">{coverage.total}</span></div>
              </div>
            )}
            <div className="lg-actions">
              <div className="lg-seg" role="tablist" aria-label="View">
                <button className={view === 'flow' ? 'on' : ''} aria-selected={view === 'flow'} onClick={() => setViewPersist('flow')}><FlowIcon />Flow</button>
                <button className={view === 'static' ? 'on' : ''} aria-selected={view === 'static'} onClick={() => setViewPersist('static')}><GridIcon />Static</button>
              </div>
              <button className="lg-btn-primary" onClick={() => startEdit('new-deck')}>＋ New deck</button>
            </div>
          </div>

          {edit?.mode === 'new-deck' && (
            <div style={{ marginTop: 16 }}><InlineEditor placeholder="Deck name — e.g. Bridge Deck" /></div>
          )}

          {loading && (
            <div className="lg-loading">Loading the vessel…</div>
          )}

          {!loading && data?.decks?.length === 0 && (
            <div className="lg-empty">
              <div className="big">No decks yet</div>
              Start by adding a deck — then zones and spaces inside it.
            </div>
          )}

          {!loading && data?.decks?.map((deck) => {
            const deckClosed = isClosed(deck.id);
            return (
              <div
                className={`lg-deck${dragId === deck.id ? ' dragging' : ''}${deckClosed ? ' collapsed' : ''}`}
                key={deck.id}
                draggable
                onDragStart={startDrag('deck', deck.id, null)}
                onDragEnd={endDrag}
                onDragEnter={enterItem('deck', deck.id, null)}
                onDragOver={allowDrop}
              >
                <div className="lg-deckhdr">
                  <span className="lg-grip" onMouseDown={grab} title="Drag to reorder"><GripIcon /></span>
                  <button className={`lg-chev${deckClosed ? ' closed' : ''}`} onClick={() => toggleCollapse(deck.id)} aria-label={deckClosed ? 'Expand' : 'Collapse'}><ChevIcon /></button>
                  {edit?.mode === 'rename-deck' && edit.id === deck.id
                    ? <InlineEditor placeholder="Deck name" />
                    : (<>
                        <span className="dn">{deck.name}</span>
                        <span className="lg-spring" />
                        <Kebab id={`deck:${deck.id}`} items={[
                          { label: 'Rename', on: () => startEdit('rename-deck', deck.id, deck.name) },
                          { label: 'Add zone', on: () => startEdit('add-zone', deck.id) },
                          { sep: true },
                          { label: 'Archive', danger: true, on: () => doArchive('deck', deck.id) },
                        ]} />
                      </>)}
                </div>

                {!deckClosed && (
                  <div className="lg-deckbody">
                    {edit?.mode === 'add-zone' && edit.id === deck.id && (
                      <div style={{ margin: '12px 0' }}><InlineEditor placeholder="Zone name — e.g. Interior · Guest" /></div>
                    )}

                    {deck.zones.length === 0 && edit?.id !== deck.id && (
                      <div className="lg-empty">No zones yet. <button className="lg-link" onClick={() => startEdit('add-zone', deck.id)}>＋ Add a zone</button></div>
                    )}

                    {deck.zones.map((zone) => {
                      const zoneClosed = isClosed(zone.id);
                      return (
                        <div
                          className={`lg-zone${dragId === zone.id ? ' dragging' : ''}`}
                          key={zone.id}
                          draggable
                          onDragStart={startDrag('zone', zone.id, deck.id)}
                          onDragEnd={endDrag}
                          onDragEnter={enterItem('zone', zone.id, deck.id)}
                          onDragOver={allowDrop}
                        >
                          <div className="lg-zhdr">
                            <span className="lg-grip" onMouseDown={grab} title="Drag to reorder"><GripIcon /></span>
                            <button className={`lg-chev${zoneClosed ? ' closed' : ''}`} onClick={() => toggleCollapse(zone.id)} aria-label={zoneClosed ? 'Expand' : 'Collapse'}><ChevIcon /></button>
                            {edit?.mode === 'rename-zone' && edit.id === zone.id
                              ? <InlineEditor placeholder="Zone name" />
                              : (<>
                                  <span className="zn">{zone.name}</span>
                                  <span className="lg-spring" />
                                  <Kebab id={`zone:${zone.id}`} items={[
                                    { label: 'Rename', on: () => startEdit('rename-zone', zone.id, zone.name) },
                                    { label: 'Add space', on: () => startEdit('add-space', zone.id) },
                                    { sep: true },
                                    { label: 'Archive', danger: true, on: () => doArchive('zone', zone.id) },
                                  ]} />
                                </>)}
                          </div>

                          {!zoneClosed && (
                            <>
                              {edit?.mode === 'add-space' && edit.id === zone.id && (
                                <div style={{ margin: '8px 0' }}><InlineEditor placeholder="Space name — e.g. Bridge Salon" /></div>
                              )}
                              <div className="row">
                                {zone.spaces.map((space) => SpaceCard(space, zone.id))}
                                <div className="lg-cf addcard" onClick={() => startEdit('add-space', zone.id)}>
                                  <div className="card"><div className="plus">＋ Add space</div><div className="foot" /></div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {addScanSpace && (
        <AddScanModal
          space={addScanSpace}
          onClose={() => setAddScanSpace(null)}
          onComplete={() => load()}
        />
      )}
    </div>
  );
}
