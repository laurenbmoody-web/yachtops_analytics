// Month-end — a command/chief hub for the monthly close-off. Month-end is more
// than Hours of Rest: it's where everything that must be signed off each month
// lives, grouped into categories (Compliance & safety, Crew & payroll, Accounts
// & stores). Each line is a "pack" in one of two states — Outstanding or Done.
//
// Hours of Rest is fully wired (real DB sign-off workflow): its line shows live
// done/outstanding counts and expands into the crew roster, with one-tap in-app
// reminders and a jump-to-approve. The remaining packs are Planned placeholders
// until their own month-end data models exist (breach sign-off, sea-time
// confirmation, timesheets, certificates, petty cash, inventory).

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchTenantCrew } from '../crew-profile/utils/tenantCrew';
import { fetchMonthStatusesForMonth, fetchVesselHorSettings, fetchActiveMemberTiers } from '../crew-profile/utils/horMonthStatus';
import { sendDbNotification } from '../../lib/dbNotifications';
import './month-end.css';

const TIER_RANK = { COMMAND: 3, CHIEF: 2, HOD: 1 };
const rankOf = (t) => TIER_RANK[String(t || '').toUpperCase()] || 0;
const pad2 = (n) => String(n).padStart(2, '0');

// Per-crew roster row status (HOR detail view).
const STATUS_META = {
  open:      { label: 'Not started',       color: '#C65A1A', text: '#B14E16' },
  submitted: { label: 'Awaiting approval', color: '#6C6CCF', text: '#4A4AB0' },
  confirmed: { label: 'Confirmed',         color: '#5C9B6A', text: '#3F7A52' },
  locked:    { label: 'Locked',            color: '#9098B1', text: '#6B7280' },
};

// Two-state pack display: terracotta is the only accent, reserved for what's
// outstanding; completed packs recede into quiet grey.
const PACK = {
  outstanding: { label: 'Outstanding', dot: '#C65A1A', text: '#B14E16', bar: '#1C1B3A' },
  complete:    { label: 'Done',        dot: '#C7C3B6', text: '#9A958A', bar: '#CFCBBE' },
};

// Categories and the Planned placeholders that live under each. Hours of Rest is
// injected as the real, live pack at the top of Compliance & safety.
const CATEGORIES = ['Compliance & safety', 'Crew & payroll', 'Accounts & stores'];
const PLACEHOLDERS = [
  { cat: 'Compliance & safety', icon: 'Anchor',        title: 'Sea time',                note: 'Month-end confirmation' },
  { cat: 'Compliance & safety', icon: 'LifeBuoy',      title: 'Safety drills',           note: 'Monthly drill log' },
  { cat: 'Crew & payroll',      icon: 'FileText',      title: 'Crew timesheets',         note: 'Overtime & leave' },
  { cat: 'Crew & payroll',      icon: 'Award',         title: 'Certificates & renewals', note: 'Expiries & renewals' },
  { cat: 'Accounts & stores',   icon: 'Wallet',        title: 'Petty cash & accounts',   note: 'Monthly reconciliation' },
  { cat: 'Accounts & stores',   icon: 'Package',       title: 'Inventory counts',        note: 'Bond · galley · medical · deck' },
];

