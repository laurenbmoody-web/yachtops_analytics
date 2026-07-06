// Vessel status — a thin, single-row dashboard widget. It's the master's
// vessel-wide record of what the vessel is doing, the first source of truth for
// how each crew member's sea-service day is classified. Command taps a state
// icon to set the current status (one tap, from today); a "…" opens a modal to
// log a known past period or view the history. Crew see it read-only.
// Monochrome — the state is carried by the icon + word, not colour.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselStatusTimeline, setVesselStatus } from '../../crew-profile/utils/seaTimeService';
import './vessel-status-widget.css';

const STATES = [
  { key: 'UNDERWAY', label: 'Underway',  icon: 'Compass',     note: 'counts as sea time' },
  { key: 'ANCHOR',   label: 'At anchor', icon: 'Anchor',      note: 'counts as standby' },
  { key: 'IN_PORT',  label: 'In port',   icon: 'WavesLadder', note: 'counts as standby' },
  { key: 'IN_YARD',  label: 'In yard',   icon: 'Wrench',      note: 'counts as yard time' },
];
const byKey = Object.fromEntries(STATES.map(s => [s.key, s]));

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };

const friendly = (e) => {
  const msg = e?.message || e?.error_description || '';
  if (/signed-off|locked/i.test(msg)) return msg.replace(/^.*?:\s*/, '');
  if (/command crew/i.test(msg)) return 'Only the captain can change the vessel status.';
  if (msg) return msg.replace(/^.*?:\s*/, '');
  return 'Could not save — please try again.';
};

const VesselStatusWidget = ({ tenantId }) => {
  const { currentTenantMember } = useTenant() || {};
  const isCommand = String(currentTenantMember?.permission_tier || currentTenantMember?.role || '').toUpperCase() === 'COMMAND';

  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null); // 'log' | 'history' | null

  const load = async () => {
    if (!tenantId) return;
    try { setTimeline(await fetchVesselStatusTimeline(tenantId)); }
    catch (e) { console.error('[vessel-status] load', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const current = useMemo(() => {
    const t = todayIso();
    return timeline.find(p => p.effective_from <= t && (p.effective_to == null || p.effective_to >= t)) || null;
  }, [timeline]);
  const cur = current ? byKey[current.status] : null;

  const setNow = async (key) => {
    setErr(''); setSavingKey(key);
    try { await setVesselStatus(tenantId, { status: key, from: todayIso(), to: null }); await load(); }
    catch (e) { setErr(friendly(e)); }
    finally { setSavingKey(null); }
  };

  if (!tenantId) return null;

  return (
    <div className="ce-card vsw-bar">
      <div className="vsw-bar-row">
        <span className="vsw-eyebrow">Vessel<br />status</span>
        <span className="vsw-cur">
          {loading ? (
            <span className="vsw-cur-muted">Loading…</span>
          ) : cur ? (
            <>
              <Icon name={cur.icon} className="vsw-cur-ico" />
              <b>{cur.label}</b>
              <span className="vsw-since">· since {fmtUk(current.effective_from)}</span>
            </>
          ) : (
            <>
              <Icon name="Ship" className="vsw-cur-ico vsw-cur-off" />
              <b className="vsw-cur-off">Not set</b>
              <span className="vsw-since vsw-cur-off">· days count as sea time</span>
            </>
          )}
        </span>

        {isCommand && (
          <div className="vsw-switch">
            {STATES.map(s => {
              const active = cur?.key === s.key;
              const saving = savingKey === s.key;
              return (
                <span className="vsw-tipwrap" key={s.key}>
                  <button
                    type="button"
                    className={`vsw-sw${active ? ' on' : ''}`}
                    disabled={!!savingKey || active}
                    onClick={() => setNow(s.key)}
                    aria-label={s.label}
                  >
                    <Icon name={saving ? 'Loader2' : s.icon} className={`vsw-sw-ico${saving ? ' vsw-spin' : ''}`} />
                  </button>
                  <span className="vsw-tip">{s.label} · {s.note}</span>
                </span>
              );
            })}
            <span className="vsw-sep" />
            <span className="vsw-tipwrap">
              <button type="button" className="vsw-sw vsw-more" onClick={() => setModal('log')} aria-label="Log a past period or view history">
                <Icon name="MoreHorizontal" className="vsw-sw-ico" />
              </button>
              <span className="vsw-tip vsw-tip-r">Log a past period · history</span>
            </span>
          </div>
        )}
      </div>
      {err && <div className="vsw-bar-err">{err}</div>}

      {modal && createPortal(
        <VesselStatusModal
          mode={modal}
          tenantId={tenantId}
          timeline={timeline}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await load(); }}
        />,
        document.body,
      )}
    </div>
  );
};

