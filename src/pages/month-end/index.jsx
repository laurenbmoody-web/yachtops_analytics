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
import '../../styles/editorial.css';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchTenantCrew } from '../crew-profile/utils/tenantCrew';
import { fetchMonthStatusesForMonth, fetchVesselHorSettings, fetchActiveMemberTiers } from '../crew-profile/utils/horMonthStatus';
import { sendDbNotification } from '../../lib/dbNotifications';
import { loadRotaHorExportData } from '../crew-rota/rotaHorExportData';
import { buildRestLogPDF, buildRestLogCSV } from '../crew-rota/rotaHorExport';
import './month-end.css';

// Blob → base64 (no data: prefix) for JSON transport to the email edge function.
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.readAsDataURL(blob);
});

const TIER_RANK = { COMMAND: 3, CHIEF: 2, HOD: 1 };
const rankOf = (t) => TIER_RANK[String(t || '').toUpperCase()] || 0;
const pad2 = (n) => String(n).padStart(2, '0');

// Per-crew roster row status (HOR detail view).
const STATUS_META = {
  open:      { label: 'Not started',       color: '#C65A1A', text: '#B14E16' },
  submitted: { label: 'Awaiting approval', color: '#1C1B3A', text: '#1C1B3A' },
  confirmed: { label: 'Confirmed',         color: '#5C9B6A', text: '#3F7A52' },
  locked:    { label: 'Locked',            color: '#9098B1', text: '#6B7280' },
};

// The roster is split into collapsible status blocks (default collapsed); crew
// are grouped by department inside each. The block header carries the status, so
// rows drop their own status text — the dot + logged-coverage bar carry detail.
// "Not started" and "In progress" both come from the un-submitted `open` status,
// split on whether any days have been logged yet (matters mid-month, when a month
// can't be signed off but crew are part-way through logging).
const STATUS_BLOCKS = [
  { key: 'submitted', label: 'Awaiting approval', theme: '#1C1B3A', match: (r) => r.status === 'submitted' },
  { key: 'progress',  label: 'In progress',       theme: '#C65A1A', match: (r) => r.status === 'open' && r.logged > 0 },
  { key: 'open',      label: 'Not started',       theme: '#C65A1A', match: (r) => r.status === 'open' && r.logged === 0 },
  { key: 'confirmed', label: 'Confirmed',         theme: '#3F7A52', match: (r) => r.status === 'confirmed' || r.status === 'locked' },
];
const REMINDABLE = new Set(['progress', 'open']); // blocks whose crew can be nudged
const DEPT_RANK = { Bridge: 0, Deck: 1, Engineering: 2, Interior: 3, Galley: 4 };
const byDept = (a, b) => (DEPT_RANK[a] ?? 9) - (DEPT_RANK[b] ?? 9) || String(a).localeCompare(String(b));

