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
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Header from '../../components/navigation/Header';
import SplatViewer from './components/SplatViewer';
import OrientPanel from './components/OrientPanel';
import { SCAN_EXTENSIONS, SCAN_MAX_BYTES, validateScanFile, fileExtension, createScanUpload } from './utils/scanUpload';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';

const VM_STAGE = '#22253F';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtSize = (bytes) => (bytes == null ? '—' : `${(bytes / (1024 * 1024)).toFixed(1)}MB`);

export default function ManageScans() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [scans, setScans] = useState([]);
  const [pinCounts, setPinCounts] = useState({});
  const [storageSizes, setStorageSizes] = useState({}); // legacy rows without file_bytes
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
  const [dragOver, setDragOver] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  // Per-row: edits, replace/complete transfer state, delete modal.
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
    else setScans(scansRes.data || []);
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

  const saveOrientation = async () => {
    setOrientSaving(true);
    setOrientError(null);
    const { error } = await supabase.from('vessel_scans')
      .update({ splat_rotation: orientDraft }).in('id', [uploadedScan.id]);
    setOrientSaving(false);
    if (error) {
      console.error('[manage-scans] orientation save error:', error);
      setOrientError(error.message || 'Could not save the orientation.');
      return;
    }
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
    loadAll();
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

    const { error } = await supabase.from('vessel_scans')
      .update({ storage_path: newPath, file_format: ext, file_bytes: f.size, status: 'ready' })
      .in('id', [s.id]);
    if (error) {
      console.error('[manage-scans] replace finalise error:', error);
      setRowBusy((p) => ({ ...p, [s.id]: { error: error.message || 'Uploaded, but could not switch the scan over.' } }));
      return;
    }
    // Only now is the old file expendable.
    if (oldPath && oldPath !== newPath) {
      const { error: rmError } = await supabase.storage.from('vessel-scans').remove([oldPath]);
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
    const { error: rmError } = await supabase.storage.from('vessel-scans').remove([deleteTarget.storage_path]);
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

          {/* ── Upload flow ── */}
          {step === 'idle' && (
            <div
              className={`vmm-drop${dragOver ? ' vmm-drop-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
            >
              <p className="vmm-drop-title">Drop your 3D scan here</p>
              <p className="vmm-drop-body">
                Takes SPZ, PLY, SPLAT or KSPLAT, up to {Math.round(SCAN_MAX_BYTES / (1024 * 1024))}MB.
                {' '}<strong>SPZ</strong> is smallest — best for upload.
              </p>
              <label className="vm-btn-primary vmm-drop-pick">
                Choose a file
                <input
                  type="file"
                  accept={SCAN_EXTENSIONS.map((e) => `.${e}`).join(',')}
                  style={{ display: 'none' }}
                  onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
              {fileError && <p className="vmm-error">{fileError}</p>}

              {/* Capture guide — part of the dropzone composition, not stray
                  text. The minimum a first-time uploader needs without leaving
                  the page; the full guide is a later document. */}
              <div className="vmm-guide">
                <button
                  className="vmm-guide-toggle"
                  onClick={() => setGuideOpen((v) => !v)}
                  aria-expanded={guideOpen}
                >
                  How do I capture a scan?
                  <span className={`vmm-guide-caret${guideOpen ? ' vmm-guide-caret-open' : ''}`} aria-hidden="true">›</span>
                </button>
                {guideOpen && (
                  <div className="vmm-guide-body">
                    <ol className="vmm-guide-steps">
                      <li>
                        <span className="vmm-guide-num">1</span>
                        <p className="vmm-guide-step-title">Scan the room</p>
                        <p className="vmm-guide-step-body">Slowly, with a free phone app — <strong>Scaniverse</strong> or <strong>Polycam</strong>. Lights on, blinds drawn.</p>
                      </li>
                      <li>
                        <span className="vmm-guide-num">2</span>
                        <p className="vmm-guide-step-title">Export the scan</p>
                        <p className="vmm-guide-step-body">Scaniverse: Share → Export Model → <strong>SPZ</strong>. Polycam: Export → Gaussian Splat → <strong>PLY</strong>.</p>
                      </li>
                      <li>
                        <span className="vmm-guide-num">3</span>
                        <p className="vmm-guide-step-title">Drop it here</p>
                        <p className="vmm-guide-step-body">Name it, stand it upright — it's on the map.</p>
                      </li>
                    </ol>
                    <p className="vmm-guide-close">Big file? SPZ exports are much smaller than PLY.</p>
                  </div>
                )}
              </div>
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
                    stageColor={VM_STAGE}
                  />
                )}
                <OrientPanel
                  value={orientDraft}
                  onChange={(next) => { setOrientError(null); setOrientDraft(next); }}
                  onSave={saveOrientation}
                  onCancel={() => setStep('done')}
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

          {/* ── The list ── */}
          {!loading && scans.length > 0 && (
            <div className="vmm-list">
              <div className="vmm-list-head">
                <span>Scan</span><span>Deck</span><span>Order</span><span>Size</span><span>Format</span><span>Pins</span><span>Added</span><span />
              </div>
              {scans.map((s) => {
                const busy = rowBusy[s.id];
                const incomplete = s.status !== 'ready';
                return (
                  <div key={s.id} className={`vmm-row${incomplete ? ' vmm-row-incomplete' : ''}`}>
                    <div className="vmm-cell-name">
                      <input className="vmm-inline-input" value={editValue(s, 'name')} onChange={(e) => setEdit(s.id, 'name', e.target.value)} aria-label="Scan name" />
                      {incomplete && <span className="vmm-badge">Upload incomplete</span>}
                    </div>
                    <input className="vmm-inline-input" value={editValue(s, 'deck')} onChange={(e) => setEdit(s.id, 'deck', e.target.value)} placeholder="—" aria-label="Deck" />
                    <input className="vmm-inline-input vmm-inline-num" type="number" value={editValue(s, 'sort_order')} onChange={(e) => setEdit(s.id, 'sort_order', e.target.value)} aria-label="Sort order" />
                    <span className="vmm-cell-quiet">{fmtSize(s.file_bytes ?? storageSizes[s.storage_path])}</span>
                    <span className="vmm-cell-quiet">{(s.file_format || '').toUpperCase()}</span>
                    <span className="vmm-cell-quiet">{pinCounts[s.id] || 0}</span>
                    <span className="vmm-cell-quiet">{fmtDate(s.created_at)}</span>
                    <div className="vmm-row-actions">
                      {rowDirty(s) && <button className="vm-btn-primary vmm-btn-sm" onClick={() => saveRow(s)}>Save</button>}
                      <button className="vm-btn-ghost vmm-btn-sm" onClick={() => pickReplacement(s)}>
                        {incomplete ? 'Upload file' : 'Replace file'}
                      </button>
                      <button className="vmm-delete" onClick={() => { setDeleteError(null); setDeleteTarget(s); }}>Delete</button>
                    </div>
                    {busy?.progress && (
                      <div className="vmm-row-progress">
                        <div className="vmm-progress-track">
                          <div className="vmm-progress-fill" style={{ width: `${busy.progress.total ? Math.round((busy.progress.sent / busy.progress.total) * 100) : 0}%` }} />
                        </div>
                        <p className="vmm-progress-label">{busy.label} · {fmtSize(busy.progress.sent)} of {fmtSize(busy.progress.total)}</p>
                        <p className="vmm-note">Pins keep their positions — if the new capture's orientation differs, re-orient after upload.</p>
                      </div>
                    )}
                    {busy?.error && <p className="vmm-error vmm-row-error">{busy.error}</p>}
                  </div>
                );
              })}
            </div>
          )}

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
