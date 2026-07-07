// Manage scans — the vessel map's back-of-house. COMMAND/CHIEF upload, name,
// orient and maintain vessel scans with zero founder involvement: the crew
// instruction is one line — "Scaniverse → Share → export SPZ → drop it here."
//
// Upload flow: file → name/deck → row created FIRST (status 'uploading',
// path constructed from the row id — the user never sees or types a path) →
// TUS resumable upload with real byte progress → row finalised 'ready' →
// straight into the orient step → view on map. Failures leave the row
// marked incomplete with retry/discard affordances; nothing orphans.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Header from '../../components/navigation/Header';
import SplatViewer from './components/SplatViewer';
import OrientPanel from './components/OrientPanel';
import GuideCards from './components/GuideCards';
import { refreshScanThumb } from './utils/scanThumb';
import { SCAN_EXTENSIONS, validateScanFile, fileExtension, createScanUpload } from './utils/scanUpload';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';

const VM_STAGE = '#22253F';

// Deck ordering: top of the vessel downward where names match convention,
// alphabetical otherwise, unassigned last. A rank helper, nothing cleverer.
const DECK_KEYWORDS = ['sun', 'bridge', 'main', 'lower', 'tank'];
const deckRank = (deck) => {
  const d = (deck || '').toLowerCase();
  const i = DECK_KEYWORDS.findIndex((k) => d.includes(k));
  return i === -1 ? DECK_KEYWORDS.length : i;
};

// Reel order: the carousel travels down the vessel — decks in vessel order
// (unassigned last), then the row order (sort_order, created_at) within.
const reelOrder = (scans) => [...scans].sort((a, b) => {
  const ad = (a.deck || '').trim(); const bd = (b.deck || '').trim();
  if (!ad !== !bd) return ad ? -1 : 1;
  if (ad && bd) {
    const r = deckRank(ad) - deckRank(bd);
    if (r !== 0) return r;
    const alpha = ad.toLowerCase().localeCompare(bd.toLowerCase());
    if (alpha !== 0) return alpha;
  }
  const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (so !== 0) return so;
  return String(a.created_at).localeCompare(String(b.created_at));
});

const isZeroRotation = (r) => !r || ((Number(r.x) || 0) === 0 && (Number(r.y) || 0) === 0 && (Number(r.z) || 0) === 0);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtSize = (bytes) => (bytes == null ? '—' : `${(bytes / (1024 * 1024)).toFixed(1)}MB`);

