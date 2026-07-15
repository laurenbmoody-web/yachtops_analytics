import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import {
  fetchVesselThreads, fetchThreadMessages, sendVesselMessage, markThreadReadVessel,
  markThreadNotificationsRead, acceptQuote, declineQuote,
} from './storage';
import './crew-messages.css';

// Crew (vessel) side of supplier messaging — mirrors the supplier command list:
// suppliers group their conversations (one per order + a general one); Filter /
// Sort dropdowns triage; the open conversation lifts out of a recessed list onto
// a white card. Read + reply to your suppliers.

const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(a || 0);
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const supplierName = (t) => t?.supplier_profiles?.name || 'Supplier';
const supplierLogo = (t) => t?.supplier_profiles?.logo_url || null;
const threadLabel = (t) => (t?.order_id ? `Order #${shortId(t.order_id)}` : 'General');

const AV_GRADS = [
  ['#3E5C76', '#1E3A5F'], ['#5B6B8C', '#39415C'], ['#6B7A99', '#454E68'],
  ['#2F6E8F', '#20405C'], ['#4B5D8A', '#2A2F52'], ['#527A8A', '#2E4A57'],
];
const hashId = (s = '') => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const avatarGrad = (id) => { const [a, b] = AV_GRADS[hashId(String(id)) % AV_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };

const fmtClock = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const fmtAge = (d) => {
  if (!d) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};
const dayLabel = (d) => {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });
};

// Crew quick-replies — useful openers for talking to a supplier.
const QUICK = [
  'Any update on this?',
  'Confirmed, thank you 🙏',
  'Can we adjust the delivery time?',
];

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'awaiting', label: 'Awaiting reply' },
  { value: 'unread', label: 'Unread' },
  { value: 'archived', label: 'Archived' },
];
const SORTS = [
  { value: 'oldest', label: 'Oldest waiting' },
  { value: 'newest', label: 'Newest' },
  { value: 'supplier', label: 'Supplier A–Z' },
];

