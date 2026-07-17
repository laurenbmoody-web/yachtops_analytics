import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {formatTime, dateLocale } from '../../../utils/dateFormat';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import {
  fetchMessageThreads, getOrCreateThread, fetchMessages, sendSupplierMessage,
  markThreadReadSupplier, fetchClients, fetchClientOrders, draftQuoteFromMessage,
  setThreadArchived, deleteThread, fetchVesselLogos, sendSupplierQuote,
  reactToMessage, deleteMessage, editMessage, createCatalogueItem, repriceQuote,
  uploadMessageAttachment, updateOrderStatus, fetchThreadsPeople,
  fetchThreadContacts, assignThreadContact, fetchPersonCard, saveMyMessagingProfile,
  fetchAddableSupplier, addThreadParticipant, removeThreadParticipant,
  fetchReplyTemplates, createReplyTemplate, deleteReplyTemplate,
} from '../utils/supplierStorage';
import { supabase } from '../../../lib/supabaseClient';
import EmptyState from '../components/EmptyState';
import MessageBubble from '../../../components/messaging/MessageBubble';

// When a quote is fully priced, strip the "to-confirm price" caveats from the
// supplier's message so the note matches the (now priced) card.
const cleanPricedBody = (body, allPriced) => {
  if (!allPriced || !body) return body;
  let b = String(body)
    .replace(/\s*[—–-]\s*unpriced[^\n]*/gi, '')                  // "— unpriced (see note below)"
    .replace(/\s*[—–-]\s*price\s*TBC\b[^\n]*/gi, '')             // "— price TBC"
    .replace(/\s*\((?:see note below|price\s*TBC)\)/gi, '')      // "(see note below)" / "(price TBC)"
    .replace(/^.*\bunfortunately\b[\s\S]*?(?:\n\s*\n|$)/gim, '') // the "Unfortunately … catalogue" paragraph
    .replace(/[^.!?\n]*\bconfirm\b[^.!?\n]*\bprice\b[^.!?\n]*[.!?]\s*/gi, '') // "I'll confirm the price … shortly."
    .replace(/[^.!?\n]*\bprice\b[^.!?\n]*\bconfirm\b[^.!?\n]*[.!?]\s*/gi, '') // "the price to confirm …"
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return b || 'Here’s your quote — ready to accept whenever you are.';
};

// Optimistic mirror of react_to_message: one reaction per user.
const toggleReaction = (reactions, emoji, uid) => {
  const arr = Array.isArray(reactions) ? reactions : [];
  const hadSame = arr.some((r) => r.uid === uid && r.emoji === emoji);
  const without = arr.filter((r) => r.uid !== uid);
  return hadSame ? without : [...without, { emoji, by: 'supplier', uid, at: new Date().toISOString() }];
};

// Supplier ↔ yacht messaging — a command list. Conversations group under their
// vessel (collapsible); each vessel can hold several threads (one per order,
// plus a general one). Filter + sort dropdowns triage at scale; rows swipe
// (pointer-drag on desktop, finger on touch, hover-reveal for mouse) to
// Archive / Delete / Contact. The open conversation lifts out of a recessed
// list ground onto a raised white card — Front/Intercom depth.

