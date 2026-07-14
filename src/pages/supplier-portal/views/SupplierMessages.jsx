import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import {
  fetchMessageThreads, getOrCreateThread, fetchMessages, sendSupplierMessage,
  markThreadReadSupplier, fetchClients, fetchClientOrders, draftQuoteFromMessage,
  setThreadArchived, deleteThread,
} from '../utils/supplierStorage';
import { supabase } from '../../../lib/supabaseClient';
import EmptyState from '../components/EmptyState';

// Supplier ↔ yacht messaging — a command list. Conversations group under their
// vessel (collapsible); each vessel can hold several threads (one per order,
// plus a general one). Filter + sort dropdowns triage at scale; rows swipe
// (pointer-drag on desktop, finger on touch, hover-reveal for mouse) to
// Archive / Delete / Contact. The open conversation lifts out of a recessed
// list ground onto a raised white card — Front/Intercom depth.

const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(a || 0);
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
const fmtClock = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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
  const dt = new Date(d);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(dt).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });
};
const threadLabel = (t) => (t.order_id ? `Order #${shortId(t.order_id)}` : 'General');

// Deterministic per-vessel avatar tint — decorative, so vessels read apart down
// the rail (not a live presence signal).
const AV_GRADS = [
  ['#3E5C76', '#1E3A5F'], ['#5B6B8C', '#39415C'], ['#6B7A99', '#454E68'],
  ['#2F6E8F', '#20405C'], ['#4B5D8A', '#2A2F52'], ['#527A8A', '#2E4A57'],
];
const hashId = (s = '') => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const avatarGrad = (id) => { const [a, b] = AV_GRADS[hashId(String(id)) % AV_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };

// Domain quick-replies — prefill the composer with a useful opener.
const QUICK = [
  { label: 'Confirm delivery', text: (o) => `Confirming your delivery${o?.delivery_date ? ` for ${new Date(o.delivery_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}${o?.delivery_time ? ` at ${String(o.delivery_time).slice(0, 5)}` : ''} — does that still work for you?` },
  { label: 'On our way 🚚', text: () => `We're on our way with your delivery 🚚 — I'll message when we're close.` },
  { label: 'Substitution', text: () => `Quick one — an item's short today and I can swap in a close match. Want me to sort that for you?` },
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
  { value: 'vessel', label: 'Vessel A–Z' },
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
  const cur = options.find((o) => o.value === value);
  return (
    <div className={`msg-menu${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="msg-menu-btn" onClick={() => setOpen((o) => !o)}>
        <span className="msg-menu-eyebrow">{label}</span>
        <span className="msg-menu-val">{cur?.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="msg-menu-pop" role="listbox">
          {options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`msg-menu-opt${o.value === value ? ' on' : ''}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
              {o.count != null && <span className="msg-menu-c">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Swipeable / hover-revealed thread row ─────────────────────────────────
const SW_LEFT = 132;  // Archive + Delete
const SW_RIGHT = 96;  // Contact
const clampSw = (v) => Math.max(-SW_LEFT, Math.min(SW_RIGHT, v));

const ThreadRow = ({ t, active, onSelect, onArchive, onDelete, onContact }) => {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const unread = active ? 0 : (t.supplier_unread_count || 0);
  const waiting = t.last_sender_type === 'vessel';
  const archived = !!t.archived_at;

  // Close this row when any other row opens.
  useEffect(() => {
    const h = (e) => { if (e.detail !== t.id) { setDx(0); setDragging(false); } };
    document.addEventListener('sw-open', h);
    return () => document.removeEventListener('sw-open', h);
  }, [t.id]);

  const down = (e) => {
    if (e.button != null && e.button > 0) return;
    drag.current = { x: e.clientX, base: dx, cur: dx, moved: false };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const move = (e) => {
    if (!drag.current) return;
    const delta = e.clientX - drag.current.x;
    if (Math.abs(delta) > 4) drag.current.moved = true;
    drag.current.cur = clampSw(drag.current.base + delta);
    setDx(drag.current.cur);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (!d.moved) { setDx(0); onSelect(); return; }
    if (d.cur <= -SW_LEFT * 0.5) { setDx(-SW_LEFT); document.dispatchEvent(new CustomEvent('sw-open', { detail: t.id })); }
    else if (d.cur >= SW_RIGHT * 0.5) { setDx(SW_RIGHT); document.dispatchEvent(new CustomEvent('sw-open', { detail: t.id })); }
    else setDx(0);
  };
  const reset = () => setDx(0);

  // Inline transform only while off-centre, so the CSS hover-reveal can drive
  // the closed state on desktop (mouse users never need to know to drag).
  const fgStyle = dx !== 0 ? { transform: `translateX(${dx}px)`, transition: dragging ? 'none' : undefined } : undefined;

  return (
    <div className={`msg-sw${dx < 0 ? ' open-l' : ''}${dx > 0 ? ' open-r' : ''}`}>
      <div className="msg-sw-actions left" aria-hidden={dx >= 0}>
        <button type="button" className="msg-sw-btn archive" onClick={() => { reset(); onArchive(t); }}>
          {archived ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v13h18V7" /><path d="M1 3h22v4H1z" /><path d="M12 12v6" /><path d="M9 15l3-3 3 3" /></svg>Restore</> : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>Archive</>}
        </button>
        <button type="button" className="msg-sw-btn del" onClick={() => { reset(); onDelete(t); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>Delete
        </button>
      </div>
      <div className="msg-sw-actions right" aria-hidden={dx <= 0}>
        <button type="button" className="msg-sw-btn contact" onClick={() => { reset(); onContact(t); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>Contact
        </button>
      </div>
      <div
        className={`msg-sw-fg msg-row-btn${active ? ' on' : ''}${unread > 0 ? ' unread' : ''}${archived ? ' arch' : ''}${dragging ? ' dragging' : ''}`}
        style={fgStyle}
        role="button" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      >
        <span className="msg-row-main">
          <span className="msg-row-top">
            <span className={`msg-row-label${waiting ? ' await' : ''}${unread > 0 ? ' unrd' : ''}`}>{threadLabel(t)}</span>
            <span className="msg-row-when">{fmtWhen(t.last_message_at || t.created_at)}</span>
          </span>
          <span className="msg-row-prev">
            {t.last_message_preview ? `${t.last_sender_type === 'supplier' ? 'You: ' : ''}${t.last_message_preview}` : 'No messages yet'}
          </span>
        </span>
        {unread > 0 && <span className="msg-row-un">{unread}</span>}
        {waiting && unread === 0 && <span className="msg-row-wait" title="Awaiting your reply">{fmtAge(t.last_message_at)}</span>}
      </div>
      {/* Desktop hover-reveal — the same actions without needing to drag. */}
      <div className="msg-sw-hover">
        <button type="button" className="msg-hbtn" title={archived ? 'Restore' : 'Archive'} aria-label={archived ? 'Restore' : 'Archive'} onClick={() => { reset(); onArchive(t); }}>
          {archived
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v13h18V7" /><path d="M1 3h22v4H1z" /><path d="M12 12v6" /><path d="M9 15l3-3 3 3" /></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>}
        </button>
        <button type="button" className="msg-hbtn del" title="Delete" aria-label="Delete" onClick={() => { reset(); onDelete(t); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>
        </button>
      </div>
    </div>
  );
};

const SupplierMessages = () => {
  const { supplier } = useSupplier();
  const supplierId = supplier?.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const yachtParam = params.get('yachtId');
  const orderParam = params.get('orderId');
  const draftParam = params.get('draft');

  const [threads, setThreads] = useState([]);
  const [names, setNames] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('open');   // open | awaiting | unread | archived
  const [sort, setSort] = useState('oldest');      // oldest | newest | vessel
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const taRef = useRef(null);

  const loadThreads = useCallback(async () => {
    const [th, clients] = await Promise.all([
      fetchMessageThreads(supplierId),
      fetchClients(supplierId).catch(() => []),
    ]);
    const map = {};
    for (const c of clients) if (c.tenant_id) map[c.tenant_id] = c.vessel_name || c.tenants?.name || null;
    for (const t of th) if (t.tenant_id && !map[t.tenant_id]) map[t.tenant_id] = t.tenants?.name || null;
    setThreads(th);
    setNames(map);
    return th;
  }, [supplierId]);

  useEffect(() => {
    if (!supplierId) return;
    setLoading(true);
    loadThreads().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [supplierId, loadThreads]);

  // Deep link: open/create the thread for ?yachtId (+ optional ?orderId, ?draft).
  useEffect(() => {
    if (!supplierId || !yachtParam) return;
    let cancelled = false;
    getOrCreateThread(supplierId, yachtParam, orderParam || null)
      .then((thread) => {
        if (cancelled) return;
        setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]));
        setActiveId(thread.id);
        if (draftParam) setDraft(draftParam);
        setParams({}, { replace: true });
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, yachtParam, orderParam]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId), [threads, activeId]);
  const totalUnread = useMemo(() => threads.reduce((s, t) => s + (t.id === activeId || t.archived_at ? 0 : (t.supplier_unread_count || 0)), 0), [threads, activeId]);
  const awaiting = useMemo(() => threads.filter((t) => !t.archived_at && t.last_sender_type === 'vessel'), [threads]);
  const awaitingReply = awaiting.length;
  const oldestWaiting = useMemo(() => awaiting.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null), [awaiting]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    fetchMessages(activeId).then(setMessages).catch((e) => setError(e.message));
    setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, supplier_unread_count: 0 } : t)));
    markThreadReadSupplier(activeId)
      .then(() => { try { window.dispatchEvent(new Event('supplier-messages-read')); } catch { /* noop */ } })
      .catch(() => {});
  }, [activeId]);

  // Realtime — new messages in the open thread.
  useEffect(() => {
    if (!activeId) return;
    const ch = supabase
      .channel(`msgs-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'supplier_messages', filter: `thread_id=eq.${activeId}` }, (payload) => {
        const msg = payload.new;
        setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
        if (msg.sender_type === 'vessel') markThreadReadSupplier(activeId).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId]);

  // Realtime — inbox changes (new threads, previews, unread, archive state).
  useEffect(() => {
    if (!supplierId) return;
    const ch = supabase
      .channel(`threads-${supplierId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_message_threads', filter: `supplier_id=eq.${supplierId}` }, () => {
        loadThreads().catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supplierId, loadThreads]);

  // Order-context: the thread's order if any, else the yacht's latest order.
  useEffect(() => {
    setActiveOrder(null);
    if (!supplierId || !activeThread?.tenant_id) return;
    let cancelled = false;
    fetchClientOrders(supplierId, activeThread.tenant_id)
      .then((os) => {
        if (cancelled) return;
        const match = activeThread.order_id ? os?.find((o) => o.id === activeThread.order_id) : null;
        setActiveOrder(match || os?.[0] || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [supplierId, activeThread?.tenant_id, activeThread?.order_id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, activeId]);

  const nameFor = (t) => (t ? (names[t.tenant_id] || t.tenants?.name || 'Yacht client') : '');
  const contact = activeOrder?.delivery_contact || '';
  const phone = activeOrder?.delivery_phone || '';

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const msg = await sendSupplierMessage(activeId, body);
      setMessages((m) => [...m, msg]);
      setDraft('');
      loadThreads();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); } };
  const quick = (fn) => { setDraft((d) => (d.trim() ? `${d.trim()} ${fn(activeOrder)}` : fn(activeOrder))); taRef.current?.focus(); };

  const toQuote = async () => {
    if (aiLoading) return;
    const lastIn = [...messages].reverse().find((m) => m.sender_type === 'vessel')?.body;
    const src = (draft.trim() || lastIn || '').trim();
    if (!src) { setError('Type the request (or open one from the yacht) first, then turn it into a quote.'); return; }
    setAiLoading(true);
    setError(null);
    try {
      const res = await draftQuoteFromMessage(src, supplierId);
      if (res?.quote_text) { setDraft(res.quote_text); taRef.current?.focus(); }
      else setError('Couldn’t draft a quote from that — try rephrasing the request.');
    } catch (e) { setError(e.message || 'Quote draft failed.'); }
    finally { setAiLoading(false); }
  };

  // Row actions.
  const archiveThread = async (t) => {
    const next = !t.archived_at;
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, archived_at: next ? new Date().toISOString() : null } : x)));
    try { await setThreadArchived(t.id, next); } catch (e) { setError(e.message); loadThreads(); }
  };
  const removeThread = async (t) => {
    if (!window.confirm(`Delete this conversation with ${nameFor(t)}? This removes it for both sides and can’t be undone.`)) return;
    setThreads((prev) => prev.filter((x) => x.id !== t.id));
    if (activeId === t.id) setActiveId(null);
    try { await deleteThread(t.id); } catch (e) { setError(e.message); loadThreads(); }
  };
  const contactThread = (t) => navigate(`/supplier/clients/${t.tenant_id}`);

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

  // Counts for the filter dropdown.
  const counts = useMemo(() => {
    const nonArch = threads.filter((t) => !t.archived_at);
    return {
      open: nonArch.length,
      awaiting: awaitingReply,
      unread: nonArch.filter((t) => t.id !== activeId && (t.supplier_unread_count || 0) > 0).length,
      archived: threads.filter((t) => t.archived_at).length,
    };
  }, [threads, awaitingReply, activeId]);

  // Filter → search → group by vessel → sort.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pass = (t) => {
      if (filter === 'archived') { if (!t.archived_at) return false; }
      else if (t.archived_at) return false;
      if (filter === 'awaiting' && t.last_sender_type !== 'vessel') return false;
      if (filter === 'unread' && !(t.id !== activeId && (t.supplier_unread_count || 0) > 0)) return false;
      if (q && !(nameFor(t).toLowerCase().includes(q) || (t.last_message_preview || '').toLowerCase().includes(q))) return false;
      return true;
    };
    const byTenant = new Map();
    for (const t of threads) {
      if (!pass(t)) continue;
      if (!byTenant.has(t.tenant_id)) byTenant.set(t.tenant_id, []);
      byTenant.get(t.tenant_id).push(t);
    }
    const out = [];
    for (const [tenantId, list] of byTenant) {
      list.sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at));
      const unread = list.reduce((s, t) => s + (t.id === activeId ? 0 : (t.supplier_unread_count || 0)), 0);
      const waitList = list.filter((t) => t.last_sender_type === 'vessel');
      const oldest = waitList.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null);
      const lastAt = list.reduce((acc, t) => { const v = t.last_message_at || t.created_at; return !acc || v > acc ? v : acc; }, null);
      out.push({ tenantId, name: names[tenantId] || list[0]?.tenants?.name || 'Yacht client', threads: list, unread, awaiting: waitList.length, oldest, lastAt });
    }
    out.sort((a, b) => {
      if (sort === 'vessel') return a.name.localeCompare(b.name);
      if (sort === 'newest') return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
      // oldest waiting: those with someone waiting first (oldest first), rest by recency
      const ao = a.oldest ? new Date(a.oldest).getTime() : Infinity;
      const bo = b.oldest ? new Date(b.oldest).getTime() : Infinity;
      if (ao !== bo) return ao - bo;
      return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
    });
    return out;
  }, [threads, filter, sort, search, names, activeId]);

  const totalVisible = useMemo(() => groups.reduce((s, g) => s + g.threads.length, 0), [groups]);
  const toggleGroup = (id) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const emptyMsg = filter === 'awaiting' ? 'Nothing awaiting your reply — you’re on top of it.'
    : filter === 'unread' ? 'Nothing unread.'
    : filter === 'archived' ? 'No archived conversations.'
    : search.trim() ? 'No matches.'
    : 'No conversations yet.';

  const activeArchived = !!activeThread?.archived_at;

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
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
          <h1 className="editorial-greeting" style={{ fontSize: 46, letterSpacing: '-1px', margin: 0 }}>
            YACHT <em>messages</em>
          </h1>
        </div>
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px 0', color: 'var(--muted)', fontSize: 13 }}>Loading messages…</div>
      ) : threads.length === 0 ? (
        <EmptyState icon="💬" title="No conversations yet" body="Message a yacht from Radar, a client profile, or an order and the thread will appear here." />
      ) : (
        <div className="msg-shell">
          {/* Command list */}
          <div className="msg-list-col">
            <div className="msg-toolbar">
              <Menu label="Show" value={filter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} onChange={setFilter} />
              <Menu label="Sort" value={sort} options={SORTS} onChange={setSort} />
              <div className="msg-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
              </div>
            </div>

            <div className="msg-list">
              {groups.map((g) => {
                const isCollapsed = collapsed.has(g.tenantId);
                return (
                  <div key={g.tenantId} className="msg-grp">
                    <button type="button" className="msg-grp-head" onClick={() => toggleGroup(g.tenantId)}>
                      <span className={`msg-grp-chev${isCollapsed ? ' c' : ''}`}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                      </span>
                      <span className="msg-boat" style={{ background: avatarGrad(g.tenantId) }}>{initials(g.name)}</span>
                      <span className="msg-grp-name">{g.name}</span>
                      <span className="msg-grp-meta">
                        {g.awaiting > 0 && g.oldest && <span className="msg-grp-wait">{fmtAge(g.oldest)}</span>}
                        {g.unread > 0 ? <span className="msg-grp-un">{g.unread}</span> : <span className="msg-grp-count">{g.threads.length}</span>}
                      </span>
                    </button>
                    {!isCollapsed && g.threads.map((t) => (
                      <ThreadRow
                        key={t.id} t={t} active={t.id === activeId}
                        onSelect={() => setActiveId(t.id)} onArchive={archiveThread}
                        onDelete={removeThread} onContact={contactThread}
                      />
                    ))}
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
                  <span className="msg-boat lg" style={{ background: avatarGrad(activeThread.tenant_id) }}>{initials(nameFor(activeThread))}</span>
                  <div className="msg-convo-id">
                    <button type="button" className="msg-convo-name" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}>{nameFor(activeThread)}</button>
                    <div className="msg-convo-sub">
                      <span className="msg-convo-tag">{threadLabel(activeThread)}</span>
                      {contact && <span>· {contact}</span>}
                    </div>
                  </div>
                  <div className="msg-convo-actions">
                    {phone && <a className="msg-ic" href={`tel:${phone}`} title={`Call ${contact || 'yacht'}`} aria-label="Call"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.86.68 2.75a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.33-1.33a2 2 0 0 1 2.11-.45c.89.32 1.81.55 2.75.68A2 2 0 0 1 22 16.92z" /></svg></a>}
                    <button type="button" className="msg-ic" title="View client profile" aria-label="View profile" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></button>
                    <button type="button" className="msg-ic" title={activeArchived ? 'Restore conversation' : 'Archive conversation'} aria-label="Archive" onClick={() => archiveThread(activeThread)}>
                      {activeArchived
                        ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v13h18V7" /><path d="M1 3h22v4H1z" /><path d="M12 12v6" /><path d="M9 15l3-3 3 3" /></svg>
                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>}
                    </button>
                  </div>
                </div>

                {activeArchived && (
                  <div className="msg-arch-banner">
                    Archived conversation — it’ll reopen automatically if either side writes.
                    <button type="button" onClick={() => archiveThread(activeThread)}>Restore</button>
                  </div>
                )}

                {activeOrder && (
                  <div className="msg-ctx">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                    <span>{activeThread.order_id ? 'This order' : 'Latest order'} <b>#{shortId(activeOrder.id)}</b> · <span style={{ textTransform: 'capitalize' }}>{activeOrder.status}</span> · {fmtMoney0(orderTotal(activeOrder), activeOrder.currency || 'EUR')}</span>
                    <button type="button" className="msg-ctx-go" onClick={() => navigate(`/supplier/orders/${activeOrder.id}`)}>View order →</button>
                  </div>
                )}

                <div className="msg-stream">
                  {rendered.length === 0 ? (
                    <div className="msg-blank">
                      <div className="msg-blank-av" style={{ background: avatarGrad(activeThread.tenant_id) }}>{initials(nameFor(activeThread))}</div>
                      <div className="msg-blank-title">Say hello to {nameFor(activeThread)}</div>
                      <div className="msg-blank-sub">
                        {activeOrder
                          ? <>Last order <b>#{shortId(activeOrder.id)}</b> · {activeOrder.status} · {fmtMoney0(orderTotal(activeOrder), activeOrder.currency || 'EUR')}</>
                          : 'Start the conversation — they’ll get it in their inbox.'}
                      </div>
                      <button type="button" className="msg-blank-cta" onClick={() => { const who = contact ? contact.trim().split(/\s+/)[0] : 'there'; setDraft(`Hi ${who} — just checking in on ${nameFor(activeThread)}. Anything I can help you provision for your next trip?`); taRef.current?.focus(); }}>
                        Send a check-in
                      </button>
                    </div>
                  ) : rendered.map((r) => r.kind === 'divider' ? (
                    <div key={r.id} className="msg-daysep"><span>{dayLabel(r.at)}</span></div>
                  ) : (
                    <div key={r.msg.id} className={`msg-row ${r.msg.sender_type === 'supplier' ? 'me' : 'them'}${r.grouped ? ' grouped' : ''}`}>
                      <div className="msg-bubble">
                        {r.msg.body}
                        <span className="msg-time">
                          {fmtClock(r.msg.created_at)}
                          {r.msg.sender_type === 'supplier' && (
                            <span className={`msg-tick${activeThread?.vessel_last_read_at && new Date(activeThread.vessel_last_read_at) >= new Date(r.msg.created_at) ? ' read' : ''}`}>
                              {activeThread?.vessel_last_read_at && new Date(activeThread.vessel_last_read_at) >= new Date(r.msg.created_at) ? '✓✓' : '✓'}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                <div className="msg-foot">
                  <div className="msg-quick">
                    <button type="button" className="msg-qchip msg-qchip-ai" onClick={toQuote} disabled={aiLoading} title="Turn the request into a priced quote using your catalogue">
                      {aiLoading ? 'Drafting quote…' : '✨ Turn into a quote'}
                    </button>
                    {QUICK.map((q) => (
                      <button key={q.label} type="button" className="msg-qchip" onClick={() => quick(q.text)}>{q.label}</button>
                    ))}
                  </div>
                  <div className="msg-composer">
                    <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={`Reply to ${nameFor(activeThread)}…  (Enter to send · Shift+Enter for a new line)`} rows={2} />
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
  );
};

export default SupplierMessages;
