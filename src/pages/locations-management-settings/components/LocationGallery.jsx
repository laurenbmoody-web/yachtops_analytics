// Location Management — the Gallery. Decks → zones → spaces, each space showing
// its scan (or inviting one). Flow ↔ static toggle; coverage at a glance.
// Reads via getVesselGallery; writes via locationsHierarchyStorage. "Add scan"
// hands off to the map's upload flow with the space pre-linked.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getVesselGallery } from '../utils/locationsGalleryStorage';
import {
  createDeck, createZone, createSpace,
  updateDeck, updateZone, updateSpace,
  archiveDeck, archiveZone, archiveSpace,
} from '../utils/locationsHierarchyStorage';
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

export default function LocationGallery() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => (typeof localStorage !== 'undefined' && localStorage.getItem('lg-view')) || 'static');
  const [edit, setEdit] = useState(null); // {mode, id, value, error, saving}
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    const g = await getVesselGallery();
    setData(g);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setViewPersist = (v) => { setView(v); try { localStorage.setItem('lg-view', v); } catch { /* ignore */ } };

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
  }, [view, data]);

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

  const addScan = (space) => navigate(`/vessel/map/manage?space=${space.id}&name=${encodeURIComponent(space.name)}`);
  const openSpace = (space) => {
    if (space.scan?.id && space.scan.status === 'ready') navigate(`/vessel/map?scan=${space.scan.id}`);
    else addScan(space);
  };

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

  const SpaceCard = (space) => {
    const scan = space.scan;
    const scanned = scan?.status === 'ready';
    return (
      <div key={space.id} className={`lg-cf${scanned ? '' : ' dim'}`} onClick={() => openSpace(space)}>
        <div className="card">
          {scanned && scan.thumbUrl ? (
            <div className="img" style={{ backgroundImage: `url("${scan.thumbUrl}")` }} />
          ) : scanned ? (
            <div className="img" />
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
          <div className="lg-metabar">
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

          {!loading && data?.decks?.map((deck) => (
            <div className="lg-deck" key={deck.id}>
              <div className="lg-deckhdr">
                {edit?.mode === 'rename-deck' && edit.id === deck.id
                  ? <InlineEditor placeholder="Deck name" />
                  : (<><span className="dn">{deck.name}</span>
                      <span className="dc">· {deck.zoneCount} {deck.zoneCount === 1 ? 'zone' : 'zones'} · {deck.spaceCount} {deck.spaceCount === 1 ? 'space' : 'spaces'}</span>
                      <span className="acts">
                        <button className="lg-btn" onClick={() => startEdit('add-zone', deck.id)}>＋ Zone</button>
                        <button className="lg-btn" onClick={() => startEdit('rename-deck', deck.id, deck.name)}>Rename</button>
                        <button className="lg-btn ghost-danger" onClick={() => doArchive('deck', deck.id)}>Archive</button>
                      </span></>)}
              </div>

              {edit?.mode === 'add-zone' && edit.id === deck.id && (
                <div style={{ margin: '10px 0' }}><InlineEditor placeholder="Zone name — e.g. Interior · Guest" /></div>
              )}

              {deck.zones.length === 0 && edit?.id !== deck.id && (
                <div className="lg-empty" style={{ margin: '12px 30px' }}>No zones yet. <button className="lg-newdeck" onClick={() => startEdit('add-zone', deck.id)}>＋ Add a zone</button></div>
              )}

              {deck.zones.map((zone, zi) => (
                <div className="lg-zone" key={zone.id}>
                  <div className="lg-zhdr">
                    <span className={`zdot z${zi % 4}`} />
                    {edit?.mode === 'rename-zone' && edit.id === zone.id
                      ? <InlineEditor placeholder="Zone name" />
                      : (<>
                          <span className="zn">{zone.name}</span>
                          <span className="zct">{zone.spaceCount} {zone.spaceCount === 1 ? 'space' : 'spaces'}</span>
                          <span className="zacts">
                            <button className="lg-btn sm" onClick={() => startEdit('rename-zone', zone.id, zone.name)}>Rename</button>
                            <button className="lg-btn sm" onClick={() => startEdit('add-space', zone.id)}>＋ Add space</button>
                          </span>
                        </>)}
                  </div>

                  {edit?.mode === 'add-space' && edit.id === zone.id && (
                    <div style={{ margin: '8px 30px' }}><InlineEditor placeholder="Space name — e.g. Bridge Salon" /></div>
                  )}

                  <div className="row">
                    {zone.spaces.map(SpaceCard)}
                    <div className="lg-cf addcard" onClick={() => startEdit('add-space', zone.id)}>
                      <div className="card"><div className="plus">＋ Add space</div><div className="foot" /></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
