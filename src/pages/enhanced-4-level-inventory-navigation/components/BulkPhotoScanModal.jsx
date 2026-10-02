import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { detectInventoryItems } from '../../inventory/utils/itemVisionAi';
import { findProductImage } from '../../inventory/utils/productImageSearch';
import { pdfToPageBlobs } from '../../inventory/utils/pdfPages';
import { getSubfolderPaths, resolveOrCreateFolderPath, saveItem } from '../../inventory/utils/inventoryStorage';
import './bulk-photo-scan.css';

// Concurrency for the per-photo vision calls — kept modest so a big batch
// doesn't hammer the edge function / Anthropic all at once.
const CONCURRENCY = 3;
let ROW_SEQ = 0;

// Downscale + JPEG-encode a file. Returns a Blob (falls back to the original
// file if the image can't be decoded).
const toJpeg = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    let { width, height } = img; const MAX = 1600;
    if (Math.max(width, height) > MAX) { const s = MAX / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    c.getContext('2d')?.drawImage(img, 0, 0, width, height);
    c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.9);
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(blob);
});

// Upload a blob to the item-images bucket, return its public URL.
const uploadImage = async (blob) => {
  const { data: ctx } = await supabase.rpc('get_my_context');
  const tenantId = ctx?.[0]?.tenant_id || 'shared';
  const path = `inventory/${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await supabase.storage.from('item-images').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path);
  return pub?.publicUrl || '';
};

const CONF = {
  high: { label: 'High', cls: 'ok' },
  medium: { label: 'Medium', cls: 'mid' },
  low: { label: 'Low', cls: 'low' },
};

const BulkPhotoScanModal = ({ departmentName, currentPath = '', onClose, onDone }) => {
  const [phase, setPhase] = useState('select'); // select | analysing | review | saving | done
  const [rows, setRows] = useState([]);
  const [folders, setFolders] = useState([]); // existing sub_location paths under the department
  const [analysed, setAnalysed] = useState(0);
  const [photoTotal, setPhotoTotal] = useState(0); // photos being analysed (rows may expand past this)
  const [saveResult, setSaveResult] = useState(null);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Existing sub-folders to prefer / offer in the folder field.
  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await getSubfolderPaths(departmentName);
      // When filing from inside a sub-folder, only offer that branch.
      const scoped = currentPath
        ? all.filter((p) => p === currentPath || p.startsWith(`${currentPath} > `))
        : all;
      if (alive) setFolders(scoped.sort((a, b) => a.localeCompare(b)));
    })();
    return () => { alive = false; };
  }, [departmentName, currentPath]);

  const busy = phase === 'analysing' || phase === 'saving';

  const makeRow = useCallback((file) => ({
    id: `r${++ROW_SEQ}`,
    file,
    preview: URL.createObjectURL(file),
    status: 'pending', // pending | ready | error
    name: '',
    quantity: 1,
    folder: currentPath || '',
    confidence: '',
    description: '',
    imageUrl: '',
    imageSource: '', // '' | 'source' | 'web' | 'none'
    imgStatus: '',   // '' | 'searching' | 'done'
    include: true,
  }), [currentPath]);

  // Accept photos, order screenshots AND PDF packing lists. Each PDF page is
  // rasterised to an image and scanned like a photo.
  const addFiles = useCallback(async (fileList) => {
    const all = Array.from(fileList || []);
    const images = all.filter((f) => f.type.startsWith('image/'));
    const pdfs = all.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    if (images.length) setRows((prev) => [...prev, ...images.map(makeRow)]);
    for (const pdf of pdfs) {
      try {
        const blobs = await pdfToPageBlobs(pdf);
        const base = (pdf.name || 'document').replace(/\.pdf$/i, '');
        const pageFiles = blobs.map((b, i) => new File([b], `${base}-p${i + 1}.jpg`, { type: 'image/jpeg' }));
        if (pageFiles.length) setRows((prev) => [...prev, ...pageFiles.map(makeRow)]);
      } catch (_) { /* skip an unreadable PDF */ }
    }
  }, [makeRow]);

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  const patchRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((prev) => {
    const gone = prev.find((r) => r.id === id);
    const rest = prev.filter((r) => r.id !== id);
    // A photo can expand into several rows that share one preview URL — only
    // revoke it once no surviving row still references it.
    if (gone?.preview && !rest.some((r) => r.preview === gone.preview)) URL.revokeObjectURL(gone.preview);
    return rest;
  });

  // Build one row per detected item from a just-analysed photo row. All rows
  // from the same photo share its preview + uploaded source image. An empty
  // result yields a single blank "ready" row so the user can fill it manually.
  const buildDetectionRows = (seed, detections, imageUrl) => (
    detections.length
      ? detections.map((det, i) => ({
          ...seed,
          id: i === 0 ? seed.id : `r${++ROW_SEQ}`,
          status: 'ready', imageUrl, sourceUrl: imageUrl, imageSource: imageUrl ? 'source' : '', imgStatus: '',
          name: det.name || '', quantity: det.quantity || 1,
          folder: det.folder || currentPath || '', confidence: det.confidence || 'medium',
          description: det.description || '', include: true,
        }))
      : [{ ...seed, status: 'ready', imageUrl, sourceUrl: imageUrl, imageSource: imageUrl ? 'source' : '', confidence: 'low' }]
  );

  // Analyse every pending row: compress → upload → vision-detect, then search a
  // real product photo per detected item. Capped by CONCURRENCY.
  const analyse = async () => {
    const pending = rows.filter((r) => r.status === 'pending');
    if (!pending.length) return;
    setPhase('analysing'); setAnalysed(0); setPhotoTotal(pending.length);

    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift();
        try {
          const blob = await toJpeg(row.file);
          const [dataUrl, imageUrl] = await Promise.all([
            blobToDataUrl(blob),
            uploadImage(blob).catch(() => ''),
          ]);
          const detections = await detectInventoryItems(dataUrl, { departmentName, currentPath, folders });
          const built = buildDetectionRows(row, detections, imageUrl);
          // Swap the source row for its detected item rows.
          setRows((prev) => {
            const idx = prev.findIndex((r) => r.id === row.id);
            if (idx === -1) return prev;
            return [...prev.slice(0, idx), ...built, ...prev.slice(idx + 1)];
          });
          // Suggest a real product photo for each named item (replaces the
          // source screenshot when one is found; otherwise the screenshot stays).
          const named = built.filter((b) => b.name && b.name.trim());
          named.forEach((b) => patchRow(b.id, { imgStatus: 'searching' }));
          await Promise.all(named.map(async (b) => {
            const found = await findProductImage(b.name);
            patchRow(b.id, found ? { imageUrl: found, imageSource: 'web', imgStatus: 'done' } : { imgStatus: 'done' });
          }));
        } catch (err) {
          patchRow(row.id, { status: 'error', error: err?.message || 'failed' });
        } finally {
          setAnalysed((n) => n + 1);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setPhase('review');
  };

  const includable = rows.filter((r) => r.include && r.name.trim() && r.folder.trim());

  const save = async () => {
    if (!includable.length) return;
    setPhase('saving');
    let saved = 0; const failures = [];
    for (const row of includable) {
      try {
        const segments = [departmentName, ...row.folder.split(' > ').map((s) => s.trim()).filter(Boolean)];
        await resolveOrCreateFolderPath(segments);
        await saveItem({
          name: row.name.trim(),
          location: departmentName,
          subLocation: row.folder.trim(),
          quantity: Number(row.quantity) || 1,
          imageUrl: row.imageUrl || '',
        });
        saved += 1;
      } catch (err) {
        failures.push({ name: row.name, error: err?.message || 'failed' });
      }
    }
    setSaveResult({ saved, failures });
    setPhase('done');
  };

  useEffect(() => () => { rows.forEach((r) => r.preview && URL.revokeObjectURL(r.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = useMemo(() => {
    const where = currentPath ? `${departmentName} › ${currentPath}` : departmentName;
    return where;
  }, [departmentName, currentPath]);

  const isNewFolder = (r) => r.folder.trim() && !folders.includes(r.folder.trim());

  return (
    <ModalShell onClose={busy ? () => {} : onClose} isBusy={busy} panelClassName="bps-panel">
      <div className="bps">
        <div className="bps-head">
          <div>
            <div className="bps-eyebrow">Photo scan · {heading}</div>
            <h2 className="bps-title">Add items from photos</h2>
          </div>
          <button type="button" className="bps-x" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {/* SELECT / ANALYSE */}
        {(phase === 'select' || phase === 'analysing') && (
          <>
            <div
              className={`bps-drop${dragOver ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button" tabIndex={0}
            >
              <div className="bps-drop-icon"><Icon name="Camera" size={26} /></div>
              <div className="bps-drop-title">Drop photos, order screenshots or a PDF here, or click to choose</div>
              <div className="bps-drop-sub">Photos, an order screenshot, or a PDF packing list all work. We’ll split multi-product shots into separate rows, suggest a folder in {departmentName}, and find a product photo for each.</div>
              <input
                ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {rows.length > 0 && (
              <div className="bps-thumbs">
                {rows.map((r) => (
                  <div key={r.id} className="bps-thumb">
                    <img src={r.preview} alt="" />
                    {phase === 'select' && (
                      <button type="button" className="bps-thumb-x" onClick={() => removeRow(r.id)} aria-label="Remove"><Icon name="X" size={12} /></button>
                    )}
                    {phase === 'analysing' && r.status === 'pending' && <div className="bps-thumb-spin"><Icon name="Loader" size={14} /></div>}
                    {r.status === 'ready' && <div className="bps-thumb-tick"><Icon name="Check" size={12} /></div>}
                  </div>
                ))}
              </div>
            )}

            <div className="bps-foot">
              <div className="bps-foot-note">
                {phase === 'analysing'
                  ? `Identifying… ${analysed}/${photoTotal}`
                  : rows.length ? `${rows.length} photo${rows.length > 1 ? 's' : ''} ready` : ''}
              </div>
              <div className="bps-foot-actions">
                <button type="button" className="bps-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="bps-btn accent" onClick={analyse} disabled={busy || !rows.length}>
                  {phase === 'analysing' ? 'Identifying…' : `Identify ${rows.length || ''} item${rows.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* REVIEW */}
        {phase === 'review' && (
          <>
            <p className="bps-review-lead">Check each item and its folder, then save. Edit anything the scan got wrong; untick to skip.</p>
            <div className="bps-rows">
              {rows.map((r) => (
                <div key={r.id} className={`bps-row${r.include ? '' : ' skipped'}`}>
                  <label className="bps-row-inc">
                    <input type="checkbox" checked={r.include} onChange={(e) => patchRow(r.id, { include: e.target.checked })} />
                  </label>
                  <div className="bps-row-imgwrap">
                    <img className="bps-row-img" src={r.imageUrl || r.preview} alt="" />
                    {r.imgStatus === 'searching' && (
                      <span className="bps-img-finding" title="Finding a product photo…"><Icon name="Loader" size={12} /></span>
                    )}
                    {r.imageSource === 'web' && r.imgStatus !== 'searching' && (
                      <span className="bps-img-badge" title="Product photo found by search">web</span>
                    )}
                    {(r.imageUrl || r.imageSource === 'web') && (
                      <button
                        type="button"
                        className="bps-img-clear"
                        title={r.imageSource === 'web' && r.sourceUrl ? 'Use the source image instead' : 'Remove photo'}
                        onClick={() => patchRow(r.id, (r.imageSource === 'web' && r.sourceUrl)
                          ? { imageUrl: r.sourceUrl, imageSource: 'source' }
                          : { imageUrl: '', imageSource: 'none' })}
                      >
                        <Icon name="X" size={10} />
                      </button>
                    )}
                  </div>
                  <div className="bps-row-fields">
                    <div className="bps-field-name">
                      <input
                        className="bps-input" value={r.name} placeholder="Item name"
                        onChange={(e) => patchRow(r.id, { name: e.target.value })}
                      />
                      {r.confidence && r.status !== 'error' && (
                        <span className={`bps-conf ${CONF[r.confidence]?.cls || 'mid'}`}>{CONF[r.confidence]?.label || r.confidence}</span>
                      )}
                      {r.status === 'error' && <span className="bps-conf low">Scan failed</span>}
                    </div>
                    <div className="bps-field-row">
                      <div className="bps-qty">
                        <span className="bps-qty-lbl">Qty</span>
                        <input
                          className="bps-input qty" type="number" min="1" value={r.quantity}
                          onChange={(e) => patchRow(r.id, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="bps-folder">
                        <Icon name="Folder" size={13} className="bps-folder-ic" />
                        <input
                          className="bps-input" list="bps-folder-list" value={r.folder} placeholder="Choose folder"
                          onChange={(e) => patchRow(r.id, { folder: e.target.value })}
                        />
                        {isNewFolder(r) && <span className="bps-new-tag">new</span>}
                      </div>
                    </div>
                  </div>
                  <button type="button" className="bps-row-x" onClick={() => removeRow(r.id)} aria-label="Remove"><Icon name="Trash2" size={15} /></button>
                </div>
              ))}
            </div>
            <datalist id="bps-folder-list">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>

            <div className="bps-foot">
              <div className="bps-foot-note">{includable.length} of {rows.length} will be added</div>
              <div className="bps-foot-actions">
                <button type="button" className="bps-btn ghost" onClick={() => setPhase('select')}>Back</button>
                <button type="button" className="bps-btn accent" onClick={save} disabled={!includable.length}>
                  Add {includable.length} item{includable.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* SAVING */}
        {phase === 'saving' && (
          <div className="bps-status"><Icon name="Loader" size={22} className="bps-spin" /><p>Saving items…</p></div>
        )}

        {/* DONE */}
        {phase === 'done' && saveResult && (
          <div className="bps-status">
            <div className="bps-done-ic"><Icon name="Check" size={26} /></div>
            <p className="bps-done-title">{saveResult.saved} item{saveResult.saved === 1 ? '' : 's'} added</p>
            {saveResult.failures.length > 0 && (
              <p className="bps-done-fail">{saveResult.failures.length} couldn’t be saved — try those again.</p>
            )}
            <div className="bps-foot-actions">
              <button type="button" className="bps-btn accent" onClick={() => { onDone?.(); onClose(); }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
};

export default BulkPhotoScanModal;
