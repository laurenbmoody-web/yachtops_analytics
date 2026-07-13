import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/AppIcon';
import './crew-requests-hub.css';

// CrewRequestsHub — the single-screen "Console" for the Crew requests inbox
// category. Replaces the old split-view (list strip + right pane): a full-width
// operational queue that hangs off the nav rail, with a real filter dropdown,
// sort, search and stat tiles, and decisions taken in place (inline for light
// requests, an expandable body for richer ones).
//
// Built to grow. Today every request is a notification-email change; leave and
// watch-change kinds slot in by adding a KIND entry + a detail renderer — the
// table, toolbar, grouping and filters don't change. The type dropdown already
// scaffolds those kinds as disabled "soon" options so the roadmap is visible.

const KIND = {
  notification_email: { tag: 'Notification email', type: 'notification' },
};

// The type-filter facet. `live: false` renders a disabled "soon" option — the
// surface a request kind will occupy before its migration ships.
const TYPE_OPTIONS = [
  { val: 'all', label: 'All requests', live: true },
  { val: 'notification', label: 'Notifications', dot: 'notification', live: true },
  { val: 'leave', label: 'Leave', dot: 'leave', live: false },
  { val: 'watch', label: 'Watch changes', dot: 'watch', live: false },
];

const SORT_OPTIONS = [
  { val: 'newest', label: 'Newest first' },
  { val: 'oldest', label: 'Oldest first' },
  { val: 'name', label: 'Crew A–Z' },
];

// Status facet — Pending is the working queue; Resolved is the history of
// everything already approved/declined (each row keeps its own chip).
const STATUS_OPTIONS = [
  { val: 'pending', label: 'Pending' },
  { val: 'resolved', label: 'Resolved' },
  { val: 'all', label: 'All' },
];

const initials = (name) => (name || 'Crew member')
  .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

const timeAgo = (iso) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return ''; }
};

