import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { showToast } from '../../utils/toast';
import BarcodeScanModal from '../inventory/components/BarcodeScanModal';
import { printItemQr } from '../inventory/utils/itemQr';
import {
  fetchFridges, fetchHistory, logReading, uploadFridgePhoto, computeInRange, startOfWeek,
  updateFridge, addFridge, deactivateFridge, updateReading, deleteReading,
} from '../../services/fridgeTemps';
import { exportFridgeTempsPdf } from '../dashboard/utils/fridgeTempsExport';
import '../../styles/editorial.css';
import '../dashboard/components/fridge-temps.css';
import './fridge-temps-page.css';

// ── date helpers ──────────────────────────────────────────────────────────────
const ddmmyyyy = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const hhmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// ISO → value for <input type="datetime-local"> (local time, no seconds).
const toLocalInput = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (val) => (val ? new Date(val).toISOString() : null);
const rangeLabel = (f) => {
  if (f?.safe_min == null && f?.safe_max == null) return 'no range set';
  return `${f?.safe_min ?? '−∞'}–${f?.safe_max ?? '∞'}°C`;
};
const tempState = (r) => (r == null ? 'na' : r.in_range === false ? 'out' : r.in_range ? 'in' : 'na');

// ── Log-a-reading modal ─────────────────────────────────────────────────────
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
          <input type="number" inputMode="decimal" step="0.1" className="ft-tempinput"
            value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="—" autoFocus />
          <span className="ft-tempunit">°C</span>
        </div>
        {outOfRange && <p className="ft-warn"><Icon name="AlertTriangle" size={13} /> Outside safe range ({rangeLabel(fridge)}) — add a note below.</p>}
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
        <textarea className="ft-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. door left ajar, re-checked in 1h…" />

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