export default function ManageScans() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  // Deep-link from Location Management: /vessel/map/manage?space={id}&name={room}
  // opens the upload form pre-filled and binds the new scan to that Space.
  const [linkSpaceId, setLinkSpaceId] = useState(null);

  const [scans, setScans] = useState([]);
  const [pinCounts, setPinCounts] = useState({});
  const [storageSizes, setStorageSizes] = useState({}); // legacy rows without file_bytes
  const [thumbUrls, setThumbUrls] = useState({});       // scan_id → signed poster URL
  const [loading, setLoading] = useState(true);

  // Upload flow: idle → form → uploading → orient → done (error is a state
  // of 'uploading' with a message, not a dead end).
  const [step, setStep] = useState('idle');
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [deck, setDeck] = useState('');
  const [fileError, setFileError] = useState(null);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [uploadError, setUploadError] = useState(null);
  const [uploadPermanent, setUploadPermanent] = useState(false); // server refusal — retry can't succeed
  const [uploadedScan, setUploadedScan] = useState(null);
  const [orientUrl, setOrientUrl] = useState(null);
  const [orientDraft, setOrientDraft] = useState({ x: 0, y: 0, z: 0 });
  const [orientSaving, setOrientSaving] = useState(false);
  const [orientError, setOrientError] = useState(null);
  const activeUploadRef = useRef(null);
  const viewerApiRef = useRef(null); // orient-step SplatViewer — poster capture
  const [dragOver, setDragOver] = useState(false);

  // Consume the ?space=&name= handoff once: bind the space and open the form.
  useEffect(() => {
    const space = searchParams.get('space');
    if (!space) return;
    setLinkSpaceId(space);
    const roomName = searchParams.get('name');
    if (roomName) setName(roomName);
    setStep('form');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Crews who've done this many times can fold the three cards away.
  const [stepsHidden, setStepsHiddenState] = useState(() => {
    try { return localStorage.getItem('cargo-vmm-steps-hidden') === '1'; } catch { return false; }
  });
  const setStepsHidden = (hidden) => {
    setStepsHiddenState(hidden);
    try { localStorage.setItem('cargo-vmm-steps-hidden', hidden ? '1' : '0'); } catch { /* preference only */ }
  };

  // The reel: active scan tracked by id so uploads/deletes/re-sorts follow it.
  const [reelActiveId, setReelActiveId] = useState(null);
  const reelDragRef = useRef({ start: null, dragged: false });
  const reelWheelRef = useRef(0);

  // Per-row: edits, replace/complete transfer state, delete modal.
  const [editingId, setEditingId] = useState(null); // row in edit mode
  const [rowEdits, setRowEdits] = useState({});
  const [rowBusy, setRowBusy] = useState({});   // id → {progress?, error?, label}
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const replaceInputRef = useRef(null);
  const replaceRowRef = useRef(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!activeTenantId) return;
    const [scansRes, pinsRes, listRes] = await Promise.all([
      supabase.from('vessel_scans').select('*').eq('tenant_id', activeTenantId)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('scan_hotspots').select('id, scan_id').eq('tenant_id', activeTenantId),
      supabase.storage.from('vessel-scans').list(activeTenantId, { limit: 200 }),
    ]);
    if (scansRes.error) console.error('[manage-scans] scans fetch error:', scansRes.error);
    else {
      const rows = scansRes.data || [];
      setScans(rows);
      // Poster thumbs: one batch of signed URLs per load, cached by scan id.
      const withThumbs = rows.filter((r) => r.thumb_path);
      if (withThumbs.length > 0) {
        const { data: signed, error: signError } = await supabase.storage
          .from('vessel-scans')
          .createSignedUrls(withThumbs.map((r) => r.thumb_path), 3600);
        if (signError) console.error('[manage-scans] thumb sign error:', signError);
        else {
          const byPath = Object.fromEntries((signed || []).map((s) => [s.path, s.signedUrl]));
          setThumbUrls(Object.fromEntries(withThumbs.map((r) => [r.id, byPath[r.thumb_path]]).filter(([, u]) => u)));
        }
      } else {
        setThumbUrls({});
      }
    }
    if (pinsRes.error) console.error('[manage-scans] pins fetch error:', pinsRes.error);
    else {
      const counts = {};
      for (const h of pinsRes.data || []) counts[h.scan_id] = (counts[h.scan_id] || 0) + 1;
      setPinCounts(counts);
    }
    if (listRes.error) console.error('[manage-scans] storage list error:', listRes.error);
    else {
      const sizes = {};
      for (const obj of listRes.data || []) sizes[`${activeTenantId}/${obj.name}`] = obj.metadata?.size;
      setStorageSizes(sizes);
    }
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Abandoning mid-upload: stop the transfer. The row stays 'uploading' and
  // surfaces as incomplete with retry/discard next visit — never orphaned.
  useEffect(() => () => activeUploadRef.current?.abort?.(), []);

  const reel = useMemo(() => reelOrder(scans), [scans]);
  const reelIdx = useMemo(() => {
    const i = reel.findIndex((s) => s.id === reelActiveId);
    return i === -1 ? 0 : i;
  }, [reel, reelActiveId]);
  const reelGo = useCallback((n) => {
    const clamped = Math.max(0, Math.min(reel.length - 1, n));
    if (reel[clamped]) setReelActiveId(reel[clamped].id);
  }, [reel]);

  const nextSortOrder = useMemo(
    () => scans.reduce((m, s) => Math.max(m, s.sort_order ?? 0), 0) + 1,
    [scans]
  );

  // ── Upload flow ──────────────────────────────────────────────────────────
  const acceptFile = (f) => {
    if (!f) return;
    const problem = validateScanFile(f);
    if (problem) { setFileError(problem); return; }
    setFileError(null);
    setFile(f);
    setName((prev) => prev || f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    setStep('form');
  };

  const runTransfer = async (path, f) => {
    setProgress({ sent: 0, total: f.size });
    const upload = await createScanUpload({
      path,
      file: f,
      onProgress: (sent, total) => setProgress({ sent, total }),
    });
    activeUploadRef.current = upload;
    await upload.promise;
    activeUploadRef.current = null;
  };

  const beginUpload = async () => {
    if (!file || !name.trim()) return;
    const id = crypto.randomUUID();
    const ext = fileExtension(file.name);
    const path = `${activeTenantId}/${id}.${ext}`;
    setUploadError(null);
    setUploadPermanent(false);
    setStep('uploading');

    const { data: row, error: insertError } = await supabase
      .from('vessel_scans')
      .insert({
        id,
        tenant_id: activeTenantId,
        name: name.trim(),
        deck: deck.trim() || null,
        space_id: linkSpaceId || null,
        storage_path: path,
        file_format: ext,
        status: 'uploading',
        sort_order: nextSortOrder,
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (insertError) {
      console.error('[manage-scans] row create error:', insertError);
      setUploadError(insertError.message || 'Could not register the scan.');
      setStep('form');
      return;
    }

    try {
      await runTransfer(path, file);
    } catch (err) {
      console.error('[manage-scans] upload failed:', err);
      setUploadError(err.friendly || 'The upload didn’t finish — check the connection and retry. It resumes where it left off.');
      setUploadPermanent(Boolean(err.permanent));
      setUploadedScan(row);
      return; // row stays 'uploading'; Retry/Discard render below
    }

    const { error: finaliseError } = await supabase
      .from('vessel_scans')
      .update({ status: 'ready', file_bytes: file.size })
      .in('id', [id]);
    if (finaliseError) {
      console.error('[manage-scans] finalise error:', finaliseError);
      setUploadError(finaliseError.message || 'Uploaded, but could not finalise the scan.');
      setUploadedScan(row);
      return;
    }

    const ready = { ...row, status: 'ready', file_bytes: file.size };
    setUploadedScan(ready);
    setOrientDraft({ x: 0, y: 0, z: 0 });
    setOrientError(null);
    const { data: signed, error: signError } = await supabase.storage
      .from('vessel-scans').createSignedUrl(path, 3600);
    if (signError) console.error('[manage-scans] orient sign error:', signError);
    setOrientUrl(signed?.signedUrl || null);
    setStep('orient');
    loadAll();
  };

  const retryUpload = async () => {
    if (!file || !uploadedScan) return;
    setUploadError(null);
    setUploadPermanent(false);
    setStep('uploading');
    try {
      await runTransfer(uploadedScan.storage_path, file);
    } catch (err) {
      console.error('[manage-scans] retry failed:', err);
      setUploadError(err.friendly || 'Still no luck — the next retry resumes from the same point.');
      setUploadPermanent(Boolean(err.permanent));
      return;
    }
    const { error } = await supabase.from('vessel_scans')
      .update({ status: 'ready', file_bytes: file.size }).in('id', [uploadedScan.id]);
    if (error) {
      console.error('[manage-scans] finalise error:', error);
      setUploadError(error.message || 'Uploaded, but could not finalise the scan.');
      return;
    }
    const { data: signed } = await supabase.storage
      .from('vessel-scans').createSignedUrl(uploadedScan.storage_path, 3600);
    setOrientUrl(signed?.signedUrl || null);
    setOrientDraft({ x: 0, y: 0, z: 0 });
    setStep('orient');
    loadAll();
  };

  const discardUpload = async () => {
    if (uploadedScan) {
      const { error } = await supabase.from('vessel_scans').delete().eq('id', uploadedScan.id);
      if (error) console.error('[manage-scans] discard row error:', error);
      const { error: rmError } = await supabase.storage.from('vessel-scans').remove([uploadedScan.storage_path]);
      if (rmError) console.error('[manage-scans] discard file cleanup:', rmError);
    }
    resetFlow();
    loadAll();
  };

  const resetFlow = () => {
    activeUploadRef.current?.abort?.();
    activeUploadRef.current = null;
    setStep('idle');
    setFile(null);
    setName('');
    setDeck('');
    setFileError(null);
    setUploadError(null);
    setUploadPermanent(false);
    setUploadedScan(null);
    setOrientUrl(null);
  };

  // Any orient approval refreshes the poster frame — "Save orientation" and
  // "Looks right as is" both count: the frame the user signs off is the thumb.
  const captureAndStoreThumb = async (scan) => {
    let blob = null;
    try {
      blob = await viewerApiRef.current?.captureFrame?.();
    } catch (err) {
      console.error('[manage-scans] thumb capture error:', err);
    }
    if (!blob) return;
    await refreshScanThumb({ scan, tenantId: activeTenantId, blob });
  };

  const saveOrientation = async () => {
    setOrientSaving(true);
    setOrientError(null);
    // Capture while the viewer is still mounted and showing the approved frame.
    const thumbPromise = captureAndStoreThumb(uploadedScan);
    const { error } = await supabase.from('vessel_scans')
      .update({ splat_rotation: orientDraft }).in('id', [uploadedScan.id]);
    setOrientSaving(false);
    if (error) {
      console.error('[manage-scans] orientation save error:', error);
      setOrientError(error.message || 'Could not save the orientation.');
      return;
    }
    await thumbPromise;
    setStep('done');
    loadAll();
  };

  const approveAsIs = async () => {
    await captureAndStoreThumb(uploadedScan);
    setStep('done');
    loadAll();
  };

  // ── Per-row actions ──────────────────────────────────────────────────────
  const editValue = (s, field) => rowEdits[s.id]?.[field] ?? s[field] ?? '';
  const setEdit = (id, field, value) =>
    setRowEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  const rowDirty = (s) => {
    const e = rowEdits[s.id];
    if (!e) return false;
    return ['name', 'deck', 'sort_order'].some((f) => e[f] !== undefined && String(e[f]) !== String(s[f] ?? ''));
  };
  const saveRow = async (s) => {
    const e = rowEdits[s.id] || {};
    const patch = {};
    if (e.name !== undefined) patch.name = String(e.name).trim() || s.name;
    if (e.deck !== undefined) patch.deck = String(e.deck).trim() || null;
    if (e.sort_order !== undefined) patch.sort_order = Number(e.sort_order) || 0;
    const { error } = await supabase.from('vessel_scans').update(patch).in('id', [s.id]);
    if (error) {
      console.error('[manage-scans] row update error:', error);
      setRowBusy((p) => ({ ...p, [s.id]: { error: error.message || 'Could not save changes.' } }));
      return;
    }
    setRowEdits((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
    setRowBusy((p) => { const next = { ...p }; delete next[s.id]; return next; });
    setEditingId(null);
    loadAll();
  };
  const cancelEdit = (id) => {
    setRowEdits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setRowBusy((p) => { const next = { ...p }; delete next[id]; return next; });
    setEditingId(null);
  };

  // Replace file / complete an incomplete upload — same transfer, one rule:
  // the old file is removed only after the new one is confirmed live.
  const pickReplacement = (s) => {
    replaceRowRef.current = s;
    replaceInputRef.current?.click();
  };
  const onReplacementPicked = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const s = replaceRowRef.current;
    if (!f || !s) return;
    const problem = validateScanFile(f);
    if (problem) { setRowBusy((p) => ({ ...p, [s.id]: { error: problem } })); return; }

    const ext = fileExtension(f.name);
    const newPath = `${activeTenantId}/${s.id}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const oldPath = s.storage_path;
    setRowBusy((p) => ({ ...p, [s.id]: { progress: { sent: 0, total: f.size }, label: 'Uploading' } }));
    try {
      const upload = await createScanUpload({
        path: newPath,
        file: f,
        onProgress: (sent, total) => setRowBusy((p) => ({ ...p, [s.id]: { progress: { sent, total }, label: 'Uploading' } })),
      });
      activeUploadRef.current = upload;
      await upload.promise;
      activeUploadRef.current = null;
    } catch (err) {
      console.error('[manage-scans] replace upload failed:', err);
      setRowBusy((p) => ({ ...p, [s.id]: { error: err.friendly || 'The upload didn’t finish — retry with the same file to resume.' } }));
      return;
    }

    // A new capture means the old poster is a different room — clear it; the
    // post-replace orient regenerates it.
    const { error } = await supabase.from('vessel_scans')
      .update({ storage_path: newPath, file_format: ext, file_bytes: f.size, status: 'ready', thumb_path: null })
      .in('id', [s.id]);
    if (error) {
      console.error('[manage-scans] replace finalise error:', error);
      setRowBusy((p) => ({ ...p, [s.id]: { error: error.message || 'Uploaded, but could not switch the scan over.' } }));
      return;
    }
    // Only now are the old objects expendable.
    const stale = [oldPath, s.thumb_path].filter((p) => p && p !== newPath);
    if (stale.length > 0) {
      const { error: rmError } = await supabase.storage.from('vessel-scans').remove(stale);
      if (rmError) console.error('[manage-scans] old file cleanup failed (non-fatal):', rmError);
    }
    setRowBusy((p) => { const next = { ...p }; delete next[s.id]; return next; });
    loadAll();
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const { error } = await supabase.from('vessel_scans').delete().eq('id', deleteTarget.id);
    if (error) {
      console.error('[manage-scans] delete error:', error);
      setDeleteError(error.message || 'Could not delete the scan.');
      setDeleteBusy(false);
      return;
    }
    const { error: rmError } = await supabase.storage.from('vessel-scans')
      .remove([deleteTarget.storage_path, deleteTarget.thumb_path].filter(Boolean));
    if (rmError) console.error('[manage-scans] file cleanup failed (non-fatal):', rmError);
    setDeleteBusy(false);
    setDeleteTarget(null);
    loadAll();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const pct = progress.total ? Math.round((progress.sent / progress.total) * 100) : 0;

  return (
    <>
      <Header />
      <div className="editorial-page pv-dashboard vm-page vmm-page" style={{ '--vm-stage': VM_STAGE }}>
        <div className="vm-shell">
          <button className="vmm-back" onClick={() => navigate('/vessel/map')}>← Back to the map</button>

          <div className="vm-headblock">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Vessel Map</span>
              <span className="bar" />
              <span className="muted">Manage scans</span>
              {!loading && (
                <>
                  <span className="bar" />
                  <span className="muted">{scans.length} scan{scans.length === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting">
              THE SCANS<span className="period">,</span> <em>kept shipshape</em><span className="period">.</span>
            </h1>
          </div>

          {/* ── Upload surface: the three cards ARE the uploader. Whole area
                 is a drop target; the navy CTA opens the device picker. ── */}
          {step === 'idle' && (
            <div
              className={`vmm-uploader${dragOver ? ' vmm-uploader-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
            >
              {stepsHidden ? (
                <div className="vmm-compact">
                  <p className="vmm-compact-line">
                    Scan with your phone, export <strong>SPZ</strong>, drop it here — or
                  </p>
                  <label className="vm-btn-primary">
                    Upload your scan
                    <input
                      type="file"
                      accept={SCAN_EXTENSIONS.map((e) => `.${e}`).join(',')}
                      style={{ display: 'none' }}
                      onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </label>
                  <button className="vmm-steps-toggle" onClick={() => setStepsHidden(false)}>Show the steps</button>
                </div>
              ) : (
                <>
                  <GuideCards onFile={acceptFile} />
                  <div className="vmm-under-cards">
                    <button className="vmm-steps-toggle" onClick={() => setStepsHidden(true)}>Done this before? Hide the steps</button>
                  </div>
                </>
              )}
              {fileError && <p className="vmm-error">{fileError}</p>}
            </div>
          )}

          {step === 'form' && (
            <div className="vmm-panel">
              <p className="vm-label">New scan <span className="vmm-file-chip">{file?.name} · {fmtSize(file?.size)}</span></p>
              <div className="vmm-form-row">
                <div className="vmm-field">
                  <p className="vm-label">Name <span className="vm-label-required">required</span></p>
                  <input className="vm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Galley" autoFocus />
                </div>
                <div className="vmm-field">
                  <p className="vm-label">Deck <span className="vmm-label-optional">optional</span></p>
                  <input className="vm-input" value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="Main deck" />
                </div>
              </div>
              {uploadError && <p className="vmm-error">{uploadError}</p>}
              <div className="vmm-actions">
                <button className="vm-btn-primary" onClick={beginUpload} disabled={!name.trim()}>Upload scan</button>
                <button className="vm-btn-ghost" onClick={resetFlow}>Cancel</button>
              </div>
            </div>
          )}

          {step === 'uploading' && (
            <div className="vmm-panel">
              <p className="vm-label">Uploading {name}</p>
              {!uploadError ? (
                <>
                  <div className="vmm-progress-track">
                    <div className="vmm-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="vmm-progress-label">{fmtSize(progress.sent)} of {fmtSize(progress.total)} · {pct}%</p>
                </>
              ) : (
                <>
                  <p className="vmm-error">{uploadError}</p>
                  <div className="vmm-actions">
                    {!uploadPermanent && (
                      <button className="vm-btn-primary" onClick={retryUpload}>Retry upload</button>
                    )}
                    <button className={uploadPermanent ? 'vm-btn-primary' : 'vm-btn-ghost'} onClick={discardUpload}>Discard</button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 'orient' && uploadedScan && (
            <div className="vmm-panel">
              <p className="vm-label">Stand it upright</p>
              <p className="vmm-note">Rotate until the room stands as it does aboard, then save.</p>
              <div className="vmm-stage">
                {orientUrl && (
                  <SplatViewer
                    signedUrl={orientUrl}
                    fileName={uploadedScan.storage_path.split('/').pop()}
                    cameraPosition={uploadedScan.camera_position}
                    cameraTarget={uploadedScan.camera_target}
                    splatRotation={orientDraft}
                    splatScale={uploadedScan.splat_scale}
                    hotspots={[]}
                    visibleLayers={[]}
                    selectedId={null}
                    placementMode={false}
                    pendingPosition={null}
                    onPlacePending={() => {}}
                    onSelectHotspot={() => {}}
                    onHoverHotspot={() => {}}
                    onLoadState={() => {}}
                    apiRef={viewerApiRef}
                    stageColor={VM_STAGE}
                  />
                )}
                <OrientPanel
                  value={orientDraft}
                  onChange={(next) => { setOrientError(null); setOrientDraft(next); }}
                  onSave={saveOrientation}
                  onCancel={approveAsIs}
                  saving={orientSaving}
                  error={orientError}
                  eyebrow="Stand it upright"
                  saveLabel="Save orientation"
                  cancelLabel="Looks right as is"
                />
              </div>
            </div>
          )}

          {step === 'done' && uploadedScan && (
            <div className="vmm-panel vmm-done">
              <p className="vmm-done-title">“{uploadedScan.name}” is aboard.</p>
              <div className="vmm-actions">
                <button className="vm-btn-primary" onClick={() => navigate('/vessel/map')}>View on map</button>
                <button className="vm-btn-ghost" onClick={resetFlow}>Upload another</button>
              </div>
            </div>
          )}

          {/* ── The library: the fleet as a coverflow reel — centre room
                 prominent, neighbours collapsed behind. Travels down the
                 vessel: decks in vessel order, unassigned last. ── */}
          {!loading && reel.length > 0 && (() => {
            const active = reel[reelIdx];
            const busy = rowBusy[active.id];
            const incomplete = active.status !== 'ready';
            const editing = editingId === active.id;
            const pins = pinCounts[active.id] || 0;
            const hints = [
              !(active.deck || '').trim() && 'No deck',
              !active.thumb_path && isZeroRotation(active.splat_rotation) && 'Not oriented yet',
            ].filter(Boolean);
            const onReelWheel = (e) => {
              // Horizontal gestures only — vertical wheel keeps scrolling the page.
              if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
              e.preventDefault();
              const now = performance.now();
              if (now - reelWheelRef.current < 320) return;
              if (Math.abs(e.deltaX) < 8) return;
              reelWheelRef.current = now;
              reelGo(reelIdx + (e.deltaX > 0 ? 1 : -1));
            };
            const onPointerDown = (e) => { reelDragRef.current = { start: e.clientX, dragged: false }; };
            const onPointerMove = (e) => {
              const d = reelDragRef.current;
              if (d.start !== null && Math.abs(e.clientX - d.start) > 12) d.dragged = true;
            };
            const onPointerUp = (e) => {
              const d = reelDragRef.current;
              if (d.start === null) return;
              const dx = e.clientX - d.start;
              reelDragRef.current = { start: null, dragged: d.dragged };
              if (Math.abs(dx) > 48) reelGo(reelIdx + (dx < 0 ? 1 : -1));
              setTimeout(() => { reelDragRef.current.dragged = false; }, 0);
            };
            return (
              <div className="vml">
                <div className="vml-head">
                  <span className="vml-label">Scans aboard · {reel.length}</span>
                </div>
                <div
                  className="vmr-stage"
                  role="listbox"
                  aria-label="Scans aboard"
                  onWheel={onReelWheel}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {reel.map((s, i) => {
                    const o = i - reelIdx;
                    if (Math.abs(o) > 3) return null;
                    return (
                      <button
                        key={s.id}
                        role="option"
                        aria-selected={o === 0}
                        aria-label={s.name}
                        className={`vmr-card${o === 0 ? ' vmr-centre' : ''}`}
                        style={{
                          transform: `translateX(${o * 200}px) translateZ(${-Math.abs(o) * 175}px) rotateY(${o === 0 ? 0 : o > 0 ? -26 : 26}deg)`,
                          zIndex: 100 - Math.abs(o),
                          opacity: Math.abs(o) === 3 ? 0.2 : 1,
                        }}
                        tabIndex={o === 0 ? 0 : -1}
                        onClick={() => { if (!reelDragRef.current.dragged) reelGo(i); }}
                      >
                        {thumbUrls[s.id] ? (
                          <img src={thumbUrls[s.id]} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <svg className="vmr-motif" viewBox="0 0 80 50" aria-hidden="true">
                            <g fill="#C65A1A">
                              <circle cx="30" cy="16" r="2" opacity="0.7" /><circle cx="44" cy="23" r="1.7" opacity="0.5" />
                              <circle cx="36" cy="31" r="1.8" opacity="0.55" /><circle cx="53" cy="16" r="1.4" opacity="0.4" />
                              <circle cx="50" cy="33" r="1.5" opacity="0.45" /><circle cx="24" cy="26" r="1.3" opacity="0.35" />
                            </g>
                            <g fill="#8FA0C6">
                              <circle cx="40" cy="12" r="1.1" opacity="0.4" /><circle cx="58" cy="26" r="1" opacity="0.3" />
                              <circle cx="28" cy="37" r="1" opacity="0.28" />
                            </g>
                          </svg>
                        )}
                        {(s.deck || '').trim() && <span className="vmr-deck-chip">{s.deck}</span>}
                        {s.status !== 'ready' && <span className="vmm-badge vmr-badge">Upload incomplete</span>}
                      </button>
                    );
                  })}
                  {reel.length > 1 && (
                    <>
                      <button className="vmr-arrow vmr-prev" onClick={() => reelGo(reelIdx - 1)} disabled={reelIdx === 0} aria-label="Previous scan">‹</button>
                      <button className="vmr-arrow vmr-next" onClick={() => reelGo(reelIdx + 1)} disabled={reelIdx === reel.length - 1} aria-label="Next scan">›</button>
                    </>
                  )}
                </div>

                <div className="vmr-caption">
                  <h3 className="vmr-name">{active.name}</h3>
                  <p className="vmr-meta">
                    {[active.deck, fmtSize(active.file_bytes ?? storageSizes[active.storage_path]), (active.file_format || '').toUpperCase(),
                      `${pins} pin${pins === 1 ? '' : 's'}`, fmtDate(active.created_at)].filter(Boolean).join(' · ')}
                    {hints.map((h) => <span key={h} className="vml-hint"> · {h}</span>)}
                  </p>
                  {!editing && (
                    <div className="vmr-actions">
                      <button className="vm-btn-primary vmm-btn-sm" onClick={() => navigate(`/vessel/map?scan=${active.id}`)} disabled={incomplete}>
                        View on map
                      </button>
                      <button className="vmc-action" onClick={() => setEditingId(active.id)}>Edit</button>
                      <button className="vmc-action" onClick={() => pickReplacement(active)}>
                        {incomplete ? 'Upload file' : 'Replace file'}
                      </button>
                      <button className="vmc-action vmc-action-danger" onClick={() => { setDeleteError(null); setDeleteTarget(active); }}>Delete</button>
                    </div>
                  )}
                  {editing && (
                    <div className="vmr-editor">
                      <div className="vmm-form-row">
                        <div className="vmm-field">
                          <p className="vm-label">Name</p>
                          <input className="vm-input" value={editValue(active, 'name')} onChange={(e) => setEdit(active.id, 'name', e.target.value)} aria-label="Scan name" autoFocus />
                        </div>
                        <div className="vmm-field">
                          <p className="vm-label">Deck <span className="vmm-label-optional">optional</span></p>
                          <input className="vm-input" value={editValue(active, 'deck')} onChange={(e) => setEdit(active.id, 'deck', e.target.value)} placeholder="Main deck" aria-label="Deck" />
                        </div>
                        <div className="vmm-field vml-field-order">
                          <p className="vm-label">Order</p>
                          <input className="vm-input" type="number" value={editValue(active, 'sort_order')} onChange={(e) => setEdit(active.id, 'sort_order', e.target.value)} aria-label="Sort order" />
                        </div>
                      </div>
                      <div className="vmm-actions vmr-editor-actions">
                        <button className="vm-btn-primary vmm-btn-sm" onClick={() => saveRow(active)} disabled={!rowDirty(active)}>Save changes</button>
                        <button className="vm-btn-ghost vmm-btn-sm" onClick={() => cancelEdit(active.id)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {busy?.progress && (
                    <div className="vmr-busy">
                      <div className="vmm-progress-track">
                        <div className="vmm-progress-fill" style={{ width: `${busy.progress.total ? Math.round((busy.progress.sent / busy.progress.total) * 100) : 0}%` }} />
                      </div>
                      <p className="vmm-progress-label">{busy.label} · {fmtSize(busy.progress.sent)} of {fmtSize(busy.progress.total)}</p>
                      <p className="vmm-note">Pins keep their positions — if the new capture's orientation differs, re-orient after upload.</p>
                    </div>
                  )}
                  {busy?.error && <p className="vmm-error vmr-busy">{busy.error}</p>}
                </div>

                {reel.length > 1 && (
                  <div className="vmr-dots" aria-hidden="true">
                    {reel.map((s, i) => (
                      <button key={s.id} className={`vmr-dot${i === reelIdx ? ' vmr-dot-on' : ''}`} onClick={() => reelGo(i)} tabIndex={-1} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {!loading && scans.length === 0 && step === 'idle' && (
            <p className="vmm-empty">No scans yet — the first one lands on the map the moment it uploads.</p>
          )}
        </div>
      </div>

      {/* Hidden picker for replace/complete flows */}
      <input
        ref={replaceInputRef}
        type="file"
        accept={SCAN_EXTENSIONS.map((e) => `.${e}`).join(',')}
        style={{ display: 'none' }}
        onChange={onReplacementPicked}
      />

      {deleteTarget && (
        <div className="vm-modal-overlay" onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="vm-modal" onClick={(e) => e.stopPropagation()}>
            <p className="vm-label">Delete scan</p>
            <p className="vmm-modal-body">
              Delete “{deleteTarget.name}”? This removes the scan and its{' '}
              <strong>{pinCounts[deleteTarget.id] || 0} pin{(pinCounts[deleteTarget.id] || 0) === 1 ? '' : 's'}</strong>.
              It can’t be undone.
            </p>
            {deleteError && <p className="vmm-error">{deleteError}</p>}
            <div className="vm-modal-actions">
              <button className="vm-btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Keep it</button>
              <button className="vm-btn-primary vmm-danger-btn" onClick={confirmDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting…' : 'Delete scan'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
