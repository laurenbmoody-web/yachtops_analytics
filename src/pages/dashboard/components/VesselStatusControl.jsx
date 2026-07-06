// Vessel status control — the master's one-tap record of what the vessel is
// doing (Underway / At anchor / In port / In yard). This is the FIRST source of
// truth for how each crew member's sea-service day is classified, so it lives on
// the command dashboard. Crew see it read-only; only COMMAND can change it.
//
// Setting the CURRENT status is one tap (applies from today, open-ended). A
// range editor logs a known past period (a refit, a long port stay) and requires
// a reason. Periods that overlap already signed-off service are locked and can't
// be changed. All writes go through set_vessel_status (append-only + audited).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselStatusTimeline, setVesselStatus } from '../../crew-profile/utils/seaTimeService';
import './vessel-status-control.css';

// Status metadata mirrors the sea-time service-type palette so the mental map is
// intuitive: underway→seagoing blue, anchor/port→standby sand/slate, yard→yard.
const STATUS = {
  UNDERWAY: { label: 'Underway',  ink: '#2F6080', bg: '#E8EFF4', hint: 'At sea on passage — counts as seagoing service.' },
  ANCHOR:   { label: 'At anchor', ink: '#A6712C', bg: '#F5ECDA', hint: 'At anchor — counts as standby, not seagoing.' },
  IN_PORT:  { label: 'In port',   ink: '#4F5D8A', bg: '#ECEEF6', hint: 'Alongside / in port — counts as standby, not seagoing.' },
  IN_YARD:  { label: 'In yard',   ink: '#6E665C', bg: '#F1EFEA', hint: 'Shipyard / refit — counts as yard service (capped).' },
};
const ORDER = ['UNDERWAY', 'ANCHOR', 'IN_PORT', 'IN_YARD'];

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };

/**
 * @param {Object} p
 * @param {string} p.tenantId  the active vessel's tenant id
 */