// ── Edit-a-reading modal (correct temp / time / note, or delete) ─────────────
const EditReadingModal = ({ reading, onClose, onSaved }) => {
  const [temp, setTemp] = useState(reading.temp_c ?? '');
  const [when, setWhen] = useState(toLocalInput(reading.logged_at));
  const [note, setNote] = useState(reading.note || '');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const inRange = computeInRange(temp, reading.safeMin, reading.safeMax);
  const outOfRange = inRange === false;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateReading(reading.id, {
        tempC: temp, loggedAt: fromLocalInput(when), note,
        safeMin: reading.safeMin, safeMax: reading.safeMax,
      });
      showToast('Reading updated', 'success');
      onSaved?.();
    } catch (err) { showToast(err.message || 'Could not update', 'error'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (removing) return;
    if (!window.confirm('Delete this reading from the log? This cannot be undone.')) return;
    setRemoving(true);
    try { await deleteReading(reading.id); showToast('Reading deleted', 'success'); onSaved?.(); }
    catch (err) { showToast(err.message || 'Could not delete', 'error'); setRemoving(false); }
  };

  return createPortal(
    <div className="ft-modal-scrim" onClick={onClose}>
      <div className="ft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head">
          <div>
            <p className="ft-eyebrow">● Edit reading · {reading.fridgeName}</p>
            <h3 className="ft-modal-title">{ddmmyyyy(reading.logged_at)}</h3>
          </div>
          <button className="ft-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <label className="ft-label">Temperature (°C)</label>
        <div className={`ft-tempwrap${outOfRange ? ' out' : inRange ? ' in' : ''}`}>
          <input type="number" inputMode="decimal" step="0.1" className="ft-tempinput"
            value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="—" />
          <span className="ft-tempunit">°C</span>
        </div>
        {outOfRange && <p className="ft-warn"><Icon name="AlertTriangle" size={13} /> Outside safe range ({rangeLabel({ safe_min: reading.safeMin, safe_max: reading.safeMax })}).</p>}
        {inRange && <p className="ft-ok"><Icon name="Check" size={13} /> Within safe range.</p>}

        <label className="ft-label">Logged at</label>
        <input className="ftp-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />

        <label className="ft-label">Note <em className="ft-opt">optional</em></label>
        <textarea className="ft-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="ft-modal-foot">
          <button className="ft-icon-danger" onClick={remove} disabled={removing} title="Delete reading" style={{ flex: '0 0 auto', width: 44 }}>
            <Icon name="Trash2" size={15} />
          </button>
          <button className="ft-btn ghost" onClick={onClose}>Cancel</button>
          <button className="ft-btn prim" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Add-fridge modal ─────────────────────────────────────────────────────────
const AddFridgeModal = ({ tenantId, nextSort, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('fridge');
  const [location, setLocation] = useState('');
  const [safeMin, setSafeMin] = useState(0);
  const [safeMax, setSafeMax] = useState(5);
  const [saving, setSaving] = useState(false);

  const setKindPreset = (k) => {
    setKind(k);
    if (k === 'freezer') { setSafeMin(-20); setSafeMax(0); } else { setSafeMin(0); setSafeMax(5); }
  };

  const save = async () => {
    if (!name.trim()) { showToast('Give the appliance a name', 'error'); return; }
    setSaving(true);
    try {
      await addFridge(tenantId, {
        name, kind, location,
        safeMin: safeMin === '' ? null : Number(safeMin),
        safeMax: safeMax === '' ? null : Number(safeMax),
        sortOrder: nextSort,
      });
      showToast('Appliance added', 'success');
      onSaved?.();
    } catch (e) { showToast(e.message || 'Could not add', 'error'); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div className="ft-modal-scrim" onClick={onClose}>
      <div className="ft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ft-modal-head">
          <div>
            <p className="ft-eyebrow">● Setup · new appliance</p>
            <h3 className="ft-modal-title">Add fridge / freezer</h3>
          </div>
          <button className="ft-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <label className="ft-label">Name <em className="ft-req">required</em></label>
        <input className="ftp-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Galley Pantry" autoFocus />

        <label className="ft-label">Type</label>
        <div className="ftp-seg">
          <button type="button" className={kind === 'fridge' ? 'on' : ''} onClick={() => setKindPreset('fridge')}><Icon name="Refrigerator" size={14} /> Fridge</button>
          <button type="button" className={kind === 'freezer' ? 'on' : ''} onClick={() => setKindPreset('freezer')}><Icon name="Snowflake" size={14} /> Freezer</button>
        </div>

        <label className="ft-label">Make / model &amp; position <em className="ft-opt">optional</em></label>
        <input className="ftp-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Liebherr IRd 5100 Pure" />

        <label className="ft-label">Safe range (°C)</label>
        <div className="ftp-rangerow">
          <input className="ftp-input" type="number" step="0.1" value={safeMin} onChange={(e) => setSafeMin(e.target.value === '' ? '' : Number(e.target.value))} placeholder="min" />
          <span className="ftp-rangeto">to</span>
          <input className="ftp-input" type="number" step="0.1" value={safeMax} onChange={(e) => setSafeMax(e.target.value === '' ? '' : Number(e.target.value))} placeholder="max" />
        </div>

        <div className="ft-modal-foot">
          <button className="ft-btn ghost" onClick={onClose}>Cancel</button>
          <button className="ft-btn prim" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add appliance'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// Tiny temperature sparkline for an appliance — last readings oldest→newest,
// with a faint safe-range band so a drift toward the edge is visible.
const MiniSpark = ({ temps, safeMin, safeMax }) => {
  const vals = (temps || []).filter((v) => v != null);
  if (vals.length < 2) return <span className="ftp-sparkna">—</span>;
  const lo = Math.min(...vals, safeMin ?? Infinity);
  const hi = Math.max(...vals, safeMax ?? -Infinity);
  const span = hi - lo || 1;
  const W = 108, H = 30, pad = 3;
  const x = (i) => pad + (i / (vals.length - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  const bandTop = safeMax != null ? y(Math.min(safeMax, hi)) : pad;
  const bandBot = safeMin != null ? y(Math.max(safeMin, lo)) : H - pad;
  const last = vals[vals.length - 1];
  const dot = safeMin != null && safeMax != null && (last < safeMin || last > safeMax);
  return (
    <svg className="ftp-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {safeMin != null && safeMax != null && (
        <rect x="0" y={bandTop} width={W} height={Math.max(0, bandBot - bandTop)} fill="#2F855A" fillOpacity="0.08" />
      )}
      <path d={`M${line}`} fill="none" stroke={dot ? '#B42318' : '#2F855A'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={x(vals.length - 1)} cy={y(last)} r="2.1" fill={dot ? '#B42318' : '#2F855A'} />
    </svg>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────
const FridgeTempsPage = () => {
  const navigate = useNavigate();
  const { session, activeTenantId, hasCommandAccess, hasChiefAccess } = useAuth();
  const userId = session?.user?.id;
  const canManage = (typeof hasCommandAccess === 'function' && hasCommandAccess())
    || (typeof hasChiefAccess === 'function' && hasChiefAccess());

  const [fridges, setFridges] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [manageMode, setManageMode] = useState(false);
  const [editRows, setEditRows] = useState({});       // id -> draft fridge
  const [savingId, setSavingId] = useState(null);
  const [logTarget, setLogTarget] = useState(null);
  const [editReading, setEditReading] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterFridge, setFilterFridge] = useState('all');

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [f, h] = await Promise.all([
        fetchFridges(activeTenantId),
        fetchHistory(activeTenantId, { limit: 2000 }),
      ]);
      setFridges(f);
      setHistory(h);
    } finally { setLoading(false); }
  }, [activeTenantId]);
  useEffect(() => { load(); }, [load]);

  // latest reading per fridge (history is newest-first)
  const latestByFridge = useMemo(() => {
    const m = {};
    for (const r of history) if (!m[r.fridge_id]) m[r.fridge_id] = r;
    return m;
  }, [history]);

  // last ~14 typed temps per fridge, oldest→newest, for the sparkline
  const recentByFridge = useMemo(() => {
    const m = {};
    for (const r of history) {
      if (r.temp_c == null) continue;
      (m[r.fridge_id] ||= []).push(Number(r.temp_c)); // newest-first
    }
    Object.keys(m).forEach((k) => { m[k] = m[k].slice(0, 14).reverse(); });
    return m;
  }, [history]);

  const fridgeCount = fridges.filter((f) => f.kind !== 'freezer').length;
  const freezerCount = fridges.filter((f) => f.kind === 'freezer').length;

  const weekStart = useMemo(() => startOfWeek().toISOString(), []);
  const loggedThisWeek = useMemo(() => {
    const s = new Set();
    for (const r of history) if (r.logged_at >= weekStart) s.add(r.fridge_id);
    return s;
  }, [history, weekStart]);

  const doneCount = fridges.filter((f) => loggedThisWeek.has(f.id)).length;
  const breaches = useMemo(() => fridges.filter((f) => latestByFridge[f.id]?.in_range === false).length, [fridges, latestByFridge]);

  const filteredHistory = useMemo(
    () => (filterFridge === 'all' ? history : history.filter((r) => r.fridge_id === filterFridge)),
    [history, filterFridge],
  );

  const doExport = async () => {
    setExporting(true);
    try { await exportFridgeTempsPdf(activeTenantId); }
    catch (e) { showToast(e.message || 'Export failed', 'error'); }
    finally { setExporting(false); }
  };

  const onScanned = (code) => {
    setShowScan(false);
    const val = String(code || '').trim().toUpperCase();
    const f = fridges.find((x) => (x.code || '').toUpperCase() === val || x.name.toUpperCase() === val);
    if (f) setLogTarget(f);
    else showToast('No fridge matches that code', 'error');
  };

  // manage-mode row editing
  const startManage = () => {
    const draft = {};
    fridges.forEach((f) => { draft[f.id] = { ...f }; });
    setEditRows(draft);
    setManageMode(true);
  };
  const patchRow = (id, key, value) => setEditRows((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  const saveRow = async (id) => {
    const f = editRows[id];
    setSavingId(id);
    try {
      await updateFridge(id, {
        name: f.name, kind: f.kind, location: f.location,
        safeMin: f.safe_min === '' ? null : f.safe_min,
        safeMax: f.safe_max === '' ? null : f.safe_max,
      });
      showToast('Saved', 'success');
      await load();
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setSavingId(null); }
  };
  const removeRow = async (f) => {
    if (!window.confirm(`Remove ${f.name}? Its history is kept.`)) return;
    try { await deactivateFridge(f.id); await load(); } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div className="ftp-root">
      <Header />
      <main className="ftp-page">
        <div className="ftp-wrap">
          {/* ── Editorial header ── */}
          <button className="ftp-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ArrowLeft" size={15} /> Dashboard
          </button>
          <div className="ftp-headrow">
            <div>
              <p className="editorial-meta">
                <span className="dot">●</span> FOOD SAFETY
                <span className="bar" /> <span className="muted">THIS WEEK</span>
                <span className="bar" /> <span className="muted">{loading ? '…' : `${doneCount}/${fridges.length} LOGGED`}</span>
                {breaches > 0 && (<><span className="bar" /> <span className="muted" style={{ color: '#B42318' }}>{breaches} OUT OF RANGE</span></>)}
              </p>
              <h1 className="editorial-greeting">
                FRIDGE TEMPS<span className="period">,</span> <em>in check</em><span className="period">.</span>
              </h1>
            </div>
            <div className="ftp-actions">
              <button className="ftp-btn ghost" onClick={() => setShowScan(true)}><Icon name="ScanLine" size={15} /> Scan</button>
              <button className="ftp-btn ghost" onClick={doExport} disabled={exporting}>
                <Icon name="FileDown" size={15} /> {exporting ? 'Exporting…' : 'Export PDF'}
              </button>
              {canManage && !manageMode && (
                <button className="ftp-btn ghost" onClick={startManage}><Icon name="Settings2" size={15} /> Manage</button>
              )}
              {canManage && manageMode && (
                <>
                  <button className="ftp-btn ghost" onClick={() => setShowAdd(true)}><Icon name="Plus" size={15} /> Add</button>
                  <button className="ftp-btn prim" onClick={() => setManageMode(false)}><Icon name="Check" size={15} /> Done</button>
                </>
              )}
            </div>
          </div>

          {/* ── KPI strip ── */}
          <div className="ftp-kpi">
            <div className="ftp-kcell">
              <span className="ftp-kl">This week</span>
              <span className="ftp-knum">{loading ? '—' : `${doneCount}/${fridges.length}`}</span>
              <div className="ftp-kbar">
                <i style={{ flex: Math.max(doneCount, 0.0001), background: '#2F7D5A' }} />
                <i style={{ flex: Math.max(fridges.length - doneCount, 0.0001), background: '#E7E9EF' }} />
              </div>
              <span className="ftp-ksub">{doneCount} logged · {Math.max(fridges.length - doneCount, 0)} due</span>
            </div>
            <div className="ftp-kcell">
              <span className="ftp-kl">Compliance</span>
              <div className="ftp-krow">
                <span className={`ftp-knum ${breaches ? 'red' : ''}`}>{loading ? '—' : breaches === 0 ? 'All clear' : breaches}</span>
                {!loading && (
                  <span className={`ftp-ktag ${breaches ? 'red' : 'green'}`}>
                    <Icon name={breaches ? 'AlertTriangle' : 'ShieldCheck'} size={11} />
                    {breaches ? 'out of range' : 'in range'}
                  </span>
                )}
              </div>
              <span className="ftp-ksub">{history.length} readings on record</span>
            </div>
            <div className="ftp-kcell">
              <span className="ftp-kl">Fleet</span>
              <span className="ftp-knum">{loading ? '—' : fridges.length}</span>
              <span className="ftp-ksub">{fridgeCount} fridge{fridgeCount !== 1 ? 's' : ''} · {freezerCount} freezer{freezerCount !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* ── Appliance board ── */}
          <section className="ftp-section">
            <p className="ftp-label">Appliances</p>
            {loading ? (
              <div className="ftp-skel" />
            ) : fridges.length === 0 ? (
              <p className="ftp-empty">No appliances set up yet.{canManage ? ' Use “Manage” → “Add” to create one.' : ''}</p>
            ) : (
              <div className="ftp-board">
                {fridges.map((f) => {
                  const last = latestByFridge[f.id];
                  const done = loggedThisWeek.has(f.id);
                  const breach = last?.in_range === false;
                  const st = tempState(last);
                  const draft = editRows[f.id] || f;
                  if (manageMode) {
                    return (
                      <div key={f.id} className="ftp-mrow">
                        <input className="ftp-input ftp-mname" value={draft.name || ''} onChange={(e) => patchRow(f.id, 'name', e.target.value)} placeholder="Name" />
                        <select className="ftp-input ftp-mkind" value={draft.kind} onChange={(e) => patchRow(f.id, 'kind', e.target.value)}>
                          <option value="fridge">Fridge</option>
                          <option value="freezer">Freezer</option>
                        </select>
                        <input className="ftp-input ftp-mloc" value={draft.location || ''} onChange={(e) => patchRow(f.id, 'location', e.target.value)} placeholder="Make / model" />
                        <input className="ftp-input ftp-mnum" type="number" step="0.1" value={draft.safe_min ?? ''} placeholder="min" onChange={(e) => patchRow(f.id, 'safe_min', e.target.value === '' ? null : Number(e.target.value))} />
                        <input className="ftp-input ftp-mnum" type="number" step="0.1" value={draft.safe_max ?? ''} placeholder="max" onChange={(e) => patchRow(f.id, 'safe_max', e.target.value === '' ? null : Number(e.target.value))} />
                        <button className="ftp-iconbtn" onClick={() => printItemQr({ code: f.code, name: f.name, location: 'Fridge temp log' })} title="Print QR label"><Icon name="QrCode" size={15} /></button>
                        <button className="ftp-btn prim sm" onClick={() => saveRow(f.id)} disabled={savingId === f.id}>{savingId === f.id ? '…' : 'Save'}</button>
                        <button className="ft-icon-danger" onClick={() => removeRow(f)} title="Remove"><Icon name="Trash2" size={14} /></button>
                      </div>
                    );
                  }
                  return (
                    <div key={f.id} className={`ftp-arow${breach ? ' breach' : ''}`}>
                      <span className="ftp-aicon"><Icon name={f.kind === 'freezer' ? 'Snowflake' : 'Refrigerator'} size={18} /></span>
                      <div className="ftp-ainfo">
                        <span className="ftp-aname">{f.name}</span>
                        <span className="ftp-ameta">
                          {f.kind === 'freezer' ? 'Freezer' : 'Fridge'} · safe {rangeLabel(f)}
                          {f.location ? ` · ${f.location}` : ''}
                        </span>
                      </div>
                      <div className="ftp-atrend" title="Recent readings">
                        <MiniSpark temps={recentByFridge[f.id]} safeMin={f.safe_min} safeMax={f.safe_max} />
                      </div>
                      <div className="ftp-alast">
                        <span className={`ftp-atemp ${st}`}>{last ? (last.temp_c == null ? (last.photo_url ? '📷' : '—') : `${last.temp_c}°`) : '—'}</span>
                        <span className="ftp-awhen">{last ? `${ddmmyyyy(last.logged_at)} ${hhmm(last.logged_at)}` : 'no readings'}</span>
                      </div>
                      <span className={`ftp-badge ${breach ? 'breach' : done ? 'done' : 'due'}`}>
                        <Icon name={breach ? 'AlertTriangle' : done ? 'Check' : 'Clock'} size={12} />
                        {breach ? 'Out of range' : done ? 'Logged' : 'Due'}
                      </span>
                      <button className="ftp-btn prim sm" onClick={() => setLogTarget(f)}><Icon name="Plus" size={14} /> Log</button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Full log ── */}
          <section className="ftp-section">
            <div className="ftp-loghead">
              <p className="ftp-label">Temperature log</p>
              <select className="ftp-input ftp-filter" value={filterFridge} onChange={(e) => setFilterFridge(e.target.value)}>
                <option value="all">All appliances</option>
                {fridges.map((f) => <option key={f.id} value={f.id}>{f.name}{f.kind === 'freezer' ? ' (freezer)' : ''}</option>)}
              </select>
            </div>
            {loading ? (
              <div className="ftp-skel" />
            ) : filteredHistory.length === 0 ? (
              <p className="ftp-empty">No readings logged yet.</p>
            ) : (
              <div className="ftp-log">
                <div className="ftp-logrow ftp-loghd">
                  <span>Date</span><span>Time</span><span>Appliance</span><span>Temp</span><span>Status</span><span>Logged by</span><span>Note</span><span />
                </div>
                {filteredHistory.map((r) => (
                  <div key={r.id} className="ftp-logrow">
                    <span>{ddmmyyyy(r.logged_at)}</span>
                    <span>{hhmm(r.logged_at)}</span>
                    <span className="ftp-lname">{r.fridgeName}</span>
                    <span className={`ftp-ltemp ${tempState(r)}`}>{r.temp_c == null ? (r.photo_url ? 'photo' : '—') : `${r.temp_c}°`}</span>
                    <span>
                      <span className={`ftp-pill ${r.in_range === false ? 'out' : r.in_range ? 'in' : 'na'}`}>
                        {r.in_range == null ? '—' : r.in_range ? 'In range' : 'Out of range'}
                      </span>
                    </span>
                    <span className="ftp-lby">{r.loggedByName || '—'}</span>
                    <span className="ftp-lnote" title={r.note || ''}>{r.note || ''}</span>
                    <span className="ftp-lact">
                      {r.photo_url && <a className="ftp-iconbtn" href={r.photo_url} target="_blank" rel="noreferrer" title="View photo"><Icon name="Image" size={14} /></a>}
                      {canManage && <button className="ftp-iconbtn" onClick={() => setEditReading(r)} title="Edit reading"><Icon name="Pencil" size={14} /></button>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {logTarget && (
        <LogModal fridge={logTarget} tenantId={activeTenantId} userId={userId}
          onClose={() => setLogTarget(null)} onSaved={() => { setLogTarget(null); load(); }} />
      )}
      {editReading && (
        <EditReadingModal reading={editReading}
          onClose={() => setEditReading(null)} onSaved={() => { setEditReading(null); load(); }} />
      )}
      {showAdd && (
        <AddFridgeModal tenantId={activeTenantId} nextSort={fridges.length}
          onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load().then(startManage); }} />
      )}
      {showScan && <BarcodeScanModal onClose={() => setShowScan(false)} onDetect={onScanned} />}
    </div>
  );
};

export default FridgeTempsPage;
