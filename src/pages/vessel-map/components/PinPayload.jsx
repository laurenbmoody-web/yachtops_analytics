// The pin's payload rooms — Notes, List, Photos — shared by the desktop
// Inspector and the mobile floating card. Owns its writes (via the
// read-modify-write helper) and reports fresh detail back to the page hub.
// COMMAND/CHIEF write; crew read-only (matches the table's RLS).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { updateDetail, updateDetailKey } from '../utils/hotspotDetail';
import { uploadHotspotPhoto } from '../utils/photoUpload';
import { searchInventoryItems, getInventoryItem, getInventoryLocation, quantityAt, setQuantityHere } from '../utils/inventory';

const relDate = (iso) => {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export default function PinPayload({
  hotspot,          // the selected pin row (detail included)
  tab,              // 'notes' | 'list' | 'photos'
  user,             // signed-in user
  tier,             // 'COMMAND' | 'CHIEF' | 'CREW' | …
  canManage,        // COMMAND/CHIEF — gates all writes
  tenantId,
  names,            // user_id → full_name map (page hub owns the fetch)
  onDetailSaved,    // (hotspotId, detail) => void — sync page state
}) {
  const detail = hotspot?.detail || {};
  // Append order IS chronological — newest first by reversal, immune to
  // same-millisecond timestamp ties.
  const notes = useMemo(() => [...(detail.notes || [])].reverse(), [detail.notes]);
  const checklist = detail.checklist || [];
  const photos = detail.photos || [];

  const [error, setError] = useState(null);
  useEffect(() => { setError(null); }, [hotspot?.id, tab]);

  const nameOf = (id) => (id && (names?.[id] || null)) || 'Crew';
  // Writes are serialized: read-modify-write is only safe when this panel's
  // own operations can't interleave (Enter-Enter-Enter on the list would
  // otherwise read stale rows and drop items).
  const writeQueue = useRef(Promise.resolve());
  const writeWhole = (mutateDetail) => {
    const run = writeQueue.current.then(async () => {
      setError(null);
      const result = await updateDetail(hotspot.id, mutateDetail);
      if (result.error) { setError(result.error); return false; }
      onDetailSaved(hotspot.id, result.detail);
      return true;
    });
    writeQueue.current = run.catch(() => {});
    return run;
  };
  const write = (key, mutate) => {
    const run = writeQueue.current.then(async () => {
      setError(null);
      const result = await updateDetailKey(hotspot.id, key, mutate);
      if (result.error) { setError(result.error); return false; }
      onDetailSaved(hotspot.id, result.detail);
      return true;
    });
    writeQueue.current = run.catch(() => {});
    return run;
  };

  /* ── Notes ── */
  const [noteDraft, setNoteDraft] = useState('');
  const noteRef = useRef(null);
  useEffect(() => { setNoteDraft(''); }, [hotspot?.id]);
  const addNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    const ok = await write('notes', (arr) => [...arr, {
      id: crypto.randomUUID(), text, created_at: new Date().toISOString(), created_by: user?.id ?? null,
    }]);
    if (ok) setNoteDraft('');
  };
  const canDeleteNote = (n) => canManage && (tier === 'COMMAND' || n.created_by === user?.id);
  const deleteNote = (id) => write('notes', (arr) => arr.filter((n) => n.id !== id));

  /* ── Checklist ── */
  const [checkDraft, setCheckDraft] = useState('');
  useEffect(() => { setCheckDraft(''); }, [hotspot?.id]);
  const [optimistic, setOptimistic] = useState(null); // {id, done} while a tick is in flight
  const addCheck = async () => {
    const text = checkDraft.trim();
    if (!text) return;
    const ok = await write('checklist', (arr) => [...arr, {
      id: crypto.randomUUID(), text, done: false, done_at: null, done_by: null,
    }]);
    if (ok) setCheckDraft('');
  };
  const toggleCheck = async (item) => {
    const nextDone = !item.done;
    setOptimistic({ id: item.id, done: nextDone }); // instant feedback…
    const ok = await write('checklist', (arr) => arr.map((c) => (c.id === item.id
      ? { ...c, done: nextDone, done_at: nextDone ? new Date().toISOString() : null, done_by: nextDone ? user?.id ?? null : null }
      : c)));
    setOptimistic(null); // …then the saved detail takes over (or reverts on error)
    if (!ok) setError((prev) => prev || 'Could not save the tick — try again.');
  };
  const deleteCheck = (id) => write('checklist', (arr) => arr.filter((c) => c.id !== id));
  const moveCheck = (id, dir) => write('checklist', (arr) => {
    const i = arr.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // Drag to reorder (desktop; touch keeps the arrows). Only the unticked
  // band moves — the reordered band pours back into the unticked slots so
  // ticked items keep their place in the underlying array.
  const [dragCheck, setDragCheck] = useState(null); // item id in flight
  const [dropMark, setDropMark] = useState(null);   // { id, after }
  const reorderCheck = (fromId, toId, after) => {
    if (!fromId || fromId === toId) return;
    write('checklist', (arr) => {
      const slots = arr.map((c, i) => (!c.done ? i : -1)).filter((i) => i !== -1);
      const band = slots.map((i) => arr[i]);
      const from = band.findIndex((c) => c.id === fromId);
      if (from === -1) return arr;
      const [moved] = band.splice(from, 1);
      const to = band.findIndex((c) => c.id === toId);
      if (to === -1) return arr;
      band.splice(after ? to + 1 : to, 0, moved);
      const next = [...arr];
      slots.forEach((slot, k) => { next[slot] = band[k]; });
      return next;
    });
  };

  // Recurring lists: Reset snapshots the finished run into history (who
  // ticked what, when, who reset), then unticks everything for next time.
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => { setConfirmingReset(false); }, [hotspot?.id, tab]);
  const resetList = () => {
    setConfirmingReset(false);
    return writeWhole((d) => {
      const items = Array.isArray(d.checklist) ? d.checklist : [];
      const run = {
        id: crypto.randomUUID(),
        reset_at: new Date().toISOString(),
        reset_by: user?.id ?? null,
        done_count: items.filter((c) => c.done).length,
        total: items.length,
        ticks: items.filter((c) => c.done).map((c) => ({ text: c.text, done_by: c.done_by, done_at: c.done_at })),
      };
      return {
        ...d,
        checklist_runs: [...(Array.isArray(d.checklist_runs) ? d.checklist_runs : []), run].slice(-20),
        checklist: items.map((c) => ({ ...c, done: false, done_at: null, done_by: null })),
      };
    });
  };
  const lastRun = (detail.checklist_runs || [])[Math.max(0, (detail.checklist_runs || []).length - 1)];
  const viewChecklist = useMemo(() => {
    const items = checklist.map((c) => (optimistic?.id === c.id ? { ...c, done: optimistic.done } : c));
    // Ticked items sink below unticked; original order within each band.
    return [...items.filter((c) => !c.done), ...items.filter((c) => c.done)];
  }, [checklist, optimistic]);
  const doneCount = viewChecklist.filter((c) => c.done).length;

  /* ── Photos ── */
  const [photoUrls, setPhotoUrls] = useState({}); // path → signed url, session cache
  const [uploadingCount, setUploadingCount] = useState(0);
  const [lightbox, setLightbox] = useState(null); // photo object
  const [captionDraft, setCaptionDraft] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const missing = photos.map((p) => p.path).filter((p) => p && !photoUrls[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error: signError } = await supabase.storage
        .from('vessel-scans')
        .createSignedUrls(missing, 3600);
      if (signError) { console.error('[pin-photos] sign error:', signError); return; }
      if (cancelled) return;
      setPhotoUrls((prev) => ({
        ...prev,
        ...Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])),
      }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  useEffect(() => { setLightbox(null); setConfirmingRemove(false); }, [hotspot?.id, tab]);

  // ── Photo tags: dots on the image, each deep-linking to inventory ──
  const navigate = useNavigate();
  const [tagMode, setTagMode] = useState(false);
  const [tagPoint, setTagPoint] = useState(null); // {x, y} 0-1 while placing
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState([]);
  const [openTagId, setOpenTagId] = useState(null);
  const tagDebounce = useRef(null);
  // Live count for the open tag — "12 here" (pin's linked location) or
  // "12 onboard". Read straight from inventory; the tag stores no number.
  const [tagQtys, setTagQtys] = useState({}); // item_id → {qty, where}
  const pinLocRef = useRef({}); // hotspot id → inventory location row (or null)
  useEffect(() => {
    const t = openTagId && (lightboxPhoto?.tags || []).find((x) => x.id === openTagId);
    if (!t || tagQtys[t.item_id]) return undefined;
    let cancelled = false;
    (async () => {
      const locId = hotspot?.storage_location_id || null;
      if (locId && pinLocRef.current[hotspot.id] === undefined) {
        const { location } = await getInventoryLocation(locId);
        pinLocRef.current[hotspot.id] = location || null;
      }
      const { item } = await getInventoryItem(t.item_id);
      if (cancelled || !item) return;
      const q = quantityAt(item, locId ? pinLocRef.current[hotspot.id] : null);
      setTagQtys((prev) => ({ ...prev, [t.item_id]: { ...q, unit: item.unit || null } }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTagId]);

  // Count edit (COMMAND/CHIEF): writes to inventory — splits or sets the
  // stock at the pin's linked location — then re-reads the live number.
  const [qtyEdit, setQtyEdit] = useState(null); // { itemId, value }
  const [qtySaving, setQtySaving] = useState(false);
  const [qtyError, setQtyError] = useState(null);
  useEffect(() => { setQtyEdit(null); setQtyError(null); }, [openTagId, lightbox?.id]);
  const saveQty = async (t) => {
    const q = Number(qtyEdit?.value);
    if (!Number.isFinite(q) || q < 0) { setQtyError('Enter a number.'); return; }
    setQtySaving(true);
    setQtyError(null);
    const loc = hotspot?.storage_location_id ? (pinLocRef.current[hotspot.id] ?? null) : null;
    const { error: qErr } = await setQuantityHere(t.item_id, loc, q);
    if (qErr) { setQtySaving(false); setQtyError(qErr); return; }
    const { item } = await getInventoryItem(t.item_id);
    if (item) setTagQtys((prev) => ({ ...prev, [t.item_id]: { ...quantityAt(item, loc), unit: item.unit || null } }));
    setQtySaving(false);
    setQtyEdit(null);
  };
  useEffect(() => {
    setTagMode(false); setTagPoint(null); setTagQuery(''); setTagResults([]); setOpenTagId(null);
  }, [lightbox?.id]);
  useEffect(() => {
    if (!tagPoint) return undefined;
    clearTimeout(tagDebounce.current);
    tagDebounce.current = setTimeout(async () => {
      const { items, error: searchError } = await searchInventoryItems(tenantId, tagQuery);
      if (searchError) setError(searchError);
      else setTagResults(items || []);
    }, 250);
    return () => clearTimeout(tagDebounce.current);
  }, [tagPoint, tagQuery, tenantId]);

  const placeTagAt = (e) => {
    if (!tagMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTagPoint({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
    setTagQuery('');
    setTagResults([]);
  };
  const saveTag = async (item) => {
    const point = tagPoint;
    setTagMode(false); setTagPoint(null); setTagQuery(''); setTagResults([]);
    const ok = await write('photos', (arr) => arr.map((p) => (p.id === lightbox.id
      ? { ...p, tags: [...(p.tags || []), { id: crypto.randomUUID(), x: point.x, y: point.y, item_id: item.id, label: item.name }] }
      : p)));
    if (ok) setLightbox((prev) => (prev ? { ...prev, tags: [...(prev.tags || []), { x: point.x, y: point.y, item_id: item.id, label: item.name }] } : prev));
  };
  const removeTag = async (tagId) => {
    setOpenTagId(null);
    const ok = await write('photos', (arr) => arr.map((p) => (p.id === lightbox.id
      ? { ...p, tags: (p.tags || []).filter((t) => t.id !== tagId) }
      : p)));
    if (ok) setLightbox((prev) => (prev ? { ...prev, tags: (prev.tags || []).filter((t) => t.id !== tagId) } : prev));
  };
  // The lightbox mirrors the saved photo — keep tags fresh from detail.
  const lightboxPhoto = lightbox ? (photos.find((p) => p.id === lightbox.id) || lightbox) : null;
  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const addPhotos = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    setError(null);
    setUploadingCount((n) => n + list.length);
    for (const file of list) {
      const photoId = crypto.randomUUID();
      const { path, error: upError } = await uploadHotspotPhoto({
        tenantId, hotspotId: hotspot.id, photoId, file,
      });
      if (upError) { setError(upError); setUploadingCount((n) => n - 1); continue; }
      const ok = await write('photos', (arr) => [...arr, {
        id: photoId, path, caption: null, created_at: new Date().toISOString(), created_by: user?.id ?? null,
      }]);
      if (!ok) {
        // Row write failed — the object must not orphan.
        const { error: rmError } = await supabase.storage.from('vessel-scans').remove([path]);
        if (rmError) console.error('[pin-photos] orphan cleanup error:', rmError);
      }
      setUploadingCount((n) => n - 1);
    }
  };

  const saveCaption = async (photo, caption) => {
    const text = caption.trim() || null;
    if ((photo.caption || null) === text) return;
    await write('photos', (arr) => arr.map((p) => (p.id === photo.id ? { ...p, caption: text } : p)));
    setLightbox((prev) => (prev && prev.id === photo.id ? { ...prev, caption: text } : prev));
  };

  const removePhoto = async (photo) => {
    // Row first; the storage object goes only after the row is confirmed.
    const ok = await write('photos', (arr) => arr.filter((p) => p.id !== photo.id));
    if (!ok) return;
    setLightbox(null);
    setConfirmingRemove(false);
    const { error: rmError } = await supabase.storage.from('vessel-scans').remove([photo.path]);
    if (rmError) console.error('[pin-photos] photo object cleanup error:', rmError); // non-fatal
  };

  if (!hotspot) return null;

  return (
    <div className="vm-payload">
      {tab === 'notes' && (
        <>
          {canManage && (
            <div className="vm-note-composer">
              <textarea
                ref={noteRef}
                className="vm-note-input"
                rows={2}
                placeholder="Add a note for the crew…"
                value={noteDraft}
                onChange={(e) => {
                  setNoteDraft(e.target.value);
                  const el = noteRef.current;
                  if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
                }}
              />
              <button className="vm-btn-primary vm-note-add" onClick={addNote} disabled={!noteDraft.trim()}>
                Add note
              </button>
            </div>
          )}
          {notes.length === 0 && <p className="vm-payload-empty">No notes yet.</p>}
          {notes.map((n) => (
            <div key={n.id} className="vm-note">
              <p className="vm-note-head">
                <span className="vm-note-author">{nameOf(n.created_by)}</span>
                <span className="vm-note-when">{relDate(n.created_at)}</span>
                {canDeleteNote(n) && (
                  <button className="vm-note-del" onClick={() => deleteNote(n.id)} aria-label="Delete note">×</button>
                )}
              </p>
              <p className="vm-note-text">{n.text}</p>
            </div>
          ))}
        </>
      )}

      {tab === 'list' && (
        <>
          {checklist.length > 0 && (
            <div className="vm-check-head">
              <p className="vm-check-progress">{doneCount} of {checklist.length} done</p>
              {canManage && doneCount > 0 && (
                confirmingReset ? (
                  <span className="vm-check-reset-confirm">
                    <button className="vm-check-reset vm-check-reset-armed" onClick={resetList}>Confirm reset</button>
                    <button className="vm-check-reset" onClick={() => setConfirmingReset(false)}>Keep</button>
                  </span>
                ) : (
                  <button className="vm-check-reset" onClick={() => setConfirmingReset(true)}>Reset list</button>
                )
              )}
            </div>
          )}
          {lastRun && (
            <p className="vm-check-lastrun">
              Last reset {relDate(lastRun.reset_at)} by {nameOf(lastRun.reset_by).split(/\s+/)[0]} · {lastRun.done_count} of {lastRun.total} were done
            </p>
          )}
          {canManage && (
            <input
              className="vm-check-input"
              placeholder="Add an item and press Enter…"
              value={checkDraft}
              onChange={(e) => setCheckDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCheck(); }}
            />
          )}
          {checklist.length === 0 && <p className="vm-payload-empty">Nothing on the list.</p>}
          <div className="vm-check-items">
            {viewChecklist.map((c) => (
              <div
                key={c.id}
                className={[
                  'vm-check-item',
                  c.done ? 'vm-check-done' : '',
                  dragCheck === c.id ? 'vm-check-dragging' : '',
                  dropMark?.id === c.id ? (dropMark.after ? 'vm-drop-after' : 'vm-drop-before') : '',
                ].filter(Boolean).join(' ')}
                draggable={canManage && !c.done}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.id);
                  setDragCheck(c.id);
                }}
                onDragOver={(e) => {
                  if (!dragCheck || c.done) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  setDropMark((m) => (m?.id === c.id && m.after === after ? m : { id: c.id, after }));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCheck && !c.done) {
                    reorderCheck(dragCheck, c.id, dropMark?.id === c.id ? dropMark.after : false);
                  }
                  setDragCheck(null);
                  setDropMark(null);
                }}
                onDragEnd={() => { setDragCheck(null); setDropMark(null); }}
              >
                {canManage && !c.done && (
                  <span className="vm-check-grip" aria-hidden="true">
                    <svg viewBox="0 0 6 14" width="6" height="14">
                      <g fill="currentColor">
                        <circle cx="1.5" cy="2" r="1.2" /><circle cx="4.5" cy="2" r="1.2" />
                        <circle cx="1.5" cy="7" r="1.2" /><circle cx="4.5" cy="7" r="1.2" />
                        <circle cx="1.5" cy="12" r="1.2" /><circle cx="4.5" cy="12" r="1.2" />
                      </g>
                    </svg>
                  </span>
                )}
                <button
                  className="vm-check-box"
                  role="checkbox"
                  aria-checked={c.done}
                  aria-label={c.text}
                  onClick={() => canManage && toggleCheck(c)}
                  disabled={!canManage}
                >
                  {c.done && (
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2.5 6.2 5 8.7 9.5 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span className="vm-check-text">{c.text}</span>
                {c.done && c.done_by && <span className="vm-check-by">{nameOf(c.done_by).split(/\s+/)[0]}</span>}
                {canManage && !c.done && (
                  <span className="vm-check-move">
                    <button className="vm-check-arrow" onClick={() => moveCheck(c.id, -1)} aria-label={`Move ${c.text} up`}>↑</button>
                    <button className="vm-check-arrow" onClick={() => moveCheck(c.id, 1)} aria-label={`Move ${c.text} down`}>↓</button>
                  </span>
                )}
                {canManage && (
                  <button className="vm-check-del" onClick={() => deleteCheck(c.id)} aria-label={`Delete ${c.text}`}>×</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'photos' && (
        <>
          {photos.length === 0 && uploadingCount === 0 && <p className="vm-payload-empty">No photos yet.</p>}
          <div className="vm-photo-grid">
            {canManage && (
              <label className="vm-photo-add" aria-label="Add photos">
                +
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
                />
              </label>
            )}
            {Array.from({ length: uploadingCount }).map((_, i) => (
              <div key={`up-${i}`} className="vm-photo-tile vm-photo-uploading" aria-label="Uploading photo" />
            ))}
            {[...photos].reverse().map((p) => (
              <button key={p.id} className="vm-photo-tile" onClick={() => { setLightbox(p); setCaptionDraft(p.caption || ''); setConfirmingRemove(false); }} aria-label={p.caption || 'Photo'}>
                {photoUrls[p.path] && <img src={photoUrls[p.path]} alt={p.caption || ''} loading="lazy" />}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="vm-payload-error">{error}</p>}

      {lightbox && createPortal(
        <div className="vm-lightbox" onClick={() => setLightbox(null)}>
          <div className="vm-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button className="vm-lightbox-x" onClick={() => setLightbox(null)} aria-label="Close photo">×</button>
            <div
              className={`vm-lightbox-imgwrap${tagMode ? ' vm-tagging' : ''}`}
              onClick={placeTagAt}
            >
              {photoUrls[lightbox.path] && <img src={photoUrls[lightbox.path]} alt={lightbox.caption || ''} draggable="false" />}
              {(lightboxPhoto?.tags || []).map((t) => (
                <button
                  key={t.id}
                  className={`vm-photo-tag${openTagId === t.id ? ' vm-photo-tag-open' : ''}`}
                  style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                  onClick={(e) => { e.stopPropagation(); setOpenTagId(openTagId === t.id ? null : t.id); }}
                  aria-label={t.label}
                />
              ))}
              {tagPoint && <span className="vm-photo-tag vm-photo-tag-pending" style={{ left: `${tagPoint.x * 100}%`, top: `${tagPoint.y * 100}%` }} />}
            </div>
            {openTagId && (() => {
              const t = (lightboxPhoto?.tags || []).find((x) => x.id === openTagId);
              if (!t) return null;
              return (
                <div className="vm-tag-chip">
                  <span className="vm-tag-chip-label">{t.label}</span>
                  {tagQtys[t.item_id] && (qtyEdit?.itemId === t.item_id ? (
                    <span className="vm-tag-qty-edit">
                      <input
                        className="vm-tag-qty-input"
                        type="number"
                        min="0"
                        value={qtyEdit.value}
                        onChange={(e) => setQtyEdit({ itemId: t.item_id, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveQty(t); }}
                        autoFocus
                        disabled={qtySaving}
                        aria-label={`How many ${t.label} here`}
                      />
                      <button className="vm-tag-qty-save" onClick={() => saveQty(t)} disabled={qtySaving}>
                        {qtySaving ? '…' : 'Set'}
                      </button>
                      <button className="vm-tag-qty-cancel" onClick={() => { setQtyEdit(null); setQtyError(null); }} disabled={qtySaving}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    canManage ? (
                      <button
                        className="vm-tag-chip-qty vm-tag-chip-qty-btn"
                        title="Set how many are here"
                        onClick={() => setQtyEdit({ itemId: t.item_id, value: String(tagQtys[t.item_id].qty) })}
                      >
                        {tagQtys[t.item_id].qty}{tagQtys[t.item_id].unit ? ` ${tagQtys[t.item_id].unit}` : ''} {tagQtys[t.item_id].where}
                      </button>
                    ) : (
                      <span className="vm-tag-chip-qty">
                        {tagQtys[t.item_id].qty}{tagQtys[t.item_id].unit ? ` ${tagQtys[t.item_id].unit}` : ''} {tagQtys[t.item_id].where}
                      </span>
                    )
                  ))}
                  <button className="vm-tag-chip-go" onClick={() => navigate(`/inventory/item/${t.item_id}`)}>
                    View in inventory →
                  </button>
                  {canManage && (
                    <button className="vm-tag-chip-del" onClick={() => removeTag(t.id)} aria-label={`Remove tag ${t.label}`}>×</button>
                  )}
                  {qtyError && <span className="vm-tag-qty-error">{qtyError}</span>}
                </div>
              );
            })()}
            {canManage && !tagPoint && (
              <button
                className={`vm-tag-toggle${tagMode ? ' vm-tag-toggle-on' : ''}`}
                onClick={() => { setTagMode((v) => !v); setOpenTagId(null); }}
              >
                {tagMode ? 'Tap the item in the photo…' : '◎ Tag an item'}
              </button>
            )}
            {tagPoint && (
              <div className="vm-tag-search">
                <input
                  className="vm-check-input"
                  placeholder="Search inventory — “napkin rings”…"
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  autoFocus
                />
                {tagResults.map((i) => (
                  <button key={i.id} className="vm-cupboard-result" onClick={() => saveTag(i)}>
                    {i.name}{i.quantity != null ? ` · ${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : ''}
                  </button>
                ))}
                <button className="vm-cupboard-cancel" onClick={() => { setTagPoint(null); setTagMode(false); }}>Cancel</button>
              </div>
            )}
            <div className="vm-lightbox-bar">
              {canManage ? (
                <input
                  className="vm-lightbox-caption"
                  placeholder="Add a caption…"
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  onBlur={() => saveCaption(lightbox, captionDraft)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                />
              ) : (
                lightbox.caption && <p className="vm-lightbox-caption-read">{lightbox.caption}</p>
              )}
              <p className="vm-lightbox-meta">{nameOf(lightbox.created_by)} · {relDate(lightbox.created_at)}</p>
              {canManage && (
                confirmingRemove ? (
                  <div className="vm-lightbox-confirm">
                    <button className="vm-lightbox-del vm-lightbox-del-armed" onClick={() => removePhoto(lightbox)}>Confirm remove</button>
                    <button className="vm-lightbox-keep" onClick={() => setConfirmingRemove(false)}>Keep</button>
                  </div>
                ) : (
                  <button className="vm-lightbox-del" onClick={() => setConfirmingRemove(true)}>Remove photo</button>
                )
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
