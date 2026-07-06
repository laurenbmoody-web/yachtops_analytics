// Vessel status — a boxless, editorial masthead. Reads as "UNDERWAY, since 6th
// July" in the Cargo two-tone serif (upright navy word + italic terracotta
// accent) using the shared .ce-title / .accent classes so it matches the other
// editorial headlines AND renders in real DM Serif Display (those classes are
// scoped under .cargo-editorial, which beats the global `span { … }` font rule
// that would otherwise force Plus Jakarta). The deep-navy chip is the picker:
// tap it to change the status, log a past period, or view history. Crew read-only.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { EditorialDatePicker } from '../../../components/editorial';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchVesselStatusTimeline, setVesselStatus } from '../../crew-profile/utils/seaTimeService';
import './vessel-status-widget.css';

const STATES = [
  { key: 'UNDERWAY', label: 'Underway',   icon: 'Compass',     note: 'Counts as sea time' },
  { key: 'ANCHOR',   label: 'Anchored',   icon: 'Anchor',      note: 'Counts as standby' },
  { key: 'IN_PORT',  label: 'In port',    icon: 'WavesLadder', note: 'Counts as standby' },
  { key: 'IN_YARD',  label: 'In shipyard', icon: 'Wrench',     note: 'Counts as yard time' },
];
const byKey = Object.fromEntries(STATES.map(s => [s.key, s]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ordinal = (n) => { const v = n % 100; if (v >= 11 && v <= 13) return 'th'; return ['th', 'st', 'nd', 'rd'][n % 10] || 'th'; };
const todayIso = () => new Date().toISOString().slice(0, 10);
const editorial = (iso) => { if (!iso) return null; const [, m, d] = iso.split('-').map(Number); return { d, suf: ordinal(d), mon: MONTHS[m - 1] }; };
const fmtShort = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON_SHORT[m - 1]} ${y}`; };
const fmtDayMon = (iso) => { if (!iso) return ''; const [, m, d] = iso.split('-').map(Number); return `${d} ${MON_SHORT[m - 1]}`; };
const fmtDMY = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`; };
// Editorial date range: collapse the shared year ("3 Jan – 18 Jan 2026"); an
// open-ended period reads "Since 3 Jan 2026".
const rangeLabel = (fromIso, toIso) => {
  if (!toIso) return `Since ${fmtShort(fromIso)}`;
  const sameYear = fromIso.slice(0, 4) === toIso.slice(0, 4);
  return `${sameYear ? fmtDayMon(fromIso) : fmtShort(fromIso)} – ${fmtShort(toIso)}`;
};
const spanDays = (fromIso, toIso) => {
  const a = new Date(fromIso + 'T00:00:00');
  const b = new Date((toIso || todayIso()) + 'T00:00:00');
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'log' | 'history' | null
  const rootRef = useRef(null);

  const load = async () => {
    if (!tenantId) return;
    try { setTimeline(await fetchVesselStatusTimeline(tenantId)); }
    catch (e) { console.error('[vessel-status] load', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = useMemo(() => {
    const t = todayIso();
    return timeline.find(p => p.effective_from <= t && (p.effective_to == null || p.effective_to >= t)) || null;
  }, [timeline]);
  const cur = current ? byKey[current.status] : null;
  const ed = current ? editorial(current.effective_from) : null;

  const setNow = async (key) => {
    if (key === cur?.key) { setOpen(false); return; }
    setErr(''); setSaving(true);
    try { await setVesselStatus(tenantId, { status: key, from: todayIso(), to: null }); setOpen(false); await load(); }
    catch (e) { setErr(friendly(e)); }
    finally { setSaving(false); }
  };

  if (!tenantId) return null;
  const chipIcon = cur ? cur.icon : 'Ship';

  return (
    <div className="vsw" ref={rootRef}>
      <div className="vsw-head">
        {isCommand ? (
          <button
            type="button"
            className={`vsw-chip${open ? ' is-open' : ''}`}
            onClick={() => { setOpen(o => !o); setErr(''); }}
            aria-haspopup="menu" aria-expanded={open} aria-label="Change vessel status"
          >
            <Icon name={chipIcon} className="vsw-chip-ic" />
          </button>
        ) : (
          <span className="vsw-chip vsw-chip-static"><Icon name={chipIcon} className="vsw-chip-ic" /></span>
        )}

        <div className="vsw-title-wrap">
          {loading ? (
            <span className="vsw-loading">Loading…</span>
          ) : cur ? (
            <div className="ce-title vsw-title">
              {cur.label.toUpperCase()},{' '}
              <span className="accent">since {ed.d}<sup>{ed.suf}</sup> {ed.mon}</span>
            </div>
          ) : (
            <div className="ce-title vsw-title vsw-notset">NOT SET</div>
          )}
        </div>
      </div>

      {!loading && !cur && isCommand && <div className="vsw-hint">Set the vessel’s status — days count as sea time until you do.</div>}
      {!isCommand && cur && <div className="vsw-hint vsw-hint-quiet">Set by the captain</div>}
      {err && <div className="vsw-err">{err}</div>}

      {open && isCommand && (
        <div className="vsw-picker" role="menu">
          <div className="vsw-picker-hd">Set vessel status</div>
          {STATES.map(s => {
            const active = cur?.key === s.key;
            return (
              <button key={s.key} type="button" role="menuitem" className={`vsw-row${active ? ' cur' : ''}`} disabled={saving} onClick={() => setNow(s.key)}>
                <span className="vsw-row-ic"><Icon name={s.icon} className="vsw-ic18" /></span>
                <span className="vsw-row-text">
                  <span className="vsw-row-label">{s.label}</span>
                  <span className="vsw-row-note">{s.note}</span>
                </span>
                {active && <span className="vsw-row-check"><Icon name="Check" className="vsw-ic17" /></span>}
              </button>
            );
          })}
          <div className="vsw-picker-ft">
            <button type="button" className="vsw-ft-link" onClick={() => { setOpen(false); setModal('log'); }}>Log a past period</button>
            <button type="button" className="vsw-ft-link" onClick={() => { setOpen(false); setModal('history'); }}>
              <Icon name="Clock" className="vsw-ic14" /> History
            </button>
          </div>
        </div>
      )}

      {modal && createPortal(
        <VesselStatusModal
          mode={modal} tenantId={tenantId} timeline={timeline}
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

  // Already-logged spans, dotted on the calendar. An open-ended (current) period
  // is capped at today so it doesn't flood every future day with a marker.
  const markedRanges = useMemo(
    () => timeline.map(p => ({ from: p.effective_from, to: p.effective_to || todayIso() })),
    [timeline],
  );

  // Does the chosen [from, to] land on any existing period? If so we warn and
  // relabel the button — logging splices over the overlap (the untouched
  // remainder of each period stays). `days` totals the overwritten days; `period`
  // is the largest-overlap one, named in the notice.
  const overlap = useMemo(() => {
    if (!form.from || !form.to || form.to < form.from) return null;
    let total = 0, best = null;
    for (const p of timeline) {
      const pf = p.effective_from, pt = p.effective_to || todayIso();
      const lo = form.from > pf ? form.from : pf;
      const hi = form.to < pt ? form.to : pt;
      if (lo <= hi) {
        const d = spanDays(lo, hi);
        total += d;
        if (!best || d > best.d) best = { p, d };
      }
    }
    return total ? { days: total, period: best.p } : null;
  }, [form.from, form.to, timeline]);

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
    // Store the free-text as the period's `note` (shown on the timeline) AND as
    // the audit `reason` (the immutable why-it-changed trail). Same text, both
    // homes — previously it only went to the audit, so the history looked bare.
    try { await setVesselStatus(tenantId, { status: form.status, from: form.from, to: form.to, note: form.reason.trim(), reason: form.reason.trim() }); onSaved(); }
    catch (e) { setErr(friendly(e)); setSaving(false); }
  };

  return (
    <div className="vsw-scrim" onMouseDown={onClose}>
      <div className="vsw-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="vsw-modal-head">
          <h2 className="vsw-modal-title">
            {tab === 'log'
              ? <>Log a <span className="accent">past period</span></>
              : <>Status <span className="accent">history</span></>}
          </h2>
          <button className="vsw-modal-x" onClick={onClose} aria-label="Close"><Icon name="X" className="vsw-ic16" /></button>
        </div>

        <div className="vsw-modal-tabs">
          <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log a period</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>
        </div>

        {tab === 'log' ? (
          <div className="vsw-modal-body">
            <p className="vsw-flabel">What was the vessel doing?</p>
            <div className="vsw-state-grid">
              {STATES.map(s => {
                const on = form.status === s.key;
                return (
                  <button key={s.key} type="button" className={`vsw-state-opt${on ? ' on' : ''}`} onClick={() => setForm(f => ({ ...f, status: s.key }))}>
                    <span className="vsw-state-ico"><Icon name={s.icon} className="vsw-ic18" /></span>
                    <span className="vsw-state-label">{s.label}</span>
                    <span className="vsw-state-note">{s.note}</span>
                  </button>
                );
              })}
            </div>
            <div className="vsw-dates">
              <label>From<EditorialDatePicker value={form.from} onChange={(iso) => setForm(f => ({ ...f, from: iso }))} rangeStart={form.to} markedRanges={markedRanges} displayFormat="d MMM yyyy" ariaLabel="Period start date" placeholder="Start date" /></label>
              <label>To<EditorialDatePicker value={form.to} onChange={(iso) => setForm(f => ({ ...f, to: iso }))} rangeStart={form.from} markedRanges={markedRanges} displayFormat="d MMM yyyy" ariaLabel="Period end date" placeholder="End date" /></label>
            </div>
            <p className="vsw-flabel">Reason <span className="req">required</span></p>
            <input className="vsw-input" placeholder="e.g. Winter refit at MB92, Barcelona" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
            {overlap && (
              <div className="vsw-overlap">
                <p className="vsw-overlap-hd">Overlaps an existing period</p>
                <p className="vsw-overlap-main">
                  {byKey[overlap.period.status]?.label || overlap.period.status}
                  <span className="vsw-overlap-dates"> · {rangeLabel(overlap.period.effective_from, overlap.period.effective_to)}</span>
                  {overlap.period.note && <span className="vsw-overlap-note"> “{overlap.period.note}”</span>}
                </p>
                <p className="vsw-overlap-sub">Logging overwrites {overlap.days} day{overlap.days === 1 ? '' : 's'} — the rest of the period stays.</p>
              </div>
            )}
            {err && <p className="vsw-err vsw-err-modal">{err}</p>}
            <button className="vsw-primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : overlap ? `Overwrite ${overlap.days} day${overlap.days === 1 ? '' : 's'}` : 'Log period'}
            </button>
          </div>
        ) : (
          <div className="vsw-modal-body">
            {timeline.length === 0 ? (
              <p className="vsw-help">No status history yet.</p>
            ) : (
              <div className="vsw-tl">
                {timeline.map(p => {
                  const s = byKey[p.status] || {};
                  const isCurrent = !p.effective_to;
                  const days = spanDays(p.effective_from, p.effective_to);
                  return (
                    <div key={p.id} className="vsw-tl-row">
                      <span className="vsw-tl-ico"><Icon name={s.icon || 'Circle'} className="vsw-ic18" /></span>
                      <div className="vsw-tl-main">
                        <div className="vsw-tl-top">
                          <span className="vsw-tl-label">{s.label || p.status}</span>
                          {isCurrent && <span className="vsw-tl-badge vsw-tl-badge-now">Current</span>}
                          {p.locked && <span className="vsw-tl-badge vsw-tl-badge-lock"><Icon name="Lock" className="vsw-ic12" /> Signed</span>}
                        </div>
                        <div className="vsw-tl-dates">
                          {rangeLabel(p.effective_from, p.effective_to)}
                          <span className="vsw-tl-sep">·</span>
                          {days} day{days === 1 ? '' : 's'}
                        </div>
                        {p.note && <div className="vsw-tl-note">“{p.note}”</div>}
                        {(p.set_by_name || p.created_at) && (
                          <div className="vsw-tl-meta">
                            Set by {p.set_by_name || 'command'}{p.created_at ? ` · ${fmtDMY(String(p.created_at).slice(0, 10))}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VesselStatusWidget;
