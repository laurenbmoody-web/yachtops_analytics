import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import './hor-review-modal.css';

const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

// Which of the four buckets a roster row belongs to.
const bucketOf = (r) =>
  (r.status === 'confirmed' || r.status === 'locked') ? 'signed'
    : r.status === 'submitted' ? 'awaiting'
      : 'open';

// Canonical yacht department order for grouping inside a bucket.
const DEPT_RANK = { Bridge: 0, Deck: 1, Engineering: 2, Interior: 3, Galley: 4 };
const byDept = (a, b) => (DEPT_RANK[a] ?? 9) - (DEPT_RANK[b] ?? 9) || String(a).localeCompare(String(b));

const NAV = [
  { key: 'all', label: 'All crew', dot: '#AEB4C2' },
  { key: 'open', label: 'To sign off', dot: '#C65A1A' },
  { key: 'awaiting', label: 'Awaiting approval', dot: '#C79A4B' },
  { key: 'signed', label: 'Signed off', dot: '#6E8B73' },
];

/**
 * Month-end Hours of Rest review — a focused modal (replaces the in-page
 * dropdown). Navy rail with a completion ring + status filters feeds a
 * checklist of crew on the right. Pure presentational: all data + actions
 * come from the month-end page via props.
 */
export default function HorReviewModal({
  open, onClose, monthName, monthLabel, loading,
  rows = [], approverTier = 'COMMAND', reminded = {}, busy = false,
  onRemind, onRemindGroup, onApprove, onView,
  managementEmail, managementName, sentRecord, exporting, onSend, onOpenSettings,
}) {
  const [filter, setFilter] = useState('open');

  const buckets = { open: [], awaiting: [], signed: [] };
  rows.forEach((r) => buckets[bucketOf(r)].push(r));
  const counts = { all: rows.length, open: buckets.open.length, awaiting: buckets.awaiting.length, signed: buckets.signed.length };

  // On open, land on the most useful bucket that actually has crew.
  useEffect(() => {
    if (!open) return;
    const first = ['open', 'awaiting', 'signed'].find((k) => buckets[k].length) || 'all';
    setFilter(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const total = rows.length || 1;
  const pct = counts.signed / total;
  const R = 56, C = 2 * Math.PI * R;

  const shown = filter === 'all' ? rows : buckets[filter] || [];
  const depts = [...new Set(shown.map((r) => r.department || '—'))].sort(byDept);

  const sub = {
    all: 'The full crew roster for this month',
    open: `${counts.open} crew still to sign off`,
    awaiting: `${counts.awaiting} ready for you to review`,
    signed: `${counts.signed} filed to the records vault`,
  }[filter];

  const rowRight = (r) => {
    const b = bucketOf(r);
    if (b === 'signed') {
      return (
        <>
          <span className="hrm-logged">{r.logged}/{r.denom || 0}</span>
          <button type="button" className="hrm-view" onClick={() => onView?.(r)}>View record</button>
        </>
      );
    }
    if (b === 'awaiting') {
      return r.canApprove
        ? <button type="button" className="hrm-btn hrm-dark" onClick={() => onApprove?.(r)}>Review &amp; approve</button>
        : <span className="hrm-muted">Awaiting {String(approverTier).toLowerCase()}</span>;
    }
    return (
      <>
        {r.logged > 0
          ? (
            <span className="hrm-prog">
              <span className="hrm-bar"><span style={{ width: `${Math.round((r.logged / (r.denom || 1)) * 100)}%` }} /></span>
              <span className="hrm-frac">{r.logged}/{r.denom || 0}</span>
            </span>
          )
          : <span className="hrm-unlog"><b>{r.unlogged}</b> day{r.unlogged === 1 ? '' : 's'} unlogged</span>}
        {reminded[r.id]
          ? <span className="hrm-reminded"><Icon name="Check" size={13} /> Reminded</span>
          : <button type="button" className="hrm-link" onClick={() => onRemind?.(r)}>Remind</button>}
      </>
    );
  };

  const checkOf = (r) => {
    const b = bucketOf(r);
    if (b === 'signed') return <span className="hrm-chk sage"><Icon name="Check" size={13} /></span>;
    if (b === 'awaiting') return <span className="hrm-chk amber">!</span>;
    return <span className="hrm-chk open" />;
  };

  return createPortal(
    <div className="hrm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hrm-modal" role="dialog" aria-modal="true" aria-label="Hours of Rest review">
        <button type="button" className="hrm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>

        {/* ---- left rail ---- */}
        <div className="hrm-side">
          <div className="hrm-eyebrow">Hours of Rest</div>
          <h2 className="hrm-month">{monthLabel}</h2>

          <div className="hrm-ring">
            <svg width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r={R} stroke="rgba(255,255,255,.12)" strokeWidth="9" fill="none" />
              <circle
                cx="66" cy="66" r={R} stroke="#6E8B73" strokeWidth="9" fill="none" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 66 66)"
              />
            </svg>
            <div className="hrm-ring-ctr">
              <b>{counts.signed}/{rows.length}</b>
              <i>signed off</i>
            </div>
          </div>

          <div className="hrm-nav">
            {NAV.map((n) => (
              <button key={n.key} type="button" className={filter === n.key ? 'on' : ''} onClick={() => setFilter(n.key)}>
                <span className="hrm-k" style={{ background: n.dot }} />
                {n.label}
                <span className="hrm-c">{counts[n.key]}</span>
              </button>
            ))}
          </div>

          <div className="hrm-send">
            <div className="hrm-send-note">
              {!managementEmail
                ? <>Set a management email in <button type="button" className="hrm-inline" onClick={onOpenSettings}>Vessel Settings</button> to send the record.</>
                : sentRecord
                  ? <>Sent to management on {sentRecord.sent_at ? new Date(sentRecord.sent_at).toLocaleDateString('en-GB') : ''}{sentRecord.send_count > 1 ? ` · ${sentRecord.send_count}×` : ''}</>
                  : <>Record of HoR for {monthName} · sends to {managementName || managementEmail}</>}
            </div>
            <button type="button" className="hrm-send-btn" disabled={exporting || !managementEmail} onClick={onSend}>
              <Icon name="Send" size={14} /> {exporting ? 'Sending…' : (sentRecord ? 'Resend to management' : 'Send to management')}
            </button>
          </div>
        </div>

        {/* ---- right pane (checklist) ---- */}
        <div className="hrm-main">
          <div className="hrm-mhead">
            <div>
              <div className="hrm-ttl">{NAV.find((n) => n.key === filter)?.label}</div>
              <div className="hrm-sub">{sub}</div>
            </div>
            {(filter === 'open' || filter === 'all') && counts.open > 0 && (
              <button type="button" className="hrm-remind-all" disabled={busy} onClick={() => onRemindGroup?.(buckets.open)}>
                <Icon name="Bell" size={13} /> {busy ? 'Sending…' : `Remind all ${counts.open}`}
              </button>
            )}
          </div>

          <div className="hrm-list">
            {loading ? (
              <div className="hrm-empty">Loading…</div>
            ) : shown.length === 0 ? (
              <div className="hrm-empty">{rows.length === 0 ? 'No crew on this vessel yet.' : 'Nobody in this group.'}</div>
            ) : (
              depts.map((d) => (
                <div key={d}>
                  <div className="hrm-dept">{d}</div>
                  {shown.filter((r) => (r.department || '—') === d).map((r) => (
                    <div key={r.id} className="hrm-row">
                      {checkOf(r)}
                      <span className="hrm-av">{initials(r.fullName)}</span>
                      <div className="hrm-who">
                        <div className="hrm-nm">{r.fullName}</div>
                        <div className="hrm-rl">{r.roleTitle}</div>
                      </div>
                      <div className="hrm-right">{rowRight(r)}</div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