// ── Dropdown ──────────────────────────────────────────────────────────────
const Menu = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className={`msg-menu${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="msg-menu-btn" onClick={() => setOpen((o) => !o)}>
        <span className="msg-menu-label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="msg-menu-pop" role="listbox">
          {options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`msg-menu-opt${o.value === value ? ' on' : ''}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="msg-menu-tick" aria-hidden="true">
                {o.value === value && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </span>
              <span className="msg-menu-opt-label">{o.label}</span>
              {o.count != null && <span className="msg-menu-c">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const CrewMessages = () => {
  const { activeTenantId } = useTenant();
  const [params, setParams] = useSearchParams();
  const threadParam = params.get('threadId');

  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('open');
  const [sort, setSort] = useState('oldest');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(null);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const streamRef = useRef(null);
  const taRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeTenantId) return [];
    const th = await fetchVesselThreads(activeTenantId);
    setThreads(th);
    return th;
  }, [activeTenantId]);

  useEffect(() => {
    if (!activeTenantId) return;
    setLoading(true);
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [activeTenantId, load]);

  useEffect(() => {
    if (activeId || !threads.length) return;
    setActiveId(threadParam && threads.some((t) => t.id === threadParam) ? threadParam : threads[0].id);
    if (threadParam) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId), [threads, activeId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    fetchThreadMessages(activeId).then(setMessages).catch((e) => setError(e.message));
    setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, vessel_unread_count: 0 } : t)));
    markThreadReadVessel(activeId).catch(() => {});
    markThreadNotificationsRead(activeId)
      .then(() => { try { window.dispatchEvent(new Event('notifications-read')); } catch { /* noop */ } })
      .catch(() => {});
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`crew-msgs-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'supplier_messages', filter: `thread_id=eq.${activeId}` }, (payload) => {
        const msg = payload.new;
        setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
        if (msg.sender_type === 'supplier') markThreadReadVessel(activeId).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId]);

  useEffect(() => {
    if (!activeTenantId) return;
    const ch = supabase
      .channel(`crew-threads-${activeTenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_message_threads', filter: `tenant_id=eq.${activeTenantId}` }, () => {
        load().catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeTenantId, load]);

  useEffect(() => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, activeId]);

  const totalUnread = useMemo(() => threads.reduce((s, t) => s + (t.id === activeId || t.archived_at ? 0 : (t.vessel_unread_count || 0)), 0), [threads, activeId]);
  const awaiting = useMemo(() => threads.filter((t) => !t.archived_at && t.last_sender_type === 'supplier'), [threads]);
  const awaitingReply = awaiting.length;
  const oldestWaiting = useMemo(() => awaiting.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null), [awaiting]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const msg = await sendVesselMessage(activeId, body);
      setMessages((m) => [...m, msg]);
      setDraft('');
      load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); } };
  const quick = (text) => { setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)); taRef.current?.focus(); };

  const resolveQuote = async (id, accept) => {
    if (quoteBusy) return;
    setQuoteBusy(id);
    setError(null);
    try {
      if (accept) await acceptQuote(id); else await declineQuote(id);
      const msgs = await fetchThreadMessages(activeId);
      setMessages(msgs);
      load();
    } catch (e) {
      setError(e.message?.includes('no_order')
        ? 'This conversation isn’t linked to an order yet — start from an order to add items.'
        : (e.message || 'Couldn’t update the quote.'));
    } finally { setQuoteBusy(null); }
  };

  const rendered = useMemo(() => {
    const out = [];
    let lastDay = null, lastSender = null, lastTime = 0;
    for (const msg of messages) {
      const t = new Date(msg.created_at).getTime();
      const dk = new Date(msg.created_at).toDateString();
      if (dk !== lastDay) { out.push({ kind: 'divider', id: `d${dk}`, at: msg.created_at }); lastSender = null; }
      const grouped = msg.sender_type === lastSender && (t - lastTime) < 5 * 60000 && dk === lastDay;
      out.push({ kind: 'msg', msg, grouped });
      lastDay = dk; lastSender = msg.sender_type; lastTime = t;
    }
    return out;
  }, [messages]);

  const counts = useMemo(() => {
    const nonArch = threads.filter((t) => !t.archived_at);
    return {
      open: nonArch.length,
      awaiting: awaitingReply,
      unread: nonArch.filter((t) => t.id !== activeId && (t.vessel_unread_count || 0) > 0).length,
      archived: threads.filter((t) => t.archived_at).length,
    };
  }, [threads, awaitingReply, activeId]);

  // Filter → search → group by supplier → sort.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pass = (t) => {
      if (filter === 'archived') { if (!t.archived_at) return false; }
      else if (t.archived_at) return false;
      if (filter === 'awaiting' && t.last_sender_type !== 'supplier') return false;
      if (filter === 'unread' && !(t.id !== activeId && (t.vessel_unread_count || 0) > 0)) return false;
      if (q && !(supplierName(t).toLowerCase().includes(q) || (t.last_message_preview || '').toLowerCase().includes(q))) return false;
      return true;
    };
    const bySupplier = new Map();
    for (const t of threads) {
      if (!pass(t)) continue;
      const key = t.supplier_id || t.supplier_profiles?.id || 'unknown';
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(t);
    }
    const out = [];
    for (const [supplierId, list] of bySupplier) {
      list.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
      const unread = list.reduce((s, t) => s + (t.id === activeId ? 0 : (t.vessel_unread_count || 0)), 0);
      const waitList = list.filter((t) => t.last_sender_type === 'supplier');
      const oldest = waitList.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null);
      const lastAt = list.reduce((acc, t) => { const v = t.last_message_at || t.created_at; return !acc || v > acc ? v : acc; }, null);
      out.push({ supplierId, name: supplierName(list[0]), logo: supplierLogo(list[0]), threads: list, unread, awaiting: waitList.length, oldest, lastAt });
    }
    out.sort((a, b) => {
      if (sort === 'supplier') return a.name.localeCompare(b.name);
      if (sort === 'newest') return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
      const ao = a.oldest ? new Date(a.oldest).getTime() : Infinity;
      const bo = b.oldest ? new Date(b.oldest).getTime() : Infinity;
      if (ao !== bo) return ao - bo;
      return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
    });
    return out;
  }, [threads, filter, sort, search, activeId]);

  const totalVisible = useMemo(() => groups.reduce((s, g) => s + g.threads.length, 0), [groups]);
  const toggleGroup = (id) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const emptyMsg = filter === 'awaiting' ? 'Nothing awaiting your reply.'
    : filter === 'unread' ? 'Nothing unread.'
    : filter === 'archived' ? 'No archived conversations.'
    : search.trim() ? 'No matches.'
    : 'No conversations yet.';

  const avatar = (id, name, logo, cls = '') => (
    <span className={`msg-boat${cls ? ` ${cls}` : ''}${logo ? ' has-logo' : ''}`} style={logo ? undefined : { background: avatarGrad(id) }}>
      {logo ? <img src={logo} alt="" /> : initials(name)}
    </span>
  );

  return (
    <>
      <Header />
      <div className="cm-page">
        <div className="cm-wrap">
          <div className="cm-head">
            <p className="editorial-meta" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="dot">●</span>
              {awaitingReply > 0 ? (
                <>
                  <span style={{ color: '#C65A1A', fontWeight: 600 }}>{awaitingReply} awaiting your reply</span>
                  {oldestWaiting && <><span className="bar" /><span className="muted">oldest {fmtAge(oldestWaiting)} ago</span></>}
                  {totalUnread > 0 && <><span className="bar" /><span className="muted">{totalUnread} unread</span></>}
                </>
              ) : (
                <>
                  <span>All caught up</span>
                  <span className="bar" /><span className="muted">{counts.open} conversation{counts.open === 1 ? '' : 's'}</span>
                  {totalUnread > 0 && <><span className="bar" /><span className="muted">{totalUnread} unread</span></>}
                </>
              )}
            </p>
            <h1 className="editorial-greeting cm-title">SUPPLIER<span className="period">,</span> <em>messages</em></h1>
          </div>

          {error && <div className="cm-error">{error}</div>}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#8B8478', fontSize: 13 }}>Loading messages…</div>
          ) : threads.length === 0 ? (
            <div className="cm-blank-page">
              <div className="cm-blank-ico">💬</div>
              <div className="cm-blank-t">No supplier messages yet</div>
              <div className="cm-blank-s">When a supplier messages your vessel, the conversation appears here for the crew to answer.</div>
            </div>
          ) : (
            <div className="msg-shell">
              {/* Command list */}
              <div className="msg-list-col">
                <div className="msg-toolbar">
                  <Menu label="Filter" value={filter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} onChange={setFilter} />
                  <Menu label="Sort" value={sort} options={SORTS} onChange={setSort} />
                  <div className="msg-search">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
                  </div>
                </div>

                <div className="msg-list">
                  {groups.map((g) => {
                    const isCollapsed = collapsed.has(g.supplierId);
                    return (
                      <div key={g.supplierId} className="msg-grp">
                        <button type="button" className="msg-grp-head" onClick={() => toggleGroup(g.supplierId)}>
                          <span className={`msg-grp-chev${isCollapsed ? ' c' : ''}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                          </span>
                          {avatar(g.supplierId, g.name, g.logo)}
                          {g.unread > 0 && <span className="msg-grp-dot" title={`${g.unread} new message${g.unread === 1 ? '' : 's'} received`} />}
                          <span className="msg-grp-name">{g.name}</span>
                          <span className="msg-grp-meta">
                            {g.awaiting > 0 && g.oldest && <span className="msg-grp-wait">{fmtAge(g.oldest)}</span>}
                            {g.unread > 0 ? <span className="msg-grp-un">{g.unread}</span> : <span className="msg-grp-count">{g.threads.length}</span>}
                          </span>
                        </button>
                        {!isCollapsed && g.threads.map((t) => {
                          const unread = t.id === activeId ? 0 : (t.vessel_unread_count || 0);
                          const waiting = t.last_sender_type === 'supplier';
                          return (
                            <div key={t.id} className="msg-sw">
                              <div
                                className={`msg-sw-fg${t.id === activeId ? ' on' : ''}${unread > 0 ? ' unread' : ''}${t.archived_at ? ' arch' : ''}`}
                                role="button" tabIndex={0}
                                onClick={() => setActiveId(t.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(t.id); } }}
                              >
                                <span className="msg-row-main">
                                  <span className="msg-row-top">
                                    <span className="msg-row-label">{threadLabel(t)}</span>
                                    <span className="msg-row-when">{fmtWhen(t.last_message_at || t.created_at)}</span>
                                  </span>
                                  <span className="msg-row-prev">
                                    {t.last_message_preview ? `${t.last_sender_type === 'vessel' ? 'You: ' : ''}${t.last_message_preview}` : 'No messages yet'}
                                  </span>
                                </span>
                                {unread > 0 && <span className="msg-row-un">{unread}</span>}
                                {waiting && unread === 0 && <span className="msg-row-wait" title="Awaiting your reply">{fmtAge(t.last_message_at)}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {totalVisible === 0 && <div className="msg-empty" style={{ padding: '28px 14px' }}>{emptyMsg}</div>}
                </div>
              </div>

              {/* Conversation */}
              <div className="msg-convo">
                {activeThread ? (
                  <>
                    <div className="msg-convo-head">
                      {avatar(activeThread.supplier_id || activeThread.supplier_profiles?.id, supplierName(activeThread), supplierLogo(activeThread), 'lg')}
                      <div className="msg-convo-id">
                        <div className="msg-convo-name" style={{ cursor: 'default' }}>{supplierName(activeThread)}</div>
                        <div className="msg-convo-sub"><span className="msg-convo-tag">{threadLabel(activeThread)}</span></div>
                      </div>
                    </div>

                    <div className="msg-stream" ref={streamRef}>
                      {rendered.length === 0 ? (
                        <div className="msg-blank">
                          {(() => {
                            const id = activeThread.supplier_id || activeThread.supplier_profiles?.id;
                            const logo = supplierLogo(activeThread);
                            return (
                              <div className={`msg-blank-av${logo ? ' has-logo' : ''}`} style={logo ? undefined : { background: avatarGrad(id) }}>
                                {logo ? <img src={logo} alt="" /> : initials(supplierName(activeThread))}
                              </div>
                            );
                          })()}
                          <div className="msg-blank-title">Message {supplierName(activeThread)}</div>
                          <div className="msg-blank-sub">Ask a question, confirm an order, or reply — they’ll get it straight away.</div>
                        </div>
                      ) : rendered.map((r) => {
                        if (r.kind === 'divider') return <div key={r.id} className="msg-daysep"><span>{dayLabel(r.at)}</span></div>;
                        const m = r.msg;
                        const read = activeThread?.supplier_last_read_at && new Date(activeThread.supplier_last_read_at) >= new Date(m.created_at);
                        const tick = m.sender_type === 'vessel' ? <span className={`msg-tick${read ? ' read' : ''}`}>{read ? '✓✓' : '✓'}</span> : null;
                        if (m.kind === 'system') return <div key={m.id} className="msg-sysnote"><span>{m.body}</span></div>;
                        if (m.kind === 'quote') {
                          const q = m.quote || {};
                          const items = Array.isArray(q.items) ? q.items : [];
                          const status = m.quote_status || 'pending';
                          return (
                            <div key={m.id} className={`msg-row ${m.sender_type === 'vessel' ? 'me' : 'them'}`}>
                              <div className="msg-quotecard">
                                <div className="msg-qc-head"><span className="msg-qc-badge">✦ Quote</span><span className={`msg-qc-status ${status}`}>{status}</span></div>
                                <div className="msg-qc-items">
                                  {items.map((it, i) => (
                                    <div key={i} className="msg-qc-item">
                                      <span className="msg-qc-name">{it.qty}× {it.name}{it.unit ? ` (${it.unit})` : ''}</span>
                                      <span className="msg-qc-price">{it.unit_price != null ? fmtMoney0(Number(it.unit_price) * (Number(it.qty) || 1), it.currency || q.currency) : '—'}</span>
                                    </div>
                                  ))}
                                </div>
                                {q.total > 0 && <div className="msg-qc-total"><span>Total</span><span>{fmtMoney0(q.total, q.currency)}</span></div>}
                                {m.body && <div className="msg-qc-note">{m.body}</div>}
                                {status === 'pending' && m.sender_type === 'supplier' ? (
                                  <div className="msg-qc-actions">
                                    <button type="button" className="msg-qc-decline" disabled={quoteBusy === m.id} onClick={() => resolveQuote(m.id, false)}>Decline</button>
                                    <button type="button" className="msg-qc-accept" disabled={quoteBusy === m.id} onClick={() => resolveQuote(m.id, true)}>{quoteBusy === m.id ? 'Adding…' : 'Accept & add to order'}</button>
                                  </div>
                                ) : (
                                  <span className="msg-time">{fmtClock(m.created_at)}{tick}</span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={m.id} className={`msg-row ${m.sender_type === 'vessel' ? 'me' : 'them'}${r.grouped ? ' grouped' : ''}`}>
                            <div className="msg-bubble">
                              {m.body}
                              <span className="msg-time">{fmtClock(m.created_at)}{tick}</span>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={endRef} />
                    </div>

                    <div className="msg-foot">
                      <div className="msg-quick">
                        {QUICK.map((q) => (
                          <button key={q} type="button" className="msg-qchip" onClick={() => quick(q)}>{q}</button>
                        ))}
                      </div>
                      <div className="msg-composer">
                        <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={`Reply to ${supplierName(activeThread)}…  (Enter to send · Shift+Enter for a new line)`} rows={2} />
                        <button type="button" className="msg-send" disabled={!draft.trim() || sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="msg-empty" style={{ margin: 'auto' }}>Pick a conversation on the left.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default CrewMessages;