// Compact age of the oldest pending request — the "Oldest waiting" KPI.
const compactAge = (iso) => {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `${Math.max(min, 0)}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
};

// A single email address, kept on one line — the middle ellipsises in the row.
const shortEmail = (e) => e || '—';

// ── Filter/sort dropdown ─────────────────────────────────────────────────
// A labelled control (icon + word + chevron) — the button shows the facet
// name ("Filters" / "Sort"), never the current value; the active option is
// marked in the menu. Matches the app-wide Filters/Sort button style.
function Dropdown({ icon, label, value, options, onChange, align }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={`crh-dd${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="crh-dd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon && <Icon name={icon} size={14} className="crh-dd-ic" />}
        <span className="crh-dd-label">{label}</span>
        <Icon name="ChevronDown" size={14} className="crh-dd-ch" />
      </button>
      {open && (
        <div className={`crh-dd-menu${align === 'right' ? ' right' : ''}`} role="listbox">
          {options.map((o) => {
            const disabled = o.disabled;
            return (
              <button
                key={o.val}
                type="button"
                role="option"
                aria-selected={o.val === value}
                aria-disabled={disabled || undefined}
                className={`crh-dd-opt${o.val === value ? ' sel' : ''}${disabled ? ' disabled' : ''}`}
                onClick={() => { if (disabled) return; onChange(o.val); setOpen(false); }}
              >
                {o.dot && <span className={`crh-odot crh-dot ${o.dot}`} />}
                <span>{o.label}</span>
                {o.soon && <span className="crh-soon">soon</span>}
                {o.count != null && !o.soon && <span className="crh-oc">{o.count}</span>}
                {o.val === value && <Icon name="Check" size={15} className="crh-ck" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Filters dropdown — one button hosting the Type + Status facets ───────
function FiltersDropdown({ typeValue, typeOptions, onType, statusValue, statusOptions, onStatus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // A small terracotta dot marks the button when a non-default filter is set.
  const active = typeValue !== 'all' || statusValue !== 'pending';

  const Section = ({ title, value, options, onChange }) => (
    <>
      <div className="crh-dd-sec">{title}</div>
      {options.map((o) => (
        <button
          key={o.val}
          type="button"
          role="option"
          aria-selected={o.val === value}
          aria-disabled={o.disabled || undefined}
          className={`crh-dd-opt${o.val === value ? ' sel' : ''}${o.disabled ? ' disabled' : ''}`}
          onClick={() => { if (o.disabled) return; onChange(o.val); }}
        >
          {o.dot && <span className={`crh-odot crh-dot ${o.dot}`} />}
          <span>{o.label}</span>
          {o.soon && <span className="crh-soon">soon</span>}
          {o.count != null && !o.soon && <span className="crh-oc">{o.count}</span>}
          {o.val === value && <Icon name="Check" size={15} className="crh-ck" />}
        </button>
      ))}
    </>
  );

  return (
    <div className={`crh-dd${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`crh-dd-btn${active ? ' has-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon name="SlidersHorizontal" size={14} className="crh-dd-ic" />
        <span className="crh-dd-label">Filters</span>
        {active && <span className="crh-dd-marker" aria-hidden="true" />}
        <Icon name="ChevronDown" size={14} className="crh-dd-ch" />
      </button>
      {open && (
        <div className="crh-dd-menu right" role="listbox">
          <Section title="Type" value={typeValue} options={typeOptions} onChange={onType} />
          <div className="crh-dd-div" />
          <Section title="Status" value={statusValue} options={statusOptions} onChange={onStatus} />
        </div>
      )}
    </div>
  );
}

// ── Per-kind detail body (shown when a row is expanded) ──────────────────
function RequestDetail({ request }) {
  const name = request.requester?.full_name || 'Crew member';
  const currentEmail = request.requester?.email || '';
  if (request.kind === 'notification_email') {
    return (
      <>
        <p className="crh-lede">
          {name} has asked to send this vessel’s alerts to a different address.
          Approve to route their notifications there, or decline to keep their login email.
        </p>
        <div className="crh-flow">
          <div>
            <div className="k">Currently</div>
            <div className="v muted">{shortEmail(currentEmail)}</div>
          </div>
          <Icon name="ArrowRight" size={16} className="crh-fa" />
          <div>
            <div className="k">Requested</div>
            <div className="v">{shortEmail(request.requested_email)}</div>
          </div>
        </div>
      </>
    );
  }
  // Fallback for future kinds not yet given a bespoke body.
  return <p className="crh-lede">{name} raised a request awaiting your decision.</p>;
}

// A row is actionable while it's still pending. Pending rows come from the
// `items` query (no status column selected) so treat a missing status as such.
const isPending = (r) => !r.status || r.status === 'pending';

// A stat tile. When onClick is supplied it becomes a filter shortcut —
// clicking drives the Status facet, so the Filters dropdown reflects it too.
function StatTile({ n, label, active, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className={`crh-stat${clickable ? ' clickable' : ''}${active ? ' active' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? !!active : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      } : undefined}
    >
      <div className="n">{n}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export default function CrewRequestsHub({
  items, loading, resolved, resolvedLoading, loadResolved,
  eyebrow, initialSelectedId, onDecide, onToast,
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sort, setSort] = useState('newest');
  const [openId, setOpenId] = useState(initialSelectedId || null);
  const [busyId, setBusyId] = useState(null);
  const targetRef = useRef(null);

  // Load resolved history once — drives the Status facet and the throughput KPI.
  useEffect(() => { loadResolved?.(); }, [loadResolved]);

  // Deep-linked from a notification (?selected=): expand + scroll to that row.
  useEffect(() => {
    if (!initialSelectedId) return;
    setOpenId(initialSelectedId);
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [initialSelectedId]);

  const decorate = (r) => ({
    ...r,
    _tag: KIND[r.kind]?.tag || 'Request',
    _type: KIND[r.kind]?.type || 'other',
    _name: r.requester?.full_name || 'Crew member',
  });
  const pendingRows = useMemo(() => (items || []).map(decorate), [items]);
  const resolvedRows = useMemo(() => (resolved || []).map(decorate), [resolved]);

  // The set the list draws from, per the Status facet.
  const sourceRows = useMemo(() => {
    if (statusFilter === 'pending') return pendingRows;
    if (statusFilter === 'all') return [...pendingRows, ...resolvedRows];
    return resolvedRows; // 'resolved'
  }, [statusFilter, pendingRows, resolvedRows]);

  const listLoading = statusFilter === 'pending' ? loading
    : statusFilter === 'all' ? (loading || resolvedLoading)
      : resolvedLoading;

  const typeCounts = useMemo(() => {
    const c = { all: sourceRows.length };
    for (const r of sourceRows) c[r._type] = (c[r._type] || 0) + 1;
    return c;
  }, [sourceRows]);

  const statusCounts = useMemo(() => ({
    pending: pendingRows.length,
    resolved: resolvedRows.length,
    all: pendingRows.length + resolvedRows.length,
  }), [pendingRows, resolvedRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = sourceRows.filter((r) => {
      if (typeFilter !== 'all' && r._type !== typeFilter) return false;
      if (q) {
        const hay = `${r._name} ${r._tag} ${r.requested_email || ''} ${r.requester?.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = rows.slice().sort((a, b) => {
      if (sort === 'name') return a._name.localeCompare(b._name);
      const ta = new Date(a.requested_at || 0).getTime();
      const tb = new Date(b.requested_at || 0).getTime();
      return sort === 'oldest' ? ta - tb : tb - ta;
    });
    return rows;
  }, [sourceRows, typeFilter, sort, query]);

  // KPIs: one act-now count, one attention nudge, one throughput number.
  const awaitingYou = pendingRows.length;
  const oldestWaiting = useMemo(() => {
    if (pendingRows.length === 0) return '—';
    const oldest = pendingRows.reduce((min, r) => {
      const t = new Date(r.requested_at || 0).getTime();
      return t < min ? t : min;
    }, Infinity);
    return compactAge(new Date(oldest).toISOString());
  }, [pendingRows]);
  const resolvedTotal = resolvedRows.length;

  const typeOptions = TYPE_OPTIONS.map((o) => ({
    ...o,
    disabled: !o.live,
    soon: !o.live,
    count: o.live ? (typeCounts[o.val] || 0) : null,
  }));
  const statusOptions = STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.val] }));

  // Empty-state copy varies by whether a filter is narrowing an otherwise
  // non-empty set, vs a genuinely empty pending queue / history.
  const filtered = !!query || typeFilter !== 'all';
  const emptyTitle = filtered ? 'No matches'
    : statusFilter === 'pending' ? 'All clear' : 'No history yet';
  const emptySub = filtered
    ? 'Try a different filter or clear your search.'
    : statusFilter === 'pending'
      ? 'Requests from crew — like where a vessel’s alerts are sent — appear here for your decision.'
      : 'Approved and declined requests will be listed here.';

  const decide = async (request, approve) => {
    setBusyId(request.id);
    try {
      await onDecide(request.id, approve);
      onToast?.(approve
        ? `Approved — alerts for ${request._name} will go to ${request.requested_email}`
        : `Declined — ${request._name} keeps their login email`);
    } catch (e) {
      console.warn('[CrewRequestsHub] decide failed', e);
      onToast?.('Couldn’t save that decision', { error: true });
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));

  return (
    <section className="crh-scroll" aria-label="Crew requests">
      <div className="crh-wrap">
        <div className="crh-head">
          <div>
            <div className="crh-eyebrow">{eyebrow}</div>
            <h1 className="crh-title">Crew requests</h1>
          </div>
          <div className="crh-stats">
            <StatTile
              n={awaitingYou}
              label="Awaiting you"
              active={statusFilter === 'pending'}
              onClick={() => setStatusFilter('pending')}
            />
            <div className="crh-stat"><div className="n">{oldestWaiting}</div><div className="l">Oldest waiting</div></div>
            <StatTile
              n={resolvedTotal}
              label="Resolved"
              active={statusFilter === 'resolved'}
              onClick={() => setStatusFilter('resolved')}
            />
          </div>
        </div>

        <div className="crh-tools">
          <label className="crh-search">
            <Icon name="Search" size={15} className="crh-search-ic" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search crew, email, request…"
              aria-label="Search requests"
            />
          </label>
          <FiltersDropdown
            typeValue={typeFilter}
            typeOptions={typeOptions}
            onType={setTypeFilter}
            statusValue={statusFilter}
            statusOptions={statusOptions}
            onStatus={setStatusFilter}
          />
          <Dropdown icon="ArrowUpDown" label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} align="right" />
        </div>

        <div className="crh-table">
          <div className="crh-colh" role="row">
            <span>Crew</span>
            <span>Request</span>
            <span className="crh-sumcell">Summary</span>
            <span className="crh-when">When</span>
            <span aria-hidden="true" />
          </div>

          {listLoading ? (
            <div className="crh-empty" role="status">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="crh-empty" role="status">
              <div className="crh-empty-title">{emptyTitle}</div>
              {emptySub}
            </div>
          ) : (
            visible.map((r) => {
              const open = openId === r.id;
              const isTarget = r.id === initialSelectedId;
              const busy = busyId === r.id;
              const pendingRow = isPending(r);
              return (
                <div
                  key={r.id}
                  className={`crh-row${open ? ' open' : ''}${isTarget ? ' target' : ''}`}
                  ref={isTarget ? targetRef : undefined}
                >
                  <div
                    className="crh-main"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggle(r.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r.id); }
                    }}
                  >
                    <span className="crh-crew">
                      <span className="crh-av">
                        {r.requester?.avatar_url
                          ? <img src={r.requester.avatar_url} alt="" />
                          : initials(r._name)}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="crh-nm">{r._name}</span>
                        <br />
                        <span className="crh-rl">Notification email</span>
                      </span>
                    </span>
                    <span className="crh-type">
                      <span className={`crh-dot ${r._type}`} />{r._tag}
                    </span>
                    <span className="crh-sum crh-sumcell">
                      <strong>{shortEmail(r.requester?.email)}</strong>
                      <span className="crh-arw">→</span>
                      <strong>{shortEmail(r.requested_email)}</strong>
                    </span>
                    <span className="crh-when">
                      {pendingRow ? timeAgo(r.requested_at) : fmtDate(r.decided_at)}
                    </span>
                    <span className="crh-act" onClick={(e) => e.stopPropagation()}>
                      {pendingRow ? (
                        <>
                          <button
                            type="button"
                            className="crh-btn approve"
                            disabled={busy}
                            onClick={() => decide(r, true)}
                          >
                            {busy ? 'Saving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="crh-btn decline"
                            disabled={busy}
                            onClick={() => decide(r, false)}
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <span className={`crh-chip ${r.status}`}>
                          {r.status === 'approved' ? 'Approved' : 'Declined'}
                        </span>
                      )}
                      <Icon name="ChevronDown" size={16} className="crh-chev" />
                    </span>
                  </div>

                  {open && (
                    <div className="crh-detail">
                      <div className="crh-detail-meta">Requested {fmtWhen(r.requested_at)}</div>
                      <RequestDetail request={r} />
                      {pendingRow ? (
                        <div className="crh-dact">
                          <button
                            type="button"
                            className="crh-btn approve"
                            disabled={busy}
                            onClick={() => decide(r, true)}
                          >
                            {busy ? 'Saving…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="crh-btn decline"
                            disabled={busy}
                            onClick={() => decide(r, false)}
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <div className="crh-decided">
                          {r.status === 'approved' ? 'Approved' : 'Declined'}
                          {r.decider?.full_name ? ` by ${r.decider.full_name}` : ''}
                          {r.decided_at ? ` · ${fmtWhen(r.decided_at)}` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