export default function MonthEnd() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { session } = useAuth();
  const viewerId = session?.user?.id;

  const [cursor, setCursor] = useState(() => new Date());
  const year = cursor.getFullYear();
  const jsMonth = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const monthName = cursor.toLocaleDateString('en-GB', { month: 'long' });

  const [loading, setLoading] = useState(true);
  const [crew, setCrew] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [settings, setSettings] = useState(null);
  const [tiers, setTiers] = useState({});
  const [coverage, setCoverage] = useState({});   // userId -> Set(entry_date)
  const [reminded, setReminded] = useState({});    // userId -> true (this session)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [openHor, setOpenHor] = useState(false);   // HOR pack expand

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const start = `${year}-${pad2(jsMonth + 1)}-01`;
    const end = `${year}-${pad2(jsMonth + 1)}-${pad2(new Date(year, jsMonth + 1, 0).getDate())}`;
    const [crewRows, statusMap, vesselSettings, memberTiers, covRes] = await Promise.all([
      fetchTenantCrew(activeTenantId),
      fetchMonthStatusesForMonth({ tenantId: activeTenantId, year, jsMonth }),
      fetchVesselHorSettings(activeTenantId),
      fetchActiveMemberTiers(activeTenantId),
      supabase.from('hor_work_entries').select('subject_user_id, entry_date')
        .eq('tenant_id', activeTenantId).gte('entry_date', start).lte('entry_date', end),
    ]);
    const cov = {};
    (covRes?.data || []).forEach((r) => { (cov[r.subject_user_id] || (cov[r.subject_user_id] = new Set())).add(r.entry_date); });
    setCrew(crewRows); setStatuses(statusMap); setSettings(vesselSettings); setTiers(memberTiers); setCoverage(cov);
    setReminded({});
    setLoading(false);
  }, [activeTenantId, year, jsMonth]);

  useEffect(() => { load(); }, [load]);

  // Elapsed days in the selected month: today if it's the current month, the
  // whole month if it's already past, 0 if it's a future month.
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === jsMonth;
  const daysInMonth = new Date(year, jsMonth + 1, 0).getDate();
  const elapsedDays = isCurrentMonth ? today.getDate()
    : (today > new Date(year, jsMonth + 1, 0) ? daysInMonth : 0);

  const approverTier = settings?.approverTier || 'COMMAND';
  const viewerRank = rankOf(tiers[viewerId]);

  const rows = useMemo(() => crew.map((c) => {
    const status = statuses[c.id]?.status || 'open';
    const cov = coverage[c.id] || new Set();
    let loggedElapsed = 0;
    cov.forEach((d) => { if (Number(d.slice(8, 10)) <= elapsedDays) loggedElapsed += 1; });
    const unlogged = Math.max(0, elapsedDays - loggedElapsed);
    const requiredRank = Math.max(rankOf(c.tier), rankOf(approverTier));
    const canApprove = viewerId !== c.id && viewerRank >= requiredRank;
    return { ...c, status, unlogged, canApprove };
  }), [crew, statuses, coverage, elapsedDays, approverTier, viewerRank, viewerId]);

  const counts = useMemo(() => {
    const c = { confirmed: 0, submitted: 0, open: 0, locked: 0 };
    rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return { ...c, total: rows.length, done: c.confirmed + c.locked };
  }, [rows]);

  const outstanding = rows.filter((r) => r.status === 'open');
  const awaiting = rows.filter((r) => r.status === 'submitted');
  const complete = rows.filter((r) => r.status === 'confirmed' || r.status === 'locked');

  const remind = useCallback(async (r) => {
    await sendDbNotification(r.id, {
      type: 'hor_reminder',
      title: `Hours of Rest — ${monthLabel}`,
      message: r.unlogged > 0
        ? `You have ${r.unlogged} unlogged day${r.unlogged > 1 ? 's' : ''} and haven't signed off ${monthLabel}. Please complete and sign off your Hours of Rest.`
        : `Please sign off your Hours of Rest for ${monthLabel}.`,
      actionUrl: `/profile/${r.id}?tab=hor`,
      severity: 'warning',
    });
    setReminded((p) => ({ ...p, [r.id]: true }));
  }, [monthLabel]);

  const remindAll = async () => {
    if (!outstanding.length) return;
    setBusy(true);
    // eslint-disable-next-line no-await-in-loop
    for (const r of outstanding) await remind(r);
    setBusy(false);
    setToast(`Reminder sent to ${outstanding.length} crew`);
    setTimeout(() => setToast(''), 2600);
  };

  const stepMonth = (dir) => setCursor(new Date(year, jsMonth + dir, 1));

  // HOR pack rollup → two-state.
  const horDone = counts.total > 0 && counts.done === counts.total;
  const horPct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const horNote = counts.total === 0 ? 'No crew on this vessel yet'
    : horDone ? 'All crew signed off'
      : [counts.open ? `${counts.open} not started` : null,
         counts.submitted ? `${counts.submitted} awaiting approval` : null]
        .filter(Boolean).join(' · ') || 'In sign-off';

  // ── Per-crew roster row (HOR detail) ──────────────────────────────────────
  const renderRosterRow = (r) => {
    const meta = STATUS_META[r.status] || STATUS_META.open;
    return (
      <div key={r.id} className={`me-row${r.status === 'open' || r.status === 'submitted' ? ' is-action' : ''}`}>
        <span className="me-dot" style={{ background: meta.color }} />
        <div className="me-who">
          <div className="me-name">{r.fullName}</div>
          <div className="me-sub">{[r.roleTitle, r.department].filter(Boolean).join('  ·  ')}</div>
        </div>
        <div className="me-statuswrap">
          <span className="me-status" style={{ color: meta.text }}>{meta.label}</span>
          {r.status === 'open' && r.unlogged > 0 && (
            <span className="me-meta">{r.unlogged} day{r.unlogged > 1 ? 's' : ''} unlogged</span>
          )}
        </div>
        <div className="me-action">
          {r.status === 'open' && (
            reminded[r.id]
              ? <span className="me-reminded"><Icon name="Check" size={14} /> Reminded</span>
              : <button type="button" className="me-btn me-btn-ghost" onClick={() => remind(r)}>Remind</button>
          )}
          {r.status === 'submitted' && (
            r.canApprove
              ? <button type="button" className="me-btn me-btn-primary" onClick={() => navigate(`/profile/${r.id}?tab=hor&period=${year}-${pad2(jsMonth + 1)}`)}>Review &amp; approve</button>
              : <span className="me-meta">Awaiting {approverTier.toLowerCase()}</span>
          )}
        </div>
      </div>
    );
  };

  // ── A Planned placeholder pack line ───────────────────────────────────────
  const renderPlaceholder = (p) => (
    <div key={p.title} className="mp-row is-planned">
      <span className="mp-row-ico"><Icon name={p.icon} size={19} /></span>
      <div className="mp-row-who">
        <div className="mp-row-title">{p.title}<span className="mp-planned">Planned</span></div>
        <div className="mp-row-note">{p.note}</div>
      </div>
      <div className="mp-row-prog" />
      <span className="mp-status mp-soon">Coming soon</span>
      <div className="mp-row-act" />
    </div>
  );

  return (
    <>
      <Header />
      <div className="mp-page">
        <div className="mp-wrap">
          {/* Canonical editorial header — tracked-caps eyebrow, serif sentence
              headline with a terracotta-italic emphasis, and a lead line carrying
              the month's live state. Month-driven: this hub is the whole close-off,
              not just Hours of Rest. */}
          <div className="mp-head">
            <div className="mp-head-main">
              <div className="mp-eyebrow">Monthly close-off</div>
              <h1 className="mp-title">{monthName}, <em>{horDone ? 'on track' : 'still to close'}</em>.</h1>
              <p className="mp-lead">
                {counts.total === 0 ? (
                  <>No crew aboard yet — <b>Hours of Rest</b> populates once crew are added. Sea time, drills, certificates and accounts join the close-off as they come online.</>
                ) : (
                  <>
                    <b>Hours of Rest</b> is the only pack live this month — {counts.done} of {counts.total} signed off
                    {counts.submitted ? `, ${counts.submitted} awaiting approval` : ''}. Sea time, drills, certificates
                    and accounts join the close-off as they come online.
                  </>
                )}
              </p>
            </div>
            <div className="mp-head-controls">
              <div className="mp-monthnav">
                <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
                <span>{monthLabel}</span>
                <button type="button" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
              </div>
              {outstanding.length > 0 && (
                <button type="button" className="mp-link" disabled={busy} onClick={remindAll}>
                  <Icon name="Bell" size={14} /> {busy ? 'Sending…' : `Remind all (${outstanding.length})`}
                </button>
              )}
            </div>
          </div>

          {CATEGORIES.map((cat) => {
            const placeholders = PLACEHOLDERS.filter((p) => p.cat === cat);
            const isCompliance = cat === 'Compliance & safety';
            // Closed count for the category meta: HOR counts if done (Compliance only).
            const closed = isCompliance && horDone ? 1 : 0;
            const totalPacks = placeholders.length + (isCompliance ? 1 : 0);
            return (
              <div key={cat} className="mp-cat">
                <div className="mp-cat-head">
                  <span className="mp-cat-name">{cat}</span>
                  <span className="mp-cat-rule" />
                  <span className="mp-cat-meta">{closed} / {totalPacks} closed</span>
                </div>

                {/* Hours of Rest — the live, expandable pack */}
                {isCompliance && (
                  <>
                    <div className={`mp-row${horDone ? ' is-done' : ' is-action'}`}>
                      <span className="mp-row-ico"><Icon name="Clock" size={19} /></span>
                      <div className="mp-row-who">
                        <div className="mp-row-title">Hours of Rest</div>
                        <div className="mp-row-note">{horNote}</div>
                      </div>
                      <div className="mp-row-prog">
                        <div className="mp-bar"><span style={{ width: `${horPct}%`, background: (horDone ? PACK.complete : PACK.outstanding).bar }} /></div>
                        <span className="mp-frac">{counts.done}/{counts.total || 0}</span>
                      </div>
                      <span className="mp-status" style={{ color: (horDone ? PACK.complete : PACK.outstanding).text }}>
                        <span className="mp-dot" style={{ background: (horDone ? PACK.complete : PACK.outstanding).dot }} />
                        {(horDone ? PACK.complete : PACK.outstanding).label}
                      </span>
                      <div className="mp-row-act">
                        <button type="button" className={`mp-link${horDone ? ' is-mut' : ''}`} onClick={() => setOpenHor((v) => !v)} aria-expanded={openHor}>
                          {openHor ? 'Hide' : 'Review'} {openHor ? '▴' : '→'}
                        </button>
                      </div>
                    </div>

                    {openHor && (
                      <div className="mp-detail">
                        {loading ? (
                          <div className="mp-empty">Loading…</div>
                        ) : rows.length === 0 ? (
                          <div className="mp-empty">No crew on this vessel yet.</div>
                        ) : (
                          <>
                            {(outstanding.length > 0 || awaiting.length > 0) && (
                              <div className="me-section">
                                <div className="me-section-head">
                                  <span className="me-section-title">Needs action</span>
                                  {outstanding.length > 0 && (
                                    <button type="button" className="me-btn me-btn-primary" disabled={busy} onClick={remindAll}>
                                      <Icon name="Bell" size={14} />
                                      {busy ? 'Sending…' : `Send reminders to all (${outstanding.length})`}
                                    </button>
                                  )}
                                </div>
                                {[...outstanding, ...awaiting].map(renderRosterRow)}
                              </div>
                            )}
                            {complete.length > 0 && (
                              <div className="me-section">
                                <div className="me-section-head">
                                  <span className="me-section-title">Complete</span>
                                </div>
                                {complete.map(renderRosterRow)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}

                {placeholders.map(renderPlaceholder)}
              </div>
            );
          })}
        </div>

        {toast && <div className="me-toast">{toast}</div>}
      </div>
    </>
  );
}
