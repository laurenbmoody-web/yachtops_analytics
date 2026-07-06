// Vessel status — a first-class dashboard widget (matches the editorial card
// system: eyebrow + DM Serif noun title + hero icon + clean rows, no pills).
// It's the master's vessel-wide record of what the vessel is doing, which is the
// first source of truth for how each crew member's sea-service day is classified.
// Command taps a row to set the current status; a portaled modal logs a known
// past period (a refit, a long port stay) and shows the history. Crew see it
// read-only.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselStatusTimeline, setVesselStatus } from '../../crew-profile/utils/seaTimeService';
import './vessel-status-widget.css';

// Calm, low-saturation tints (shared with the sea-time service-type palette) so
// the four states read as a family; terracotta stays reserved as the one accent.
const STATES = [
  { key: 'UNDERWAY', label: 'Underway',  icon: 'Waves',     note: 'Counts as sea time', ink: '#2F6080', bg: '#E8EFF4' },
  { key: 'ANCHOR',   label: 'At anchor', icon: 'Anchor',    note: 'Counts as standby',  ink: '#A6712C', bg: '#F5ECDA' },
  { key: 'IN_PORT',  label: 'In port',   icon: 'Building2', note: 'Counts as standby',  ink: '#4F5D8A', bg: '#ECEEF6' },
  { key: 'IN_YARD',  label: 'In yard',   icon: 'Wrench',    note: 'Counts as yard time', ink: '#6E665C', bg: '#F1EFEA' },
];
const byKey = Object.fromEntries(STATES.map(s => [s.key, s]));

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtUk = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };

// Surface the RPC's lock/permission messages; generic fallback otherwise.
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
    <div className="ce-card rounded-xl p-5 vsw">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="ce-eyebrow"><span className="dot">●</span> VESSEL · STATUS</p>
          <h3 className="ce-title">{loading ? 'Loading…' : cur ? cur.label : 'Not set'}</h3>
          {!loading && (
            <p className={`ce-status${cur ? '' : ' is-attention'}`}>
              {cur
                ? (current.effective_to ? `Until ${fmtUk(current.effective_to)}` : `Since ${fmtUk(current.effective_from)}`)
                : 'Days count as sea time until you set this'}
            </p>
          )}
        </div>
        <div className="vsw-hero" style={{ background: cur?.bg || '#F1EFEA', color: cur?.ink || '#AEB4C2' }}>
          <Icon name={cur ? cur.icon : 'HelpCircle'} className="w-6 h-6" />
        </div>
      </div>

      {isCommand ? (
        <>
          <p className="vsw-label">Set the current status</p>
          <div className="vsw-rows">
            {STATES.map(s => {
              const active = cur?.key === s.key;
              const saving = savingKey === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={!!savingKey || active}
                  className={`vsw-row${active ? ' is-active' : ''}`}
                  onClick={() => setNow(s.key)}
                >
                  <span className="vsw-row-ico" style={{ background: s.bg, color: s.ink }}><Icon name={s.icon} className="w-4 h-4" /></span>
                  <span className="vsw-row-text">
                    <span className="vsw-row-label">{s.label}</span>
                    <span className="vsw-row-note">{s.note}</span>
                  </span>
                  {saving ? <Icon name="Loader2" className="w-4 h-4 vsw-spin" />
                    : active ? <span className="vsw-row-now">Now</span> : <Icon name="ChevronRight" className="w-4 h-4 vsw-row-go" />}
                </button>
              );
            })}
          </div>
          {err && <p className="vsw-err">{err}</p>}
          <div className="vsw-links">
            <button type="button" className="ce-link" onClick={() => setModal('log')}>Log a past period</button>
            {timeline.length > 0 && <button type="button" className="ce-link" onClick={() => setModal('history')}>History</button>}
          </div>
        </>
      ) : (
        <p className="vsw-readonly">
          {cur ? 'Set by the captain — this is what the vessel was doing on each service day.' : 'The captain hasn’t set the vessel status yet.'}
        </p>
      )}

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
                    style={on ? { borderColor: s.ink, background: s.bg } : undefined}
                    onClick={() => setForm(f => ({ ...f, status: s.key }))}>
                    <span className="vsw-state-ico" style={{ color: s.ink }}><Icon name={s.icon} className="w-4 h-4" /></span>
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
                      <span className="vsw-tl-ico" style={{ background: s.bg || '#F1EFEA', color: s.ink || '#8B8478' }}><Icon name={s.icon || 'Circle'} className="w-4 h-4" /></span>
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