const VesselStatusModal = ({ mode, tenantId, timeline, onClose, onSaved }) => {
  const [tab, setTab] = useState(mode === 'history' ? 'history' : 'log');
  const [form, setForm] = useState({ status: 'IN_YARD', from: '', to: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setErr('');
    if (!form.from || !form.to) { setErr('Enter both a start and end date.'); return; }
    if (form.to < form.from) { setErr('The end date is before the start date.'); return; }
    if (!form.reason.trim()) { setErr('Add a short reason — it’s kept on the record.'); return; }
    setSaving(true);
    try { await setVesselStatus(tenantId, { status: form.status, from: form.from, to: form.to, reason: form.reason.trim() }); onSaved(); }
    catch (e) { setErr(friendly(e)); setSaving(false); }
  };

  return (
    <div className="vsw-scrim" onMouseDown={onClose}>
      <div className="vsw-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="vsw-modal-head">
          <div>
            <p className="vsw-modal-eyebrow"><span className="dot">●</span> VESSEL · STATUS</p>
            <h2 className="vsw-modal-title">{tab === 'log' ? 'Log a past period' : 'Status history'}</h2>
          </div>
          <button className="vsw-modal-x" onClick={onClose} aria-label="Close"><Icon name="X" className="w-4 h-4" /></button>
        </div>

        <div className="vsw-modal-tabs">
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log a period</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
        </div>

        {tab === 'log' ? (
          <div className="vsw-modal-body">
            <p className="vsw-help">Record a known period — a refit, a long stay in port — for the exact dates the vessel was in that state. Everyone aboard is classified from it.</p>

            <p className="vsw-flabel">What was the vessel doing?</p>
            <div className="vsw-state-grid">
              {STATES.map(s => {
                const on = form.status === s.key;
                return (
                  <button key={s.key} type="button" className={`vsw-state-opt${on ? ' on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, status: s.key }))}>
                    <span className="vsw-state-ico"><Icon name={s.icon} className="w-4 h-4" /></span>
                    <span className="vsw-state-label">{s.label}</span>
                    <span className="vsw-state-note">{s.note}</span>
                  </button>
                );
              })}
            </div>

            <div className="vsw-dates">
              <label>From<input type="date" max={form.to || todayIso()} value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></label>
              <label>To<input type="date" min={form.from} max={todayIso()} value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></label>
            </div>

            <p className="vsw-flabel">Reason <span className="req">required</span></p>
            <input className="vsw-input" placeholder="e.g. Winter refit at MB92, Barcelona" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />

            {err && <p className="vsw-err">{err}</p>}
            <button className="vsw-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Log period'}</button>
            <p className="vsw-foot">Saved with your name. You can’t change a period that already covers signed-off service.</p>
          </div>
        ) : (
          <div className="vsw-modal-body">
            {timeline.length === 0 ? (
              <p className="vsw-help">No status history yet.</p>
            ) : (
              <div className="vsw-tl">
                {timeline.map(p => {
                  const s = byKey[p.status] || {};
                  return (
                    <div key={p.id} className="vsw-tl-row">
                      <span className="vsw-tl-ico"><Icon name={s.icon || 'Circle'} className="w-4 h-4" /></span>
                      <span className="vsw-tl-main">
                        <span className="vsw-tl-label">{s.label || p.status}</span>
                        <span className="vsw-tl-dates">{fmtUk(p.effective_from)} – {p.effective_to ? fmtUk(p.effective_to) : 'now'}{p.set_by_name ? ` · ${p.set_by_name}` : ''}</span>
                      </span>
                      {p.locked && <span className="vsw-tl-lock"><Icon name="Lock" className="w-3 h-3" /> Signed</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="vsw-foot">Every change is recorded with the setter’s name. Periods covering signed-off service are locked and can’t be altered.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VesselStatusWidget;
