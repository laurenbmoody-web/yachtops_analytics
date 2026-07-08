// Add Scan — the Manage-Scans upload flow, in a popover bound to one space.
// Opened from a space's "Add scan" on the Location Management gallery. Runs the
// full flow in place — pick file → name → upload → stand upright → done — and
// binds the new scan to the space via space_id, so the space lights up Scanned
// without ever leaving the page. Reuses the map's upload engine + orient panel.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import GuideCards from '../../vessel-map/components/GuideCards';
import SplatViewer from '../../vessel-map/components/SplatViewer';
import OrientPanel from '../../vessel-map/components/OrientPanel';
import { refreshScanThumb } from '../../vessel-map/utils/scanThumb';
import { SCAN_EXTENSIONS, validateScanFile, fileExtension, createScanUpload } from '../../vessel-map/utils/scanUpload';
import '../../../styles/editorial.css';
import '../../vessel-map/vessel-map.css';
import '../../vessel-map/manage-scans.css';
import './add-scan-modal.css';

const VM_STAGE = '#22253F';
const fmtSize = (bytes) => (bytes == null ? '—' : `${(bytes / (1024 * 1024)).toFixed(1)}MB`);

export default function AddScanModal({ space, onClose, onComplete }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [step, setStep] = useState('choose'); // choose → pick → form → uploading → orient → done
  const [unlinked, setUnlinked] = useState(null); // null = loading; [] = none
  const [linkBusy, setLinkBusy] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [file, setFile] = useState(null);
  const [name, setName] = useState(space?.name || '');
  const [fileError, setFileError] = useState(null);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [uploadError, setUploadError] = useState(null);
  const [uploadPermanent, setUploadPermanent] = useState(false);
  const [uploadedScan, setUploadedScan] = useState(null);
  const [orientUrl, setOrientUrl] = useState(null);
  const [orientDraft, setOrientDraft] = useState({ x: 0, y: 0, z: 0 });
  const [orientSaving, setOrientSaving] = useState(false);
  const [orientError, setOrientError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const activeUploadRef = useRef(null);
  const viewerApiRef = useRef(null);
  const completedRef = useRef(false); // fire onComplete at most once

  useEffect(() => () => activeUploadRef.current?.abort?.(), []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && step !== 'uploading') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const markComplete = () => { if (!completedRef.current) { completedRef.current = true; onComplete?.(); } };
  const close = () => { onClose?.(); };

  // Find scans not yet assigned to a space — the "link existing" pick-list.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeTenantId) return;
      const { data, error } = await supabase.from('vessel_scans')
        .select('id, name, deck, status, thumb_path')
        .eq('tenant_id', activeTenantId)
        .is('space_id', null)
        .order('created_at', { ascending: false });
      if (!alive) return;
      if (error) { console.error('[add-scan] unlinked fetch:', error); setUnlinked([]); setStep('pick'); return; }
      const rows = data || [];
      const paths = rows.map((r) => r.thumb_path).filter(Boolean);
      const thumbs = {};
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('vessel-scans').createSignedUrls(paths, 3600);
        (signed || []).forEach((sg) => { if (sg?.signedUrl && !sg.error) thumbs[sg.path] = sg.signedUrl; });
      }
      if (!alive) return;
      const withUrls = rows.map((r) => ({ ...r, thumbUrl: r.thumb_path ? thumbs[r.thumb_path] : null }));
      setUnlinked(withUrls);
      if (withUrls.length === 0) setStep('pick');
    })();
    return () => { alive = false; };
  }, [activeTenantId]);

  const linkScan = async (scan) => {
    setLinkBusy(scan.id);
    setLinkError(null);
    const { error } = await supabase.from('vessel_scans').update({ space_id: space.id }).eq('id', scan.id);
    setLinkBusy(null);
    if (error) { console.error('[add-scan] link error:', error); setLinkError(error.message || 'Could not link that scan.'); return; }
    markComplete();
    close();
  };

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
    const upload = await createScanUpload({ path, file: f, onProgress: (sent, total) => setProgress({ sent, total }) });
    activeUploadRef.current = upload;
    await upload.promise;
    activeUploadRef.current = null;
  };

  const beginUpload = async () => {
    if (!file || !name.trim() || !activeTenantId) return;
    const id = crypto.randomUUID();
    const ext = fileExtension(file.name);
    const path = `${activeTenantId}/${id}.${ext}`;
    setUploadError(null);
    setUploadPermanent(false);
    setStep('uploading');

    // next sort order — one small query, no full list needed
    const { data: top } = await supabase.from('vessel_scans')
      .select('sort_order').eq('tenant_id', activeTenantId)
      .order('sort_order', { ascending: false }).limit(1);
    const nextSort = (top?.[0]?.sort_order ?? 0) + 1;

    const { data: row, error: insertError } = await supabase.from('vessel_scans').insert({
      id,
      tenant_id: activeTenantId,
      name: name.trim(),
      deck: null,
      space_id: space.id,
      storage_path: path,
      file_format: ext,
      status: 'uploading',
      sort_order: nextSort,
      created_by: user?.id ?? null,
    }).select().single();
    if (insertError) {
      console.error('[add-scan] row create error:', insertError);
      setUploadError(insertError.message || 'Could not register the scan.');
      setStep('form');
      return;
    }

    try {
      await runTransfer(path, file);
    } catch (err) {
      console.error('[add-scan] upload failed:', err);
      setUploadError(err.friendly || 'The upload didn’t finish — check the connection and retry.');
      setUploadPermanent(Boolean(err.permanent));
      setUploadedScan(row);
      return;
    }

    const { error: finaliseError } = await supabase.from('vessel_scans')
      .update({ status: 'ready', file_bytes: file.size }).in('id', [id]);
    if (finaliseError) {
      console.error('[add-scan] finalise error:', finaliseError);
      setUploadError(finaliseError.message || 'Uploaded, but could not finalise the scan.');
      setUploadedScan(row);
      return;
    }

    const ready = { ...row, status: 'ready', file_bytes: file.size };
    setUploadedScan(ready);
    markComplete(); // the space is Scanned from here on, even if they close now
    setOrientDraft({ x: 0, y: 0, z: 0 });
    setOrientError(null);
    const { data: signed } = await supabase.storage.from('vessel-scans').createSignedUrl(path, 3600);
    setOrientUrl(signed?.signedUrl || null);
    setStep('orient');
  };

  const retryUpload = async () => {
    if (!file || !uploadedScan) return;
    setUploadError(null);
    setUploadPermanent(false);
    setStep('uploading');
    try {
      await runTransfer(uploadedScan.storage_path, file);
    } catch (err) {
      console.error('[add-scan] retry failed:', err);
      setUploadError(err.friendly || 'Still no luck — the next retry resumes from the same point.');
      setUploadPermanent(Boolean(err.permanent));
      return;
    }
    const { error } = await supabase.from('vessel_scans')
      .update({ status: 'ready', file_bytes: file.size }).in('id', [uploadedScan.id]);
    if (error) { setUploadError(error.message || 'Uploaded, but could not finalise the scan.'); return; }
    markComplete();
    const { data: signed } = await supabase.storage.from('vessel-scans').createSignedUrl(uploadedScan.storage_path, 3600);
    setOrientUrl(signed?.signedUrl || null);
    setOrientDraft({ x: 0, y: 0, z: 0 });
    setStep('orient');
  };

  const discardUpload = async () => {
    if (uploadedScan) {
      await supabase.from('vessel_scans').delete().eq('id', uploadedScan.id);
      await supabase.storage.from('vessel-scans').remove([uploadedScan.storage_path]).catch(() => {});
    }
    close();
  };

  const captureThumb = async (scan) => {
    let blob = null;
    try { blob = await viewerApiRef.current?.captureFrame?.(); } catch (err) { console.error('[add-scan] thumb capture error:', err); }
    if (!blob) return;
    await refreshScanThumb({ scan, tenantId: activeTenantId, blob });
  };

  const saveOrientation = async () => {
    setOrientSaving(true);
    setOrientError(null);
    const thumbPromise = captureThumb(uploadedScan);
    const { error } = await supabase.from('vessel_scans').update({ splat_rotation: orientDraft }).in('id', [uploadedScan.id]);
    setOrientSaving(false);
    if (error) { setOrientError(error.message || 'Could not save the orientation.'); return; }
    await thumbPromise;
    markComplete();
    setStep('done');
  };

  const approveAsIs = async () => {
    await captureThumb(uploadedScan);
    markComplete();
    setStep('done');
  };

  const pct = progress.total ? Math.round((progress.sent / progress.total) * 100) : 0;
  const dismissable = step !== 'uploading';

  return (
    <div className="asm-overlay" onClick={() => dismissable && close()}>
      <div className={`asm-panel${step === 'orient' ? ' asm-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="asm-head">
          <p className="editorial-meta">
            <span className="dot">●</span><span>Location</span>
            <span className="bar" /><span className="muted">{space?.name}</span>
          </p>
          {dismissable && <button className="asm-close" aria-label="Close" onClick={close}>✕</button>}
        </div>

        {step === 'choose' && (
          <div className="asm-body">
            {unlinked === null ? (
              <p className="asm-loading">Looking for existing scans…</p>
            ) : (
              <>
                <p className="vm-label">Link an existing scan</p>
                <p className="vmm-note">These scans aren’t assigned to a space yet — pick one to place it in {space?.name}.</p>
                <div className="asm-scanlist">
                  {unlinked.map((sc) => (
                    <button key={sc.id} className="asm-scanrow" disabled={!!linkBusy} onClick={() => linkScan(sc)}>
                      <span className="asm-scanthumb">
                        {sc.thumbUrl ? <img src={sc.thumbUrl} alt="" /> : <span className="asm-scanthumb-ph" />}
                      </span>
                      <span className="asm-scanmeta">
                        <span className="asm-scanname">{sc.name}</span>
                        <span className="asm-scansub">{[sc.deck, sc.status !== 'ready' ? 'Upload incomplete' : null].filter(Boolean).join(' · ') || 'Ready'}</span>
                      </span>
                      <span className="asm-scanlink">{linkBusy === sc.id ? 'Linking…' : 'Link'}</span>
                    </button>
                  ))}
                </div>
                {linkError && <p className="vmm-error">{linkError}</p>}
                <div className="asm-or"><span>or</span></div>
                <button className="vm-btn-ghost" onClick={() => setStep('pick')}>Upload a new scan instead</button>
              </>
            )}
          </div>
        )}

        {step === 'pick' && (
          <div
            className={`asm-body${dragOver ? ' asm-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
          >
            {unlinked?.length > 0 && (
              <button className="asm-backlink" onClick={() => setStep('choose')}>‹ Link an existing scan instead</button>
            )}
            <GuideCards onFile={acceptFile} />
            {fileError && <p className="vmm-error">{fileError}</p>}
          </div>
        )}

        {step === 'form' && (
          <div className="asm-body">
            <p className="vm-label">New scan <span className="vmm-file-chip">{file?.name} · {fmtSize(file?.size)}</span></p>
            <div className="vmm-field" style={{ marginTop: 10 }}>
              <p className="vm-label">Name <span className="vm-label-required">required</span></p>
              <input className="vm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={space?.name || 'Room name'} autoFocus />
            </div>
            {uploadError && <p className="vmm-error">{uploadError}</p>}
            <div className="vmm-actions" style={{ marginTop: 16 }}>
              <button className="vm-btn-primary" onClick={beginUpload} disabled={!name.trim()}>Upload scan</button>
              <button className="vm-btn-ghost" onClick={() => { setFile(null); setStep('pick'); }}>Back</button>
            </div>
          </div>
        )}

        {step === 'uploading' && (
          <div className="asm-body">
            <p className="vm-label">Uploading {name}</p>
            {!uploadError ? (
              <>
                <div className="vmm-progress-track"><div className="vmm-progress-fill" style={{ width: `${pct}%` }} /></div>
                <p className="vmm-progress-label">{fmtSize(progress.sent)} of {fmtSize(progress.total)} · {pct}%</p>
              </>
            ) : (
              <>
                <p className="vmm-error">{uploadError}</p>
                <div className="vmm-actions">
                  {!uploadPermanent && <button className="vm-btn-primary" onClick={retryUpload}>Retry upload</button>}
                  <button className={uploadPermanent ? 'vm-btn-primary' : 'vm-btn-ghost'} onClick={discardUpload}>Discard</button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'orient' && uploadedScan && (
          <div className="asm-body">
            <p className="vm-label">Stand it upright</p>
            <p className="vmm-note">Rotate until the room stands as it does aboard, then save.</p>
            <div className="vmm-stage asm-stage">
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
          <div className="asm-body asm-done">
            <p className="asm-done-title">“{uploadedScan.name}” is aboard.</p>
            <div className="vmm-actions">
              <button className="vm-btn-primary" onClick={() => navigate(`/vessel/map?scan=${uploadedScan.id}`)}>View on map</button>
              <button className="vm-btn-ghost" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