const VesselStatusControl = ({ tenantId }) => {
  const { currentTenantMember } = useTenant() || {};
  const isCommand = String(currentTenantMember?.permission_tier || currentTenantMember?.role || '').toUpperCase() === 'COMMAND';

  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('current');   // 'current' | 'range'
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [range, setRange] = useState({ status: 'IN_YARD', from: '', to: '', reason: '' });
  const rootRef = useRef(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try { setTimeline(await fetchVesselStatusTimeline(tenantId)); }
    catch (e) { console.error('[vessel-status] load', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // The period covering today = the current status (open-ended or spanning today).
  const current = useMemo(() => {
    const t = todayIso();
    return timeline.find(p => p.effective_from <= t && (p.effective_to == null || p.effective_to >= t)) || null;
  }, [timeline]);
  const meta = current ? STATUS[current.status] : null;

  const applyCurrent = async (status) => {
    setErr(''); setSaving(true);
    try {
      await setVesselStatus(tenantId, { status, from: todayIso(), to: null, note: note.trim() || null });
      setNote(''); setOpen(false);
      await load();
    } catch (e) { setErr(friendly(e)); }
    finally { setSaving(false); }
  };

  const applyRange = async () => {
    setErr('');
    if (!range.from || !range.to) { setErr('Enter both a start and end date.'); return; }
    if (range.to < range.from) { setErr('The end date is before the start date.'); return; }
    if (!range.reason.trim()) { setErr('Add a short reason for logging a past period.'); return; }
    setSaving(true);
    try {
      await setVesselStatus(tenantId, { status: range.status, from: range.from, to: range.to, reason: range.reason.trim() });
      setRange({ status: 'IN_YARD', from: '', to: '', reason: '' }); setMode('current'); setOpen(false);
      await load();
    } catch (e) { setErr(friendly(e)); }
    finally { setSaving(false); }
  };

  if (!tenantId) return null;

  const pill = (
    <span className="vsc-pill" style={{ color: meta?.ink || '#8B8478', background: meta?.bg || '#F6F5F2' }}>
      <i className="vsc-dot" style={{ background: meta?.ink || '#AEB4C2' }} />
      {meta ? meta.label : (loading ? 'Loading…' : 'Not set')}
    </span>
  );

  return (
    <div className="vsc" ref={rootRef}>
      <div className="vsc-row">
        <span className="vsc-label">Vessel status</span>
        {isCommand ? (
          <button type="button" className={`vsc-trigger${open ? ' on' : ''}`} onClick={() => { setOpen(o => !o); setErr(''); }}>
            {pill}
            <Icon name="ChevronDown" size={14} />
          </button>
        ) : pill}
      </div>
      {current && (
        <div className="vsc-since">
          {current.effective_to
            ? <>from {fmtUk(current.effective_from)} to {fmtUk(current.effective_to)}</>
            : <>since {fmtUk(current.effective_from)}</>}
          {current.set_by_name ? <> · set by {current.set_by_name}</> : null}
          {!isCommand ? <> · set by the captain</> : null}
        </div>
      )}
      {!current && !loading && isCommand && (
        <div className="vsc-since vsc-warn">Not set — days default to seagoing until you log the vessel’s status.</div>
      )}

      {open && isCommand && (
        <div className="vsc-pop">
          <div className="vsc-tabs">
            <button type="button" className={mode === 'current' ? 'on' : ''} onClick={() => { setMode('current'); setErr(''); }}>Current status</button>
            <button type="button" className={mode === 'range' ? 'on' : ''} onClick={() => { setMode('range'); setErr(''); }}>Log a past period</button>
          </div>

          {mode === 'current' ? (
            <>
              <div className="vsc-poplabel">Set what the vessel is doing now <span className="vsc-faint">from today</span></div>
              <div className="vsc-opts">
                {ORDER.map(s => {
                  const m = STATUS[s]; const isNow = current?.status === s && current?.effective_to == null;
                  return (
                    <button key={s} type="button" className={`vsc-opt${isNow ? ' cur' : ''}`} disabled={saving} onClick={() => applyCurrent(s)}>
                      <span className="vsc-optpill" style={{ color: m.ink, background: m.bg }}><i className="vsc-dot" style={{ background: m.ink }} />{m.label}</span>
                      <span className="vsc-opthint">{m.hint}</span>
                      {isNow && <Icon name="Check" size={14} />}
                    </button>
                  );
                })}
              </div>
              <input className="vsc-input" placeholder="Note (optional) — e.g. departed Palma for Corsica" value={note} onChange={e => setNote(e.target.value)} />
            </>
          ) : (
            <>
              <div className="vsc-poplabel">Log a known period <span className="vsc-faint">e.g. a refit or a long port stay</span></div>
              <div className="vsc-opts vsc-opts-compact">
                {ORDER.map(s => {
                  const m = STATUS[s]; const sel = range.status === s;
                  return (
                    <button key={s} type="button" className={`vsc-chip${sel ? ' on' : ''}`} style={sel ? { color: '#fff', background: m.ink, borderColor: m.ink } : { color: m.ink }} onClick={() => setRange(r => ({ ...r, status: s }))}>{m.label}</button>
                  );
                })}
              </div>
              <div className="vsc-dates">
                <label>From <input type="date" value={range.from} max={range.to || todayIso()} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></label>
                <label>To <input type="date" value={range.to} min={range.from} max={todayIso()} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></label>
              </div>
              <input className="vsc-input" placeholder="Reason (required) — why this is being logged now" value={range.reason} onChange={e => setRange(r => ({ ...r, reason: e.target.value }))} />
              <button type="button" className="vsc-save" disabled={saving} onClick={applyRange}>{saving ? 'Saving…' : 'Log period'}</button>
            </>
          )}

          {err && <div className="vsc-err">{err}</div>}

          {timeline.length > 0 && (
            <div className="vsc-timeline">
              <div className="vsc-tl-h">Recent history</div>
              {timeline.slice(0, 5).map(p => {
                const m = STATUS[p.status] || {};
                return (
                  <div key={p.id} className="vsc-tl-row">
                    <span className="vsc-tl-pill" style={{ color: m.ink, background: m.bg }}>{m.label || p.status}</span>
                    <span className="vsc-tl-dates">{fmtUk(p.effective_from)} – {p.effective_to ? fmtUk(p.effective_to) : 'now'}</span>
                    {p.locked && <span className="vsc-tl-lock" title="Overlaps signed-off service — locked"><Icon name="Lock" size={11} /> signed</span>}
                  </div>
                );
              })}
              <div className="vsc-tl-note">Changes are recorded with your name. Periods covering signed-off service are locked.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Surface the RPC's lock/permission messages verbatim; generic fallback otherwise.
const friendly = (e) => {
  const msg = e?.message || e?.error_description || '';
  if (/signed-off|locked/i.test(msg)) return msg.replace(/^.*?:\s*/, '');
  if (/command crew/i.test(msg)) return 'Only command crew can change the vessel status.';
  if (msg) return msg.replace(/^.*?:\s*/, '');
  return 'Could not save — please try again.';
};

export default VesselStatusControl;
