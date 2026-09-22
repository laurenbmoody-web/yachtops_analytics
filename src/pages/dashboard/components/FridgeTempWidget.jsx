import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import BarcodeScanModal from '../../inventory/components/BarcodeScanModal';
import { printItemQr } from '../../inventory/utils/itemQr';
import {
  fetchWeekStatus, fetchFridges, logReading, uploadFridgePhoto, computeInRange,
  fetchHistory, updateFridge, addFridge, deactivateFridge,
} from '../../../services/fridgeTemps';
import { exportFridgeTempsPdf } from '../utils/fridgeTempsExport';
import './fridge-temps.css';

const ddmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const rangeLabel = (f) => {
  if (f?.safe_min == null && f?.safe_max == null) return 'no range set';
  return `${f?.safe_min ?? '−∞'}–${f?.safe_max ?? '∞'}°C`;
};

// ── Log-a-reading modal ───────────────────────────────────────────────────────
const LogModal = ({ fridge, tenantId, userId, onClose, onSaved }) => {
  const [temp, setTemp] = useState('');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const inRange = computeInRange(temp, fridge.safe_min, fridge.safe_max);
  const outOfRange = inRange === false;

  const pickPhoto = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    try { setPhotoUrl(await uploadFridgePhoto(file, tenantId)); }
    catch (err) { showToast(err.message || 'Photo upload failed', 'error'); }
    finally { setPhotoBusy(false); }
  };

  const save = async () => {
    if (saving) return;
    if ((temp === '' || temp == null) && !photoUrl) { showToast('Enter a temperature or add a photo', 'error'); return; }
    setSaving(true);
    try {
      await logReading(tenantId, fridge, { tempC: temp, photoUrl, note, loggedBy: userId });
      showToast(`${fridge.name} logged`, 'success');
      onSaved?.();
    } catch (err) { showToast(err.message || 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="ft-modal-scrim" onClick={onClose}>
      <div className="ft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head">
          <div>
            <p className="ft-eyebrow">● {fridge.kind === 'freezer' ? 'Freezer' : 'Fridge'} · safe {rangeLabel(fridge)}</p>
            <h3 className="ft-modal-title">{fridge.name}</h3>
          </div>
          <button className="ft-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <label className="ft-label">Temperature (°C)</label>
        <div className={`ft-tempwrap${outOfRange ? ' out' : inRange ? ' in' : ''}`}>
          <input
            type="number" inputMode="decimal" step="0.1" className="ft-tempinput"
            value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="—" autoFocus
          />
          <span className="ft-tempunit">°C</span>
        </div>
        {outOfRange && (
          <p className="ft-warn"><Icon name="AlertTriangle" size={13} /> Outside safe range ({rangeLabel(fridge)}) — add a note below.</p>
        )}
        {inRange && <p className="ft-ok"><Icon name="Check" size={13} /> Within safe range.</p>}

        <label className="ft-label">Or photograph the thermometer</label>
        {photoUrl ? (
          <div className="ft-photo">
            <img src={photoUrl} alt="thermometer" />
            <button className="ft-photo-x" onClick={() => setPhotoUrl('')} aria-label="Remove photo"><Icon name="X" size={14} /></button>
          </div>
        ) : (
          <label className={`ft-photobtn${photoBusy ? ' busy' : ''}`}>
            <Icon name="Camera" size={16} />
            {photoBusy ? 'Uploading…' : 'Take / choose photo'}
            <input type="file" accept="image/*" capture="environment" onChange={pickPhoto} hidden disabled={photoBusy} />
          </label>
        )}

        <label className="ft-label">Note {outOfRange ? <em className="ft-req">required if out of range</em> : <em className="ft-opt">optional</em>}</label>
        <textarea className="ft-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. door left ajar, moved stock, re-checked in 1h…" />

        <div className="ft-modal-foot">
          <button className="ft-btn ghost" onClick={onClose}>Cancel</button>
          <button className="ft-btn prim" onClick={save} disabled={saving || photoBusy || (outOfRange && !note.trim())}>
            {saving ? 'Saving…' : 'Log reading'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── History modal (with export) ───────────────────────────────────────────────
const HistoryModal = ({ tenantId, onClose }) => {
  const [rows, setRows] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { (async () => setRows(await fetchHistory(tenantId, { limit: 400 })))(); }, [tenantId]);

  const doExport = async () => {
    setExporting(true);
    try { await exportFridgeTempsPdf(tenantId); }
    catch (e) { showToast(e.message || 'Export failed', 'error'); }
    finally { setExporting(false); }
  };

  return createPortal(
    <div className="ft-modal-scrim" onClick={onClose}>
      <div className="ft-modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head">
          <div>
            <p className="ft-eyebrow">● Food safety · temperature history</p>
            <h3 className="ft-modal-title">Fridge temperature log</h3>
          </div>
          <div className="ft-head-actions">
            <button className="ft-btn ghost sm" onClick={doExport} disabled={exporting}>
              <Icon name="FileDown" size={14} /> {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
            <button className="ft-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
          </div>
        </div>

        {rows == null ? (
          <p className="ft-empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="ft-empty">No readings logged yet.</p>
        ) : (
          <div className="ft-hist">
            {rows.map((r) => (
              <div key={r.id} className="ft-hrow">
                <span className={`ft-dot ${r.in_range === false ? 'out' : r.in_range ? 'in' : 'na'}`} />
                <div className="ft-hmain">
                  <span className="ft-hname">{r.fridgeName}</span>
                  <span className="ft-hmeta">{ddmm(r.logged_at)} {new Date(r.logged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{r.loggedByName ? ` · ${r.loggedByName}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
                </div>
                {r.photo_url && (
                  <a className="ft-hphoto" href={r.photo_url} target="_blank" rel="noreferrer"><img src={r.photo_url} alt="" /></a>
                )}
                <span className={`ft-htemp ${r.in_range === false ? 'out' : r.in_range ? 'in' : 'na'}`}>
                  {r.temp_c == null ? (r.photo_url ? 'photo' : '—') : `${r.temp_c}°`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

// ── Manage fridges (COMMAND / CHIEF) ──────────────────────────────────────────
const ManageModal = ({ tenantId, onClose, onSaved }) => {
  const [list, setList] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const reload = useCallback(async () => setList(await fetchFridges(tenantId)), [tenantId]);
  useEffect(() => { reload(); }, [reload]);

  const patch = (id, key, value) => setList((l) => l.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  const saveRow = async (f) => {
    setSavingId(f.id);
    try {
      await updateFridge(f.id, { name: f.name, kind: f.kind, safeMin: f.safe_min === '' ? null : f.safe_min, safeMax: f.safe_max === '' ? null : f.safe_max });
      showToast('Saved', 'success'); onSaved?.();
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setSavingId(null); }
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.name}? Its history is kept.`)) return;
    try { await deactivateFridge(f.id); await reload(); onSaved?.(); } catch (e) { showToast(e.message, 'error'); }
  };
  const add = async () => {
    try { await addFridge(tenantId, { name: `Fridge ${(list?.length || 0) + 1}`, safeMin: 0, safeMax: 5, sortOrder: (list?.length || 0) }); await reload(); onSaved?.(); }
    catch (e) { showToast(e.message, 'error'); }
  };

  return createPortal(
    <div className="ft-modal-scrim" onClick={onClose}>
      <div className="ft-modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head">
          <div>
            <p className="ft-eyebrow">● Setup · appliances &amp; safe ranges</p>
            <h3 className="ft-modal-title">Manage fridges</h3>
          </div>
          <button className="ft-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        {list == null ? <p className="ft-empty">Loading…</p> : (
          <div className="ft-manage">
            {list.map((f) => (
              <div key={f.id} className="ft-mrow">
                <input className="ft-min ft-mname" value={f.name} onChange={(e) => patch(f.id, 'name', e.target.value)} />
                <select className="ft-min" value={f.kind} onChange={(e) => patch(f.id, 'kind', e.target.value)}>
                  <option value="fridge">Fridge</option>
                  <option value="freezer">Freezer</option>
                </select>
                <input className="ft-min ft-mnum" type="number" step="0.1" value={f.safe_min ?? ''} placeholder="min" onChange={(e) => patch(f.id, 'safe_min', e.target.value === '' ? null : Number(e.target.value))} />
                <input className="ft-min ft-mnum" type="number" step="0.1" value={f.safe_max ?? ''} placeholder="max" onChange={(e) => patch(f.id, 'safe_max', e.target.value === '' ? null : Number(e.target.value))} />
                <button className="ft-btn ghost sm" onClick={() => printItemQr({ code: f.code, name: f.name, location: 'Fridge temp log' })} title="Print QR label"><Icon name="QrCode" size={14} /></button>
                <button className="ft-btn prim sm" onClick={() => saveRow(f)} disabled={savingId === f.id}>{savingId === f.id ? '…' : 'Save'}</button>
                <button className="ft-icon-danger" onClick={() => remove(f)} title="Remove"><Icon name="Trash2" size={14} /></button>
              </div>
            ))}
            <button className="ft-addrow" onClick={add}><Icon name="Plus" size={14} /> Add fridge</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

// ── Widget ────────────────────────────────────────────────────────────────────
const FridgeTempWidget = () => {
  const { session, activeTenantId, hasCommandAccess, hasChiefAccess } = useAuth();
  const userId = session?.user?.id;
  const canManage = (typeof hasCommandAccess === 'function' && hasCommandAccess())
    || (typeof hasChiefAccess === 'function' && hasChiefAccess());

  const [data, setData] = useState({ fridges: [], byFridge: {} });
  const [loading, setLoading] = useState(true);
  const [logTarget, setLogTarget] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showScan, setShowScan] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    try { setData(await fetchWeekStatus(activeTenantId)); } finally { setLoading(false); }
  }, [activeTenantId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const onScanned = (code) => {
    setShowScan(false);
    const val = String(code || '').trim().toUpperCase();
    const f = data.fridges.find((x) => (x.code || '').toUpperCase() === val || x.name.toUpperCase() === val);
    if (f) setLogTarget(f);
    else showToast('No fridge matches that code', 'error');
  };

  const doneCount = data.fridges.filter((f) => data.byFridge[f.id]?.loggedThisWeek).length;
  const total = data.fridges.length;

  return (
    <div className="ce-card ft-card rounded-xl">
      <div className="ft-top">
        <div>
          <p className="ft-eyebrow">● Fridge temps · this week</p>
          <p className="ft-count">{loading ? '—' : `${doneCount}/${total} logged`}</p>
        </div>
        <div className="ft-top-actions">
          <button className="ft-chip" onClick={() => setShowScan(true)} title="Scan a fridge label"><Icon name="ScanLine" size={14} /></button>
          <button className="ft-chip" onClick={() => setShowHistory(true)} title="History &amp; export"><Icon name="History" size={14} /></button>
          {canManage && <button className="ft-chip" onClick={() => setShowManage(true)} title="Manage fridges"><Icon name="Settings2" size={14} /></button>}
        </div>
      </div>

      {loading ? (
        <div className="ft-skel" aria-hidden="true" />
      ) : total === 0 ? (
        <p className="ft-empty">No fridges set up.{canManage ? ' Use the settings icon to add some.' : ''}</p>
      ) : (
        <div className="ft-grid">
          {data.fridges.map((f) => {
            const st = data.byFridge[f.id] || {};
            const last = st.lastLog;
            const done = st.loggedThisWeek;
            const breach = last?.in_range === false;
            const tempState = last ? (last.in_range === false ? 'out' : last.in_range ? 'in' : 'na') : 'na';
            const tempText = last ? (last.temp_c == null ? (last.photo_url ? '📷' : '—') : `${last.temp_c}°`) : '—';
            return (
              <button
                key={f.id}
                className={`ft-tile ${done ? 'done' : 'due'}${breach ? ' breach' : ''}`}
                onClick={() => setLogTarget(f)}
                title={`${f.name} · safe ${rangeLabel(f)}`}
              >
                <span className="ft-tile-top">
                  <span className="ft-tile-fridge">
                    <Icon name={f.kind === 'freezer' ? 'Snowflake' : 'Refrigerator'} size={13} />
                    {f.name}
                  </span>
                  <span className={`ft-tile-badge ${done ? 'done' : 'due'}${breach ? ' breach' : ''}`}>
                    <Icon name={breach ? 'AlertTriangle' : done ? 'Check' : 'Clock'} size={12} />
                  </span>
                </span>
                <span className={`ft-tile-temp ${tempState}`}>{tempText}</span>
                <span className="ft-tile-sub">{done ? `Logged ${last ? ddmm(last.logged_at) : ''}` : 'Due this week'}</span>
              </button>
            );
          })}
        </div>
      )}

      {logTarget && (
        <LogModal
          fridge={logTarget} tenantId={activeTenantId} userId={userId}
          onClose={() => setLogTarget(null)}
          onSaved={() => { setLogTarget(null); load(); }}
        />
      )}
      {showHistory && <HistoryModal tenantId={activeTenantId} onClose={() => setShowHistory(false)} />}
      {showManage && <ManageModal tenantId={activeTenantId} onClose={() => setShowManage(false)} onSaved={load} />}
      {showScan && <BarcodeScanModal onClose={() => setShowScan(false)} onDetect={onScanned} />}
    </div>
  );
};

export default FridgeTempWidget;
