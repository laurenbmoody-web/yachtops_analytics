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

// A single email address, kept on one line — the middle ellipsises in the row.
const shortEmail = (e) => e || '—';

// ── Custom filter dropdown ───────────────────────────────────────────────
function Dropdown({ lead, value, options, onChange }) {
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

  const cur = options.find((o) => o.val === value) || options[0];
  return (
    <div className={`crh-dd${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="crh-dd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="crh-dd-lead">{lead}</span>
        <span className="crh-dd-cur">{cur.label}</span>
        <Icon name="ChevronDown" size={13} className="crh-dd-ch" />
      </button>
      {open && (
        <div className="crh-dd-menu" role="listbox">
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

export default function CrewRequestsHub({ items, loading, eyebrow, initialSelectedId, onDecide, onToast }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [openId, setOpenId] = useState(initialSelectedId || null);
  const [busyId, setBusyId] = useState(null);
  const targetRef = useRef(null);

  // Deep-linked from a notification (?selected=): expand + scroll to that row.
  useEffect(() => {
    if (!initialSelectedId) return;
    setOpenId(initialSelectedId);
    const t = setTimeout(() => {
      targetRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [initialSelectedId]);

  const decorated = useMemo(
    () => (items || []).map((r) => ({
      ...r,
      _tag: KIND[r.kind]?.tag || 'Request',
      _type: KIND[r.kind]?.type || 'other',
      _name: r.requester?.full_name || 'Crew member',
    })),
    [items],
  );

  const typeCounts = useMemo(() => {
    const c = { all: decorated.length };
    for (const r of decorated) c[r._type] = (c[r._type] || 0) + 1;
    return c;
  }, [decorated]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = decorated.filter((r) => {
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
  }, [decorated, typeFilter, sort, query]);

  const pending = decorated.length;
  const thisWeek = useMemo(() => {
    const wk = Date.now() - 7 * 864e5;
    return decorated.filter((r) => new Date(r.requested_at || 0).getTime() >= wk).length;
  }, [decorated]);

  const typeOptions = TYPE_OPTIONS.map((o) => ({
    ...o,
    disabled: !o.live,
    soon: !o.live,
    count: o.live ? (typeCounts[o.val] || 0) : null,
  }));

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
            <div className="crh-stat"><div className="n">{pending}</div><div className="l">Pending</div></div>
            <div className="crh-stat"><div className="n">{typeCounts.notification || 0}</div><div className="l">Notifications</div></div>
            <div className="crh-stat"><div className="n">{thisWeek}</div><div className="l">This week</div></div>
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
          <Dropdown lead="Type" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
          <Dropdown lead="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />
        </div>

        <div className="crh-table">
          <div className="crh-colh" role="row">
            <span>Crew</span>
            <span>Request</span>
            <span className="crh-sumcell">Summary</span>
            <span className="crh-when">When</span>
            <span aria-hidden="true" />
          </div>

          {loading ? (
            <div className="crh-empty" role="status">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="crh-empty" role="status">
              <div className="crh-empty-title">
                {decorated.length === 0 ? 'All clear' : 'No matches'}
              </div>
              {decorated.length === 0
                ? 'Requests from crew — like where a vessel’s alerts are sent — appear here for your decision.'
                : 'Try a different type or clear your search.'}
            </div>
          ) : (
            visible.map((r) => {
              const open = openId === r.id;
              const isTarget = r.id === initialSelectedId;
              const busy = busyId === r.id;
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
                      <span className="crh-av">{initials(r._name)}</span>
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
                    <span className="crh-when">{timeAgo(r.requested_at)}</span>
                    <span className="crh-act" onClick={(e) => e.stopPropagation()}>
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
                      <Icon name="ChevronDown" size={16} className="crh-chev" />
                    </span>
                  </div>

                  {open && (
                    <div className="crh-detail">
                      <div style={{ fontSize: 12, color: '#8B8478', marginTop: 12 }}>
                        Requested {fmtWhen(r.requested_at)}
                      </div>
                      <RequestDetail request={r} />
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