// Two-state display: terracotta is the only accent, reserved for what's still
// to close; closed items recede into quiet grey. Language matches the page's
// close-off family ("still to close" / "x / y closed").
const PACK = {
  outstanding: { label: 'To close', dot: '#C65A1A', text: '#B14E16', bar: '#1C1B3A' },
  complete:    { label: 'Closed',   dot: '#C7C3B6', text: '#9A958A', bar: '#CFCBBE' },
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
  const packCount = PLACEHOLDERS.length + 1; // placeholders + the live HOR item
  const liveCount = 1;                        // only Hours of Rest is wired today

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
  const [openBlocks, setOpenBlocks] = useState({}); // per-status-block expand (default collapsed)
  const [hideClosed, setHideClosed] = useState(false); // filter: hide closed items
  const [exporting, setExporting] = useState(false);   // building the signed-HOR zip

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
    return { ...c, status, unlogged, logged: loggedElapsed, denom: elapsedDays, canApprove };
  }), [crew, statuses, coverage, elapsedDays, approverTier, viewerRank, viewerId]);

  const counts = useMemo(() => {
    const c = { confirmed: 0, submitted: 0, open: 0, locked: 0 };
    rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return { ...c, total: rows.length, done: c.confirmed + c.locked };
  }, [rows]);

  const inProgressCount = rows.filter((r) => r.status === 'open' && r.logged > 0).length;
  const notStartedCount = rows.filter((r) => r.status === 'open' && r.logged === 0).length;

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

  const remindGroup = async (list) => {
    if (!list?.length) return;
    setBusy(true);
    // eslint-disable-next-line no-await-in-loop
    for (const r of list) await remind(r);
    setBusy(false);
    setToast(`Reminder sent to ${list.length} crew`);
    setTimeout(() => setToast(''), 2600);
  };

  const stepMonth = (dir) => setCursor(new Date(year, jsMonth + dir, 1));

  const managementEmail = settings?.managementCompanyEmail || null;
  const managementName = settings?.managementCompanyName || null;

  // Send the month's Record of Hours of Rest to the management company. The PDF
  // + CSV are generated in the browser by the SAME code the rota page's export
  // button uses (rotaHorExportData → rotaHorExport), so the management pack is an
  // exact duplicate of the on-screen rota export. The edge function only emails
  // the attachments to the address held in vessel settings.
  const sendToManagement = async () => {
    if (exporting) return;
    if (!managementEmail) {
      setToast('Set a management company email in Vessel Settings first');
      setTimeout(() => setToast(''), 3200);
      return;
    }
    setExporting(true);
    try {
      const payload = await loadRotaHorExportData({ tenantId: activeTenantId, year, month: jsMonth + 1, withSignatures: true });
      if (payload.empty) {
        setToast('This month hasn’t started yet — nothing to record');
        return;
      }
      const [{ blob: pdfBlob, filename: pdfName }, { blob: csvBlob, filename: csvName }] = [
        await buildRestLogPDF(payload),
        buildRestLogCSV(payload),
      ];
      const [pdfB64, csvB64] = await Promise.all([blobToBase64(pdfBlob), blobToBase64(csvBlob)]);
      const { data, error } = await supabase.functions.invoke('hor-send-to-management', {
        body: {
          tenantId: activeTenantId,
          periodLabel: payload.meta?.periodLabel || monthLabel,
          attachments: [
            { filename: pdfName, contentBase64: pdfB64, contentType: 'application/pdf' },
            { filename: csvName, contentBase64: csvB64, contentType: 'text/csv' },
          ],
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || 'Send failed');
      setToast(`Sent to ${managementName || managementEmail}`);
    } catch (e) {
      console.error('HOR management send failed', e);
      setToast(`Couldn’t send — ${e.message || 'please try again'}`);
    } finally {
      setExporting(false);
      setTimeout(() => setToast(''), 3200);
    }
  };

  // HOR pack rollup → two-state.
  const horDone = counts.total > 0 && counts.done === counts.total;
  const closedCount = horDone ? 1 : 0; // live items fully closed (only HOR today)
  const horPct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const horNote = counts.total === 0 ? 'No crew on this vessel yet'
    : horDone ? 'All crew signed off'
      : [notStartedCount ? `${notStartedCount} not started` : null,
         inProgressCount ? `${inProgressCount} in progress` : null,
         counts.submitted ? `${counts.submitted} awaiting approval` : null]
        .filter(Boolean).join(' · ') || 'In sign-off';

  // ── Per-crew roster row (HOR detail) ──────────────────────────────────────
  // No per-row status text — the status block header carries it. The dot keeps
  // the status colour and a "logged this month" bar surfaces who's behind.
  const renderRosterRow = (r) => {
    const meta = STATUS_META[r.status] || STATUS_META.open;
    const signed = r.status === 'confirmed' || r.status === 'locked';
    const pct = r.denom ? Math.round((r.logged / r.denom) * 100) : 0;
    const barColor = signed ? '#5C9B6A' : (pct < 60 ? '#C65A1A' : '#9A958A');
    return (
      <div key={r.id} className="me-row">
        <span className="me-dot" style={{ background: meta.color }} />
        <div className="me-who">
          <div className="me-name">{r.fullName}</div>
          <div className="me-sub">{r.roleTitle}</div>
        </div>
        <div className="me-log" title="Days logged this month">
          {r.logged > 0 ? (
            <>
              <div className="me-logbar"><span style={{ width: `${pct}%`, background: barColor }} /></div>
              <span className="me-logfrac">{r.logged}/{r.denom || 0}</span>
            </>
          ) : (!signed && r.unlogged > 0 ? (
            <span className="me-log-note">{r.unlogged} day{r.unlogged > 1 ? 's' : ''} unlogged</span>
          ) : null)}
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
          {signed && (
            <button type="button" className="me-btn me-btn-ghost me-btn-view" onClick={() => navigate(`/profile/${r.id}?tab=hor&period=${year}-${pad2(jsMonth + 1)}`)}>
              <Icon name="Check" size={14} /> View
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── A collapsible status block (Awaiting approval / Not started / Confirmed),
  // crew grouped by department inside. Default collapsed; chevron + label take
  // the block's status colour. ───────────────────────────────────────────────
  const renderStatusBlock = (blk) => {
    const members = rows.filter(blk.match);
    if (!members.length) return null;
    const isOpen = !!openBlocks[blk.key];
    const depts = [...new Set(members.map((m) => m.department).filter(Boolean))].sort(byDept);
    const toggle = () => setOpenBlocks((p) => ({ ...p, [blk.key]: !p[blk.key] }));
    return (
      <div key={blk.key} className="me-block">
        <div className="me-block-head">
          <button type="button" className="me-block-toggle" aria-expanded={isOpen} onClick={toggle}>
            <span className="me-chev" style={{ color: blk.theme }}>{isOpen ? '▾' : '▸'}</span>
            <span className="me-block-dot" style={{ background: blk.theme }} />
            <span className="me-block-label" style={{ color: blk.theme }}>{blk.label} · {members.length}</span>
          </button>
          {REMINDABLE.has(blk.key) ? (
            <button type="button" className="me-btn me-btn-primary me-block-cta" disabled={busy} onClick={() => remindGroup(members)}>
              <Icon name="Bell" size={14} />
              {busy ? 'Sending…' : `Send reminders to all (${members.length})`}
            </button>
          ) : (
            <span className="me-block-preview">{depts.join('  ·  ')}</span>
          )}
        </div>
        {isOpen && depts.map((d) => (
          <div key={d} className="me-dept-group">
            <div className="me-dept">{d}</div>
            {members.filter((m) => m.department === d).map(renderRosterRow)}
          </div>
        ))}
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
          <button type="button" className="mp-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={16} /> Back to Dashboard
          </button>

          {/* Canonical Cargo editorial header — the shared .editorial-meta strip
              + big uppercase .editorial-greeting ("JUNE, still to close."), the
              same components the provisioning / supplier pages use. Month-driven:
              this hub is the whole close-off, not just HOR — no per-item subline. */}
          <div className="mp-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Month-end</span>
              <span className="bar" />
              <span className="muted">{CATEGORIES.length} categories</span>
              <span className="bar" />
              <span className="muted">{liveCount} of {packCount} live</span>
            </p>
            <div className="mp-titlerow">
              <h1 className="editorial-greeting">
                {monthName}<span className="period">,</span> <em>{horDone ? 'on track' : 'still to close'}</em><span className="period">.</span>
              </h1>
              <div className="mp-monthnav">
                <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
                <span>{monthLabel}</span>
                <button type="button" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
              </div>
            </div>
          </div>

          {/* Hide-closed filter — only shown once something is actually closed,
              so there's no dead control while nothing is closeable yet. */}
          {closedCount > 0 && (
            <div className="mp-toolbar">
              <button type="button" className="mp-filter" aria-pressed={hideClosed} onClick={() => setHideClosed((v) => !v)}>
                <Icon name={hideClosed ? 'Eye' : 'EyeOff'} size={13} />
                {hideClosed ? 'Show closed' : 'Hide closed'}
              </button>
            </div>
          )}

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

                {/* Hours of Rest — the live, expandable pack. Hidden when it's
                    closed and the Hide-closed filter is on. */}
                {isCompliance && !(hideClosed && horDone) && (
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
                            {STATUS_BLOCKS.map(renderStatusBlock)}
                            <div className="me-export">
                              <span className="me-export-note">
                                {managementEmail
                                  ? <>Record of Hours of Rest for {monthName} · sends to {managementName ? `${managementName} (${managementEmail})` : managementEmail}</>
                                  : <>Set a management company email in <button type="button" className="me-link-inline" onClick={() => navigate('/vessel-settings')}>Vessel Settings</button> to send the monthly record</>}
                              </span>
                              <button type="button" className="me-btn me-btn-primary" disabled={exporting || !managementEmail} onClick={sendToManagement}>
                                <Icon name="Send" size={14} /> {exporting ? 'Sending…' : 'Send to management'}
                              </button>
                            </div>
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