const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);
// Whole amounts show clean (€60); non-whole show cents (€89.90) so typed
// prices total exactly rather than rounding to the nearest euro.
const fmtMoney = (a, cur = 'EUR') => {
  const n = Number(a) || 0;
  const dp = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
const fmtClock = (d) => (d ? formatTime(d) : '');
const fmtExpiry = (d) => (d ? new Date(d).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return dt.toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
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
  return dt.toLocaleDateString(dateLocale(), { weekday: 'long', day: '2-digit', month: 'long' });
};
const threadLabel = (t) => (t.order_id ? `Order #${shortId(t.order_id)}` : 'General');

// Deterministic per-vessel avatar tint — decorative, so vessels read apart down
// the rail (not a live presence signal).
const AV_GRADS = [
  ['#3E5C76', '#1E3A5F'], ['#5B6B8C', '#39415C'], ['#6B7A99', '#454E68'],
  ['#2F6E8F', '#20405C'], ['#4B5D8A', '#2A2F52'], ['#527A8A', '#2E4A57'],
];
const SUP_GRADS = [
  ['#C65A1A', '#8A3D10'], ['#D2802E', '#A85E1E'], ['#B8551E', '#7C3410'],
  ['#CE6A2A', '#96481A'], ['#BE6733', '#8A4418'],
];
const hashId = (s = '') => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const avatarGrad = (id) => { const [a, b] = AV_GRADS[hashId(String(id)) % AV_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };
const supGrad = (id) => { const [a, b] = SUP_GRADS[hashId(String(id)) % SUP_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };
// Warm for supplier people, cool for crew.
const faceGrad = (p) => (p?.party === 'supplier' ? supGrad(p.user_id) : avatarGrad(p.user_id));

// Domain quick-replies — prefill the composer with a useful opener.
const QUICK = [
  { label: 'Confirm delivery', text: (o) => `Confirming your delivery${o?.delivery_date ? ` for ${new Date(o.delivery_date).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}${o?.delivery_time ? ` at ${String(o.delivery_time).slice(0, 5)}` : ''} — does that still work for you?` },
  { label: 'On our way 🚚', status: 'out_for_delivery', text: () => `We're on our way with your delivery 🚚 — I'll message when we're close.` },
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
            <span className={`msg-row-label${waiting ? ' await' : ''}`}>{threadLabel(t)}</span>
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
  const [logos, setLogos] = useState({});
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
  const [pendingQuote, setPendingQuote] = useState(null); // { text, items, currency, total }
  const [error, setError] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [myUid, setMyUid] = useState(null);
  const [peopleByThread, setPeopleByThread] = useState({});     // thread_id → participant roster
  const [assignedByThread, setAssignedByThread] = useState({}); // thread_id → colleague handling it
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignContacts, setAssignContacts] = useState([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [cardPerson, setCardPerson] = useState(null);
  const [cardDetail, setCardDetail] = useState(null);
  const [profileModal, setProfileModal] = useState(null);
  const [profEditing, setProfEditing] = useState(false);
  const [profAbout, setProfAbout] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profSaving, setProfSaving] = useState(false);
  const [statusEditing, setStatusEditing] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [addable, setAddable] = useState([]);
  const [addSearch, setAddSearch] = useState('');
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [savedCat, setSavedCat] = useState(() => new Set()); // quote items saved to catalogue
  const [savingCat, setSavingCat] = useState(null);
  const [pricing, setPricing] = useState(null);     // quote message id being repriced
  const [priceDraft, setPriceDraft] = useState({}); // { itemIndex: 'value' }
  const [attachments, setAttachments] = useState([]); // pending upload descriptors
  const [uploading, setUploading] = useState(false);
  const endRef = useRef(null);
  const streamRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyUid(data?.user?.id ?? null)); }, []);

  const loadThreads = useCallback(async () => {
    const [th, clients, logoMap] = await Promise.all([
      fetchMessageThreads(supplierId),
      fetchClients(supplierId).catch(() => []),
      fetchVesselLogos().catch(() => ({})),
    ]);
    const map = {};
    for (const c of clients) if (c.tenant_id) map[c.tenant_id] = c.vessel_name || c.tenants?.name || null;
    for (const t of th) if (t.tenant_id && !map[t.tenant_id]) map[t.tenant_id] = t.tenants?.name || null;
    setThreads(th);
    setNames(map);
    setLogos(logoMap || {});
    fetchThreadsPeople().then((rows) => {
      const p = {}, a = {};
      for (const r of rows) { p[r.thread_id] = r.people || []; a[r.thread_id] = r.assigned; }
      setPeopleByThread(p); setAssignedByThread(a);
    }).catch(() => {});
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
        if (!thread) {
          setError('This yacht hasn’t opened a conversation with you yet — they start the chat from their side.');
          setParams({}, { replace: true });
          return;
        }
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
    setReplyTo(null); setEditing(null); setDraft('');
    // A half-made quote belongs to the thread it was drafted in — never let it
    // follow the supplier into another conversation.
    setPendingQuote(null); setPricing(null); setPriceDraft({}); setAttachments([]);
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'supplier_messages', filter: `thread_id=eq.${activeId}` }, (payload) => {
        const msg = payload.new;
        setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, ...msg } : x)));
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

  // Scroll the message stream itself (not the page) to the latest — using
  // scrollIntoView here would scroll the whole portal, clipping the header + composer.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return undefined;
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    toBottom();
    const raf = requestAnimationFrame(toBottom);
    const t = setTimeout(toBottom, 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [messages, activeId]);

  const nameFor = (t) => (t ? (names[t.tenant_id] || t.tenants?.name || 'Yacht client') : '');
  // Vessel avatar — the uploaded logo when present, else a tinted monogram.
  const boat = (tenantId, name, cls = '') => (
    <span className={`msg-boat${cls ? ` ${cls}` : ''}${logos[tenantId] ? ' has-logo' : ''}`} style={logos[tenantId] ? undefined : { background: avatarGrad(tenantId) }}>
      {logos[tenantId] ? <img src={logos[tenantId]} alt="" /> : initials(name)}
    </span>
  );
  const contact = activeOrder?.delivery_contact || '';
  const phone = activeOrder?.delivery_phone || '';

  const send = async () => {
    const body = draft.trim();
    if ((!body && !attachments.length) || !activeId || sending) return;
    setSending(true);
    try {
      if (editing) {
        await editMessage(editing.id, body);
        setMessages((m) => m.map((x) => (x.id === editing.id ? { ...x, body, edited_at: new Date().toISOString() } : x)));
        setEditing(null);
      } else {
        const msg = await sendSupplierMessage(activeId, body, replyTo?.id ?? null, attachments);
        setMessages((m) => [...m, msg]);
        setReplyTo(null);
        setAttachments([]);
        loadThreads();
      }
      setDraft('');
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); } };
  const quick = (fn) => { setDraft((d) => (d.trim() ? `${d.trim()} ${fn(activeOrder)}` : fn(activeOrder))); taRef.current?.focus(); };

  // Saved replies (canned messages).
  const loadTemplates = useCallback(async () => {
    if (!supplierId) return;
    try { setTemplates(await fetchReplyTemplates(supplierId)); } catch { /* ignore */ }
  }, [supplierId]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  const insertTemplate = (t) => { setDraft((d) => (d.trim() ? `${d.trim()} ${t.body}` : t.body)); setTplOpen(false); taRef.current?.focus(); };
  const saveCurrentAsTemplate = async () => {
    const body = draft.trim();
    if (!body || tplBusy || !supplierId) return;
    setTplBusy(true); setError(null);
    try { await createReplyTemplate(supplierId, { label: null, body }); await loadTemplates(); }
    catch (e) { setError(e.message); }
    finally { setTplBusy(false); }
  };
  const removeTemplate = async (id) => {
    if (tplBusy) return;
    setTplBusy(true); setError(null);
    try { await deleteReplyTemplate(id); setTemplates((t) => t.filter((x) => x.id !== id)); }
    catch (e) { setError(e.message); }
    finally { setTplBusy(false); }
  };

  // A status quick-action (e.g. "On our way") moves the order's status AND posts
  // the message in one go, so the yacht sees the update and the order's stage
  // actually advances (with its timestamp stamped) — not just a chat line.
  const deliveryAction = async (q) => {
    if (sending) return;
    if (!activeOrder?.id) { quick(q.text); return; }  // no order to advance — fall back to a template
    setSending(true); setError(null);
    try {
      const updated = await updateOrderStatus(activeOrder.id, q.status);
      setActiveOrder(updated);
      const msg = await sendSupplierMessage(activeId, q.text(activeOrder), null, []);
      setMessages((m) => [...m, msg]);
      loadThreads();
    } catch (e) { setError(e.message || 'Couldn’t update the order status.'); }
    finally { setSending(false); }
  };

  // Upload picked photos/dockets, staged as pending attachments for the next send.
  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length || !activeId) return;
    setUploading(true); setError(null);
    try {
      const up = [];
      for (const f of files) up.push(await uploadMessageAttachment(activeId, f));
      setAttachments((a) => [...a, ...up]);
    } catch (err) { setError(err.message || 'Couldn’t upload that file.'); }
    finally { setUploading(false); }
  };
  const removeAttachment = (i) => setAttachments((a) => a.filter((_, idx) => idx !== i));

  const startReply = (m) => { setEditing(null); setReplyTo(m); taRef.current?.focus(); };
  const startEdit = (m) => { setReplyTo(null); setEditing(m); setDraft(m.body || ''); taRef.current?.focus(); };
  const cancelEdit = () => { setEditing(null); setDraft(''); };
  const doReact = async (id, emoji) => {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, reactions: toggleReaction(x.reactions, emoji, myUid) } : x)));
    try { await reactToMessage(id, emoji); } catch (e) { setError(e.message); fetchMessages(activeId).then(setMessages).catch(() => {}); }
  };
  const doDelete = async (id) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    try { await deleteMessage(id); setMessages((m) => m.map((x) => (x.id === id ? { ...x, deleted_at: new Date().toISOString() } : x))); }
    catch (e) { setError(e.message); }
  };
  const jumpTo = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-flash'); setTimeout(() => el.classList.remove('msg-flash'), 1200); }
  };

  const toQuote = async () => {
    if (aiLoading) return;
    // If the latest request has already been quoted and that quote is still
    // waiting on the yacht, don't spin up a second (empty) draft for the same
    // thing — that's the confusing "the quote box came back" case. Point the
    // supplier at the sent quote instead.
    if (!draft.trim()) {
      const lastVesselIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].sender_type === 'vessel') return i; return -1; })();
      const openQuoteAfter = messages.some((m, i) => i > lastVesselIdx && m.kind === 'quote' && !m.deleted_at && (m.quote_status || 'pending') === 'pending');
      if (openQuoteAfter) {
        setError('You’ve already sent a quote for this — it’s waiting on the yacht. Use “Add prices” on that quote if you need to change it.');
        return;
      }
    }
    const lastIn = [...messages].reverse().find((m) => m.sender_type === 'vessel')?.body;
    const src = (draft.trim() || lastIn || '').trim();
    if (!src) { setError('Type the request (or open one from the yacht) first, then turn it into a quote.'); return; }
    setAiLoading(true);
    setError(null);
    try {
      // Give the AI the recent conversation + last quote so a short follow-up
      // ("add another 20") resolves to the right item and updated quantity.
      const history = messages
        .filter((m) => !m.deleted_at && m.kind !== 'system')
        .slice(-8)
        .map((m) => ({
          from: m.sender_type === 'supplier' ? 'you' : 'yacht',
          text: m.kind === 'quote'
            ? `[quote] ${(m.quote?.items || []).map((it) => `${it.qty}× ${it.name}`).join(', ')}`
            : (m.body || ''),
        }));
      const lastQuote = [...messages].reverse().find((m) => m.kind === 'quote' && !m.deleted_at);
      const lastItems = (lastQuote?.quote?.items || []).map((it) => ({ name: it.name, qty: it.qty, unit: it.unit, unit_price: it.unit_price }));
      const res = await draftQuoteFromMessage(src, supplierId, { history, lastItems });
      const items = Array.isArray(res?.items) ? res.items : [];
      if (res?.quote_text) {
        const total = items.reduce((s, i) => s + (i.unit_price != null ? Number(i.unit_price) * (Number(i.qty) || 1) : 0), 0);
        setPendingQuote({ text: res.quote_text, items, currency: res.currency || 'EUR', total });
      } else setError('Couldn’t draft a quote from that — try rephrasing the request.');
    } catch (e) { setError(e.message || 'Quote draft failed.'); }
    finally { setAiLoading(false); }
  };

  // Save a bespoke (non-catalogue) quote line to the supplier's catalogue so
  // next time it's a known product — a price left null can be filled in later.
  const saveToCatalogue = async (key, it) => {
    if (savingCat) return;
    setSavingCat(key);
    setError(null);
    try {
      await createCatalogueItem(supplierId, {
        name: it.name,
        unit: it.unit || null,
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
        currency: it.currency || 'EUR',
      });
      setSavedCat((s) => new Set(s).add(key));
    } catch (e) { setError(e.message || 'Couldn’t save to catalogue.'); }
    finally { setSavingCat(null); }
  };

  // Add prices to an already-sent, still-pending quote (the bespoke items you
  // couldn't price up front), then re-send it in place.
  const startPricing = (m) => {
    const items = Array.isArray(m.quote?.items) ? m.quote.items : [];
    const d = {};
    items.forEach((it, i) => { if (it.unit_price == null) d[i] = ''; });
    setPriceDraft(d);
    setPricing(m.id);
  };
  const cancelPricing = () => { setPricing(null); setPriceDraft({}); };
  const sendPrices = async (m) => {
    if (sending) return;
    const q = m.quote || {};
    const items = (Array.isArray(q.items) ? q.items : []).map((it, i) => {
      const raw = priceDraft[i];
      if (raw != null && String(raw).trim() !== '') {
        const p = Number(raw);
        if (!Number.isNaN(p)) return { ...it, unit_price: p };
      }
      return it;
    });
    const total = items.reduce((s, it) => s + (it.unit_price != null ? Number(it.unit_price) * (Number(it.qty) || 1) : 0), 0);
    const quote = { ...q, items, total };
    const allPriced = items.every((it) => it.unit_price != null);
    const newBody = cleanPricedBody(m.body, allPriced);
    setSending(true);
    setError(null);
    try {
      await repriceQuote(m.id, quote, newBody !== m.body ? newBody : null);
      setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, quote, body: newBody, edited_at: new Date().toISOString() } : x)));
      cancelPricing();
      loadThreads();
    } catch (e) { setError(e.message || 'Couldn’t update the quote.'); }
    finally { setSending(false); }
  };

  // Reopen a declined quote as a fresh, fully-editable draft so the supplier can
  // revise (usually the price) and re-send. The declined one stays as history.
  const requote = (m) => {
    const q = m.quote || {};
    const items = (Array.isArray(q.items) ? q.items : []).map(({ _priceInput, ...it }) => ({ ...it }));
    const total = items.reduce((s, it) => s + (it.unit_price != null ? Number(it.unit_price) * (Number(it.qty) || 1) : 0), 0);
    setPendingQuote({ text: 'Thanks for coming back to us — here’s a revised quote:', items, currency: q.currency || 'EUR', total, requote: true });
    taRef.current?.focus?.();
  };

  // Let the supplier type a price into an unpriced line while reviewing the
  // draft, before sending — recomputes the total live.
  const setPendingPrice = (i, value) => {
    setPendingQuote((pq) => {
      if (!pq) return pq;
      const v = String(value).replace(/[^\d.]/g, '');
      const items = pq.items.map((it, idx) => {
        if (idx !== i) return it;
        const p = v === '' ? null : Number(v);
        return { ...it, unit_price: (v === '' || Number.isNaN(p)) ? null : p, _priceInput: v };
      });
      const total = items.reduce((s, it) => s + (it.unit_price != null ? Number(it.unit_price) * (Number(it.qty) || 1) : 0), 0);
      return { ...pq, items, total };
    });
  };

  // Send the reviewed quote as a structured, acceptable message.
  const sendQuote = async () => {
    if (!pendingQuote || !activeId || sending) return;
    setSending(true);
    try {
      const items = pendingQuote.items.map(({ _priceInput, ...it }) => it);
      const allPriced = items.every((it) => it.unit_price != null);
      const text = cleanPricedBody(pendingQuote.text, allPriced);
      const q = { items, currency: pendingQuote.currency, total: pendingQuote.total };
      const msg = await sendSupplierQuote(activeId, text, q);
      setMessages((m) => [...m, msg]);
      // Fully close the draft: clear the review card AND the composer text it was
      // drafted from, so nothing re-drafts the same request into a new box.
      setPendingQuote(null);
      setDraft('');
      loadThreads();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
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

  // Reopen the vessel's general thread with this supplier. A supplier can't
  // START a conversation any more (the vessel opens private DMs), so this only
  // surfaces an existing general thread — the button is hidden otherwise.
  const startNewChat = async (g) => {
    setCollapsed((prev) => { const n = new Set(prev); n.delete(g.tenantId); return n; });
    try {
      const thread = g.general || (await getOrCreateThread(supplierId, g.tenantId, null));
      if (!thread) { setError('New conversations are started by the vessel.'); return; }
      setActiveId(thread.id);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) { setError(e.message); }
  };

  // Which colleague on our team handles this conversation (supplier-side call).
  const openAssign = async () => {
    if (!activeId) return;
    const next = !assignOpen;
    setAssignOpen(next);
    if (next) {
      try { setAssignContacts(await fetchThreadContacts(activeId)); }
      catch (e) { setError(e.message); }
    }
  };
  const doAssign = async (contactId) => {
    if (!activeId || assignBusy) return;
    setAssignBusy(true); setError(null);
    try {
      await assignThreadContact(activeId, contactId);
      setAssignOpen(false);
      fetchMessages(activeId).then(setMessages).catch(() => {});
      await loadThreads();
    } catch (e) { setError(e.message); }
    finally { setAssignBusy(false); }
  };

  // Contact card + messaging profile (mirrors the crew side).
  const openCard = async (p) => {
    if (!activeId) return;
    if (cardPerson?.user_id === p.user_id) { setCardPerson(null); return; }
    setCardPerson(p); setCardDetail(null); setStatusEditing(false);
    try { setCardDetail(await fetchPersonCard(activeId, p.user_id)); }
    catch (e) { setError(e.message); }
  };
  const saveStatus = async () => {
    if (statusSaving || !myUid || !cardDetail) return;
    setStatusSaving(true); setError(null);
    try {
      await saveMyMessagingProfile(myUid, { about: statusDraft, work_phone: cardDetail.phone });
      const fresh = await fetchPersonCard(activeId, cardPerson.user_id);
      setCardDetail(fresh);
      setStatusEditing(false);
    } catch (e) { setError(e.message); }
    finally { setStatusSaving(false); }
  };
  // Add / remove one of MY OWN team on the thread.
  const openPeople = async () => {
    if (!activeId) return;
    setCardPerson(null);
    const next = !peopleOpen; setPeopleOpen(next); setAddSearch('');
    if (next) { try { setAddable(await fetchAddableSupplier(activeId)); } catch (e) { setError(e.message); } }
  };
  const addColleague = async (userId) => {
    if (!activeId || peopleBusy) return;
    setPeopleBusy(true); setError(null);
    try {
      await addThreadParticipant(activeId, userId, 'supplier');
      await loadThreads();
      fetchMessages(activeId).then(setMessages).catch(() => {});
      setAddable(await fetchAddableSupplier(activeId));
    } catch (e) { setError(e.message); }
    finally { setPeopleBusy(false); }
  };
  const removeColleague = async (userId) => {
    if (!activeId || peopleBusy) return;
    setPeopleBusy(true); setError(null);
    try {
      await removeThreadParticipant(activeId, userId);
      setCardPerson(null);
      await loadThreads();
      fetchMessages(activeId).then(setMessages).catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setPeopleBusy(false); }
  };
  const openProfile = () => {
    if (!cardPerson || !cardDetail) return;
    setProfileModal({ person: cardPerson, detail: cardDetail });
    setProfEditing(false);
    setProfAbout(cardDetail.about || '');
    setProfPhone(cardDetail.phone || '');
    setCardPerson(null);
  };
  const saveProfile = async () => {
    if (profSaving || !myUid) return;
    setProfSaving(true); setError(null);
    try {
      await saveMyMessagingProfile(myUid, { about: profAbout, work_phone: profPhone });
      const fresh = await fetchPersonCard(activeId, profileModal.person.user_id);
      setProfileModal((m) => (m ? { ...m, detail: fresh } : m));
      setProfEditing(false);
    } catch (e) { setError(e.message); }
    finally { setProfSaving(false); }
  };

  const rendered = useMemo(() => {
    const out = [];
    let lastDay = null, lastSender = null, lastUser = null, lastTime = 0;
    for (const msg of messages) {
      const t = new Date(msg.created_at).getTime();
      const dk = new Date(msg.created_at).toDateString();
      if (dk !== lastDay) { out.push({ kind: 'divider', id: `d${dk}`, at: msg.created_at }); lastSender = null; lastUser = null; }
      const grouped = msg.sender_type === lastSender && msg.sender_user_id === lastUser && (t - lastTime) < 5 * 60000 && dk === lastDay;
      out.push({ kind: 'msg', msg, grouped });
      lastDay = dk; lastSender = msg.sender_type; lastUser = msg.sender_user_id; lastTime = t;
    }
    return out;
  }, [messages]);

  // Roster of the open thread → name each crew sender in a group conversation.
  const roster = peopleByThread[activeId] || [];
  const isGroup = roster.length > 2;
  const nameForUid = (uid) => roster.find((p) => p.user_id === uid)?.name || null;

  // Counts for the filter dropdown.
  const counts = useMemo(() => {
    const nonArch = threads.filter((t) => !t.archived_at);
    return {
      open: nonArch.filter((t) => t.last_message_at || t.id === activeId).length,
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
      // Keep the order-less "general" thread for the start-a-chat action even
      // when empty; only SHOW threads with messages (or the open one).
      const general = list.find((t) => !t.order_id) || null;
      const visible = list.filter((t) => t.last_message_at || t.id === activeId);
      const unread = visible.reduce((s, t) => s + (t.id === activeId ? 0 : (t.supplier_unread_count || 0)), 0);
      const waitList = visible.filter((t) => t.last_sender_type === 'vessel');
      const oldest = waitList.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null);
      const lastAt = list.reduce((acc, t) => { const v = t.last_message_at || t.created_at; return !acc || v > acc ? v : acc; }, null);
      out.push({ tenantId, name: names[tenantId] || list[0]?.tenants?.name || 'Yacht client', threads: visible, general, unread, awaiting: waitList.length, oldest, lastAt });
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
              <Menu label="Filter" value={filter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} onChange={setFilter} />
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
                    <div className="msg-grp-headrow">
                      <button type="button" className="msg-grp-head" onClick={() => toggleGroup(g.tenantId)}>
                        <span className={`msg-grp-chev${isCollapsed ? ' c' : ''}`}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        </span>
                        {boat(g.tenantId, g.name)}
                        <span className="msg-grp-name">{g.name}</span>
                        <span className="msg-grp-meta">
                          {g.awaiting > 0 && g.oldest && <span className="msg-grp-wait">{fmtAge(g.oldest)}</span>}
                          {g.unread > 0 ? <span className="msg-grp-un">{g.unread}</span> : g.threads.length > 0 && <span className="msg-grp-count">{g.threads.length}</span>}
                        </span>
                      </button>
                      {g.general && (
                        <button type="button" className="msg-grp-new" title={`Reopen general chat with ${g.name}`} aria-label="Reopen general chat" onClick={() => startNewChat(g)}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                      )}
                    </div>
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
                  {boat(activeThread.tenant_id, nameFor(activeThread), 'lg')}
                  <div className="msg-convo-id">
                    <button type="button" className="msg-convo-name" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}>{nameFor(activeThread)}</button>
                    <div className="msg-convo-sub">
                      <div className="msg-assign">
                        <button type="button" className={`msg-assign-btn${assignedByThread[activeId] ? ' set' : ''}`} onClick={openAssign} title="Assign this conversation to a colleague">
                          {assignedByThread[activeId]?.name ? `Handled by ${assignedByThread[activeId].name}` : 'Assign to a colleague'}
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        </button>
                        {assignOpen && (
                          <div className="msg-assign-menu" role="menu">
                            <div className="msg-assign-head">Handled by…</div>
                            {assignContacts.map((c) => (
                              <button key={c.contact_id} type="button" className={`msg-assign-opt${assignedByThread[activeId]?.contact_id === c.contact_id ? ' on' : ''}`} disabled={assignBusy} onClick={() => doAssign(c.contact_id)} role="menuitem">
                                <span className="msg-assign-name">{c.name}</span>
                                <span className="msg-assign-role">{c.role}{c.has_login ? '' : ' · no login'}</span>
                              </button>
                            ))}
                            {!assignContacts.length && <div className="msg-assign-empty">No colleagues on file</div>}
                            {assignedByThread[activeId] && <button type="button" className="msg-assign-clear" disabled={assignBusy} onClick={() => doAssign(null)} role="menuitem">Clear</button>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="msg-convo-actions">
                    <div className="msg-people">
                      <div className="msg-facepile">
                        {(peopleByThread[activeId] || []).slice(0, 12).map((p) => {
                          const nm = p.name || (p.party === 'crew' ? 'Crew' : 'Supplier');
                          const role = p.party === 'crew' ? (p.role || 'crew') : `${p.role || 'sales'} · supplier`;
                          return (
                            <button key={p.user_id} type="button" className="msg-face" style={{ backgroundImage: faceGrad(p) }} title={`${nm}${p.user_id === myUid ? ' (you)' : ''} — ${role}`} onClick={() => openCard(p)}>
                              {initials(nm)}
                              {p.party === 'supplier' && p.user_id !== myUid && (
                                <span className="msg-face-x" role="button" tabIndex={0} title={`Remove ${nm}`} aria-label={`Remove ${nm}`} onClick={(e) => { e.stopPropagation(); removeColleague(p.user_id); }}>
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                </span>
                              )}
                            </button>
                          );
                        })}
                        <button type="button" className="msg-face add" onClick={openPeople} title="Add a colleague to this chat" aria-label="Add a colleague">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                        </button>
                      </div>
                      {peopleOpen && (() => {
                        const q = addSearch.trim().toLowerCase();
                        const list = addable.filter((c) => !q || (c.name || '').toLowerCase().includes(q));
                        return (
                          <div className="msg-people-menu" role="menu">
                            <div className="msg-add-search">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                              <input type="text" placeholder="Search your team…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} autoFocus />
                            </div>
                            <div className="msg-assign-head">Add a colleague</div>
                            {list.map((c) => (
                              <button key={c.user_id} type="button" className="msg-assign-opt" disabled={peopleBusy} onClick={() => addColleague(c.user_id)} role="menuitem">
                                <span className="msg-face sm" style={{ backgroundImage: supGrad(c.user_id) }} aria-hidden>{initials(c.name)}</span>
                                <span className="msg-people-info">
                                  <span className="msg-assign-name">{c.name}</span>
                                  <span className="msg-assign-role">{(c.role || '').toLowerCase()}</span>
                                </span>
                              </button>
                            ))}
                            {!list.length && <div className="msg-assign-empty">{addable.length ? 'No matches' : 'Everyone’s already in'}</div>}
                          </div>
                        );
                      })()}
                      {cardPerson && (
                        <div className="msg-card" role="dialog" aria-label="Contact card">
                          <button type="button" className="msg-card-close" onClick={() => setCardPerson(null)} aria-label="Close">×</button>
                          {!cardDetail ? <div className="msg-card-loading">Loading…</div> : (
                            <>
                              <div className="msg-card-top">
                                {cardDetail.avatar_url
                                  ? <img className="msg-face lg" src={cardDetail.avatar_url} alt="" />
                                  : <span className="msg-face lg" style={{ backgroundImage: faceGrad({ party: cardDetail.party, user_id: cardPerson.user_id }) }}>{initials(cardDetail.name)}</span>}
                                <div className="msg-card-idblock">
                                  <div className="msg-card-name">{cardDetail.name}{cardPerson.user_id === myUid ? ' (you)' : ''}</div>
                                  <div className="msg-card-badges">
                                    <span className={`msg-card-badge ${cardDetail.party}`}>{cardDetail.party === 'supplier' ? 'Supplier' : 'Crew'}</span>
                                    {(cardDetail.position || cardDetail.tier || cardDetail.role) && <span className="msg-card-role">{(cardDetail.position || cardDetail.tier || cardDetail.role || '').toString().toLowerCase()}</span>}
                                  </div>
                                </div>
                              </div>
                              {cardPerson.user_id === myUid ? (
                                statusEditing ? (
                                  <input className="msg-card-status-in" autoFocus maxLength={80} value={statusDraft} placeholder="Set your status…" disabled={statusSaving}
                                    onChange={(e) => setStatusDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') saveStatus(); if (e.key === 'Escape') setStatusEditing(false); }}
                                    onBlur={saveStatus} />
                                ) : (
                                  <button type="button" className={`msg-card-status own${cardDetail.about ? '' : ' empty'}`} onClick={() => { setStatusDraft(cardDetail.about || ''); setStatusEditing(true); }}>
                                    {cardDetail.about ? `“${cardDetail.about}”` : 'Set your status…'}
                                    <span className="msg-card-status-pen" aria-hidden>✎</span>
                                  </button>
                                )
                              ) : (
                                cardDetail.about ? <div className="msg-card-status">“{cardDetail.about}”</div> : null
                              )}
                              <div className="msg-card-rows">
                                {cardDetail.department && <div className="msg-card-row"><span className="msg-card-k">Department</span><span className="msg-card-v">{cardDetail.department}</span></div>}
                                {cardDetail.email ? <a className="msg-card-row link" href={`mailto:${cardDetail.email}`}><span className="msg-card-k">Email</span><span className="msg-card-v">{cardDetail.email}</span></a> : null}
                                {cardDetail.phone ? <a className="msg-card-row link" href={`tel:${cardDetail.phone}`}><span className="msg-card-k">Phone</span><span className="msg-card-v">{cardDetail.phone}</span></a> : null}
                                {!cardDetail.email && !cardDetail.phone && !cardDetail.department && <div className="msg-card-row"><span className="msg-card-v muted">No contact details yet</span></div>}
                              </div>
                              <button type="button" className="msg-card-profile" onClick={openProfile}>View profile →</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {phone && <a className="msg-ic" href={`tel:${phone}`} title={`Call ${contact || 'yacht'}`} aria-label="Call"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.86.68 2.75a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.33-1.33a2 2 0 0 1 2.11-.45c.89.32 1.81.55 2.75.68A2 2 0 0 1 22 16.92z" /></svg></a>}
                    <button type="button" className="msg-ic" title="View client profile" aria-label="View profile" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></button>
                  </div>
                </div>

                {profileModal && (() => {
                  const d = profileModal.detail || {};
                  const isMe = profileModal.person.user_id === myUid;
                  return (
                    <div className="msg-profile-overlay" onClick={() => setProfileModal(null)}>
                      <div className="msg-profile" role="dialog" aria-label="Messaging profile" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="msg-profile-x" onClick={() => setProfileModal(null)} aria-label="Close">×</button>
                        <div className="msg-profile-hero">
                          {d.avatar_url
                            ? <img className="msg-face xl" src={d.avatar_url} alt="" />
                            : <span className="msg-face xl" style={{ backgroundImage: faceGrad({ party: d.party, user_id: profileModal.person.user_id }) }}>{initials(d.name)}</span>}
                          <div className="msg-profile-name">{d.name}{isMe ? ' (you)' : ''}</div>
                          <div className="msg-profile-sub">
                            <span className={`msg-card-badge ${d.party}`}>{d.party === 'supplier' ? 'Supplier' : 'Crew'}</span>
                            {(d.position || d.tier || d.role) && <span className="msg-card-role">{(d.position || d.tier || d.role || '').toString().toLowerCase()}</span>}
                          </div>
                        </div>
                        {profEditing ? (
                          <div className="msg-profile-edit">
                            <label className="msg-profile-lab">Status</label>
                            <input className="msg-profile-in" value={profAbout} maxLength={80} placeholder={d.party === 'supplier' ? 'e.g. Back Mon — covering AM orders' : 'e.g. On charter · best reached after watch'} onChange={(e) => setProfAbout(e.target.value)} />
                            <label className="msg-profile-lab">Work phone</label>
                            <input className="msg-profile-in" value={profPhone} placeholder="+44 …" onChange={(e) => setProfPhone(e.target.value)} />
                            <div className="msg-profile-editrow">
                              <button type="button" className="msg-card-remove" style={{ marginTop: 0 }} disabled={profSaving} onClick={() => setProfEditing(false)}>Cancel</button>
                              <button type="button" className="msg-card-profile" style={{ marginTop: 0 }} disabled={profSaving} onClick={saveProfile}>{profSaving ? 'Saving…' : 'Save'}</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {d.about && <div className="msg-profile-about">“{d.about}”</div>}
                            <div className="msg-card-rows">
                              {d.party === 'crew' && d.department ? <div className="msg-card-row"><span className="msg-card-k">Department</span><span className="msg-card-v">{d.department}</span></div> : null}
                              {d.email ? <a className="msg-card-row link" href={`mailto:${d.email}`}><span className="msg-card-k">Email</span><span className="msg-card-v">{d.email}</span></a> : null}
                              {d.phone ? <a className="msg-card-row link" href={`tel:${d.phone}`}><span className="msg-card-k">Work phone</span><span className="msg-card-v">{d.phone}</span></a> : null}
                              {!d.email && !d.phone && <div className="msg-card-row"><span className="msg-card-v muted">No contact details yet</span></div>}
                            </div>
                            {isMe && <button type="button" className="msg-card-profile" onClick={() => { setProfEditing(true); setProfAbout(d.about || ''); setProfPhone(d.phone || ''); }}>Edit my profile</button>}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {activeArchived && (
                  <div className="msg-arch-banner">
                    Archived conversation — it’ll reopen automatically if either side writes.
                    <button type="button" onClick={() => archiveThread(activeThread)}>Restore</button>
                  </div>
                )}

                {activeOrder && (
                  <div className="msg-ctx">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                    <span>{activeThread.order_id ? 'This order' : 'Latest order'} <b>#{shortId(activeOrder.id)}</b> · <span style={{ textTransform: 'capitalize' }}>{activeOrder.status}</span> · {fmtMoney(orderTotal(activeOrder), activeOrder.currency || 'EUR')}</span>
                    <button type="button" className="msg-ctx-go" onClick={() => navigate(`/supplier/orders/${activeOrder.id}`)}>View order →</button>
                  </div>
                )}

                <div className="msg-stream" ref={streamRef}>
                  {rendered.length === 0 ? (
                    <div className="msg-blank">
                      <div className={`msg-blank-av${logos[activeThread.tenant_id] ? ' has-logo' : ''}`} style={logos[activeThread.tenant_id] ? undefined : { background: avatarGrad(activeThread.tenant_id) }}>
                        {logos[activeThread.tenant_id] ? <img src={logos[activeThread.tenant_id]} alt="" /> : initials(nameFor(activeThread))}
                      </div>
                      <div className="msg-blank-title">Say hello to {nameFor(activeThread)}</div>
                      <div className="msg-blank-sub">
                        {activeOrder
                          ? <>Last order <b>#{shortId(activeOrder.id)}</b> · {activeOrder.status} · {fmtMoney(orderTotal(activeOrder), activeOrder.currency || 'EUR')}</>
                          : 'Start the conversation — they’ll get it in their inbox.'}
                      </div>
                      <button type="button" className="msg-blank-cta" onClick={() => { const who = contact ? contact.trim().split(/\s+/)[0] : 'there'; setDraft(`Hi ${who} — just checking in on ${nameFor(activeThread)}. Anything I can help you provision for your next trip?`); taRef.current?.focus(); }}>
                        Send a check-in
                      </button>
                    </div>
                  ) : rendered.map((r) => {
                    if (r.kind === 'divider') return <div key={r.id} className="msg-daysep"><span>{dayLabel(r.at)}</span></div>;
                    const m = r.msg;
                    const read = activeThread?.vessel_last_read_at && new Date(activeThread.vessel_last_read_at) >= new Date(m.created_at);
                    const tick = m.sender_type === 'supplier' ? <span className={`msg-tick${read ? ' read' : ''}`}>{read ? '✓✓' : '✓'}</span> : null;
                    if (m.kind === 'system') return <div key={m.id} className="msg-sysnote"><span>{m.body}</span></div>;
                    if (m.kind === 'quote') {
                      const q = m.quote || {};
                      const items = Array.isArray(q.items) ? q.items : [];
                      const status = m.quote_status || 'pending';
                      return (
                        <div key={m.id} className={`msg-row ${m.sender_type === 'supplier' ? 'me' : 'them'}`}>
                          <div className="msg-quotecard">
                            <div className="msg-qc-head"><span className="msg-qc-badge">✦ Quote</span><span className={`msg-qc-status ${status}`}>{status}</span></div>
                            <div className="msg-qc-items">
                              {items.map((it, i) => {
                                const k = `${m.id}:${i}`;
                                const bespoke = m.sender_type === 'supplier' && it.matched === false;
                                const priceHere = pricing === m.id && it.unit_price == null;
                                return (
                                  <div key={i} className="msg-qc-item">
                                    <span className="msg-qc-name">{it.qty}× {it.name}{it.unit ? ` (${it.unit})` : ''}</span>
                                    <span className="msg-qc-right">
                                      {priceHere ? (
                                        <span className="msg-qc-pricein">
                                          <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus={i === Object.keys(priceDraft).map(Number).sort((a, b) => a - b)[0]}
                                            value={priceDraft[i] ?? ''} placeholder="0.00"
                                            onChange={(e) => setPriceDraft((d) => ({ ...d, [i]: e.target.value }))} />
                                          <span className="msg-qc-cur">{(it.currency || q.currency || 'EUR')} /unit</span>
                                        </span>
                                      ) : (
                                        <span className="msg-qc-price">{it.unit_price != null ? fmtMoney(Number(it.unit_price) * (Number(it.qty) || 1), it.currency || q.currency) : '—'}</span>
                                      )}
                                      {bespoke && !priceHere && (savedCat.has(k)
                                        ? <span className="msg-qc-saved">✓ In catalogue</span>
                                        : <button type="button" className="msg-qc-save" disabled={savingCat === k} onClick={() => saveToCatalogue(k, { ...it, currency: it.currency || q.currency })}>{savingCat === k ? 'Saving…' : '+ Save to catalogue'}</button>)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            {q.total > 0 && <div className="msg-qc-total"><span>Total</span><span>{fmtMoney(q.total, q.currency)}</span></div>}
                            {m.body && <div className="msg-qc-note">{m.body}</div>}
                            {status === 'pending' && m.quote_expires_at && (
                              new Date(m.quote_expires_at).getTime() < Date.now()
                                ? <div className="msg-qc-expired">⏱ Expired {fmtExpiry(m.quote_expires_at)} — revise &amp; re-send to renew</div>
                                : <div className="msg-qc-valid">Valid until {fmtExpiry(m.quote_expires_at)}</div>
                            )}
                            {m.sender_type === 'supplier' && status === 'pending' && items.some((it) => it.unit_price == null) && (
                              pricing === m.id ? (
                                <div className="msg-qc-actions">
                                  <button type="button" className="msg-qc-decline" onClick={cancelPricing}>Cancel</button>
                                  <button type="button" className="msg-qc-accept" disabled={sending} onClick={() => sendPrices(m)}>{sending ? 'Sending…' : 'Send updated quote'}</button>
                                </div>
                              ) : (
                                <div className="msg-qc-actions">
                                  <button type="button" className="msg-qc-accept" onClick={() => startPricing(m)}>Add prices</button>
                                </div>
                              )
                            )}
                            {m.sender_type === 'supplier' && status === 'declined' && (
                              <>
                                {m.quote_decline_reason && (
                                  <div className="msg-qc-reason-note">Declined: {m.quote_decline_reason}</div>
                                )}
                                <div className="msg-qc-actions">
                                  <button type="button" className="msg-qc-accept" onClick={() => requote(m)}>Revise &amp; re-quote</button>
                                </div>
                              </>
                            )}
                            <span className="msg-time">{fmtClock(m.created_at)}{tick}</span>
                          </div>
                        </div>
                      );
                    }
                    const src = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
                    const repliedMsg = src ? {
                      label: src.sender_type === 'supplier' ? 'You' : nameFor(activeThread),
                      snippet: src.deleted_at ? 'Message deleted' : (src.kind === 'quote' ? 'Quote' : String(src.body || '').slice(0, 90)),
                    } : null;
                    const mineMsg = m.sender_user_id ? m.sender_user_id === myUid : m.sender_type === 'supplier';
                    const senderLabel = (isGroup && !mineMsg && !r.grouped && m.kind !== 'system')
                      ? (nameForUid(m.sender_user_id) || (m.sender_type === 'supplier' ? 'Supplier' : nameFor(activeThread)))
                      : null;
                    return (
                      <MessageBubble
                        key={m.id}
                        m={m}
                        grouped={r.grouped}
                        mine={mineMsg}
                        time={fmtClock(m.created_at)}
                        tick={tick}
                        repliedMsg={repliedMsg}
                        myUid={myUid}
                        senderLabel={senderLabel}
                        onReply={startReply}
                        onReact={doReact}
                        onDelete={doDelete}
                        onEdit={startEdit}
                        onJumpTo={jumpTo}
                      />
                    );
                  })}
                  <div ref={endRef} />
                </div>

                <div className="msg-foot">
                  {pendingQuote && (
                    <div className="msg-qreview">
                      <div className="msg-qreview-head">
                        <span className="msg-qc-badge">✦ Quote to send</span>
                        <button type="button" className="msg-qreview-x" onClick={() => setPendingQuote(null)} aria-label="Discard">✕</button>
                      </div>
                      <div className="msg-qc-items">
                        {pendingQuote.items.map((it, i) => {
                          // Bespoke lines (no catalogue match) stay editable so a typed
                          // price can always be corrected; on a re-quote every line is
                          // editable so the supplier can revise catalogue prices too.
                          const editable = pendingQuote.requote || it.matched === false;
                          return (
                            <div key={i} className="msg-qc-item">
                              <span className="msg-qc-name">{it.qty}× {it.name}{it.unit ? ` (${it.unit})` : ''}</span>
                              {editable ? (
                                <span className="msg-qc-pricein">
                                  <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                                    value={it._priceInput ?? (it.unit_price != null ? String(it.unit_price) : '')}
                                    onChange={(e) => setPendingPrice(i, e.target.value)} />
                                  <span className="msg-qc-cur">{(it.currency || pendingQuote.currency || 'EUR')} /unit</span>
                                </span>
                              ) : (
                                <span className="msg-qc-price">{it.unit_price != null ? fmtMoney(Number(it.unit_price) * (Number(it.qty) || 1), it.currency || pendingQuote.currency) : '—'}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {pendingQuote.total > 0 && <div className="msg-qc-total"><span>Total</span><span>{fmtMoney(pendingQuote.total, pendingQuote.currency)}</span></div>}
                      <div className="msg-qreview-actions">
                        <button type="button" className="msg-qreview-cancel" onClick={() => setPendingQuote(null)}>Discard</button>
                        <button type="button" className="msg-qreview-send" onClick={sendQuote} disabled={sending}>{sending ? 'Sending…' : 'Send quote'}</button>
                      </div>
                      <div className="msg-qreview-hint">
                        {pendingQuote.items.some((it) => it.unit_price == null)
                          ? 'Leave a price blank to send now and confirm it later, or type it in above. The yacht can accept once it’s priced.'
                          : 'The yacht can accept this to add the items to the order.'}
                      </div>
                    </div>
                  )}
                  <div className="msg-quick">
                    <button type="button" className="msg-qchip msg-qchip-ai" onClick={toQuote} disabled={aiLoading} title="Turn the request into a priced quote using your catalogue">
                      {aiLoading ? 'Drafting quote…' : '✨ Turn into a quote'}
                    </button>
                    <div className="msg-tpl">
                      <button type="button" className="msg-qchip" onClick={() => setTplOpen((o) => !o)} title="Insert a saved reply">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: '-1px' }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                        Saved replies
                      </button>
                      {tplOpen && (
                        <div className="msg-tpl-menu" role="menu">
                          <div className="msg-assign-head">Saved replies</div>
                          {templates.map((t) => (
                            <div key={t.id} className="msg-tpl-row">
                              <button type="button" className="msg-tpl-insert" onClick={() => insertTemplate(t)} title="Insert into your reply">
                                {t.label && <span className="msg-tpl-label">{t.label}</span>}
                                <span className="msg-tpl-body">{t.body}</span>
                              </button>
                              <button type="button" className="msg-tpl-x" disabled={tplBusy} title="Delete" aria-label="Delete saved reply" onClick={() => removeTemplate(t.id)}>×</button>
                            </div>
                          ))}
                          {!templates.length && <div className="msg-assign-empty">No saved replies yet</div>}
                          <button type="button" className="msg-tpl-save" disabled={!draft.trim() || tplBusy} onClick={saveCurrentAsTemplate} title={draft.trim() ? 'Save what you’ve typed as a reusable reply' : 'Type a message first'}>＋ Save current message</button>
                        </div>
                      )}
                    </div>
                    {QUICK.map((q) => (
                      q.status
                        ? <button key={q.label} type="button" className="msg-qchip msg-qchip-status" disabled={sending} title={activeOrder ? `Marks order #${shortId(activeOrder.id)} out for delivery` : undefined} onClick={() => deliveryAction(q)}>{q.label}</button>
                        : <button key={q.label} type="button" className="msg-qchip" onClick={() => quick(q.text)}>{q.label}</button>
                    ))}
                  </div>
                  {editing ? (
                    <div className="msg-replybar is-edit">
                      <div className="msg-replybar-body">
                        <span className="msg-replybar-label">Editing message</span>
                        <span className="msg-replybar-snip">{String(editing.body || '').slice(0, 120)}</span>
                      </div>
                      <button type="button" className="msg-replybar-x" onClick={cancelEdit} aria-label="Cancel edit">✕</button>
                    </div>
                  ) : replyTo && (
                    <div className="msg-replybar">
                      <div className="msg-replybar-body">
                        <span className="msg-replybar-label">Replying to {replyTo.sender_type === 'supplier' ? 'yourself' : nameFor(activeThread)}</span>
                        <span className="msg-replybar-snip">{replyTo.deleted_at ? 'Message deleted' : (replyTo.kind === 'quote' ? 'Quote' : String(replyTo.body || '').slice(0, 120))}</span>
                      </div>
                      <button type="button" className="msg-replybar-x" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
                    </div>
                  )}
                  {(attachments.length > 0 || uploading) && (
                    <div className="msg-attach-tray">
                      {attachments.map((a, i) => (
                        <span key={i} className="msg-attach-chip">
                          {(a.type || '').startsWith('image/')
                            ? <img src={a.url} alt="" />
                            : <span className="msg-attach-chip-file">📄</span>}
                          <span className="msg-attach-chip-name">{a.name}</span>
                          <button type="button" onClick={() => removeAttachment(i)} aria-label="Remove">✕</button>
                        </span>
                      ))}
                      {uploading && <span className="msg-attach-chip loading">Uploading…</span>}
                    </div>
                  )}
                  <div className="msg-composer">
                    <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={onPickFiles} />
                    <button type="button" className="msg-attach-btn" title="Attach a photo or file" aria-label="Attach" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    </button>
                    <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={`Reply to ${nameFor(activeThread)}…  (Enter to send · Shift+Enter for a new line)`} rows={2} />
                    <button type="button" className="msg-send" disabled={(!draft.trim() && !attachments.length) || sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button>
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
