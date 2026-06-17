// Month-end — a command/chief hub that unifies monthly sign-off. v1 covers
// Hours of Rest: a rollup of who's done vs outstanding, with one-tap in-app
// reminders for crew who haven't signed off, and a jump-to-approve for months
// awaiting an eligible approver. Breach sign-offs / sea time can join later.

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

const STATUS_META = {
  open:      { label: 'Not started',       color: '#E2A33C', text: '#9A6B1C' },
  submitted: { label: 'Awaiting approval', color: '#6C6CCF', text: '#4A4AB0' },
  confirmed: { label: 'Confirmed',         color: '#5C9B6A', text: '#3F7A52' },
  locked:    { label: 'Locked',            color: '#9098B1', text: '#6B7280' },
};

export default function MonthEnd() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { session } = useAuth();
  const viewerId = session?.user?.id;

  const [cursor, setCursor] = useState(() => new Date());
  const year = cursor.getFullYear();
  const jsMonth = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const [loading, setLoading] = useState(true);
  const [crew, setCrew] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [settings, setSettings] = useState(null);
  const [tiers, setTiers] = useState({});
  const [coverage, setCoverage] = useState({});   // userId -> Set(entry_date)
  const [reminded, setReminded] = useState({});    // userId -> true (this session)
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [openHor, setOpenHor] = useState(true);  // compliance-pack accordion

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

  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

  const renderRow = (r) => {
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

  return (
    <>
      <Header />
      <div className="month-end-page">
        <div className="me-wrap">
          <div className="me-head">
            <div>
              <h1 className="me-title">Month-end</h1>
              <div className="me-eyebrow">Compliance sign-off</div>
            </div>
            <div className="me-monthnav">
              <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
              <span>{monthLabel}</span>
              <button type="button" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
            </div>
          </div>

          {/* Compliance packs — each a collapsible box. Hours of Rest today;
              breach sign-offs / sea time can be added as sibling packs. */}
          <div className="me-pack">
            <button
              type="button"
              className="me-pack-head"
              aria-expanded={openHor}
              onClick={() => setOpenHor((v) => !v)}
            >
              <span className="dia">◆</span>
              <span className="t">Hours of Rest</span>
              {!openHor && counts.open > 0 && (
                <span className="me-pack-badge">{counts.open} to action</span>
              )}
              <span className="me-progress-label">{counts.done} of {counts.total} signed off</span>
              <Icon name="ChevronDown" size={18} className={`me-chev${openHor ? ' open' : ''}`} />
            </button>

            {openHor && (
              <div className="me-pack-body">
                <div className="me-bar"><span style={{ width: `${pct}%` }} /></div>
                <div className="me-chips">
                  <span className="me-chip"><span className="d" style={{ background: '#5C9B6A' }} />{counts.confirmed} confirmed</span>
                  {counts.locked > 0 && <span className="me-chip"><span className="d" style={{ background: '#9098B1' }} />{counts.locked} locked</span>}
                  <span className="me-chip"><span className="d" style={{ background: '#6C6CCF' }} />{counts.submitted} awaiting approval</span>
                  <span className="me-chip"><span className="d" style={{ background: '#E2A33C' }} />{counts.open} not started</span>
                </div>

                {loading ? (
                  <div className="me-empty">Loading…</div>
                ) : (
                  <>
                    {/* Needs action */}
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
                        {[...outstanding, ...awaiting].map(renderRow)}
                      </div>
                    )}

                    {/* Complete */}
                    {complete.length > 0 && (
                      <div className="me-section">
                        <div className="me-section-head">
                          <span className="me-section-title">Complete</span>
                        </div>
                        {complete.map(renderRow)}
                      </div>
                    )}

                    {rows.length === 0 && <div className="me-empty">No crew on this vessel yet.</div>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {toast && <div className="me-toast">{toast}</div>}
      </div>
    </>
  );
}
