import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {formatTime, dateLocale } from '../../utils/dateFormat';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import {
  fetchVesselThreads, fetchThreadMessages, sendVesselMessage, markThreadReadVessel,
  markThreadNotificationsRead, acceptQuote, declineQuote, fetchAddableOrders, reactToMessage, deleteMessage, editMessage,
  setThreadArchived, deleteThread, uploadMessageAttachment,
  fetchOrderApprovalSettings, decideOrderApproval, getOrCreateDmThread,
  fetchThreadsPeople, fetchAddableCrew, addThreadParticipant, removeThreadParticipant, fetchPersonCard,
  saveMyMessagingProfile,
} from './storage';
import MessageBubble from '../../components/messaging/MessageBubble';
import './crew-messages.css';

// Crew (vessel) side of supplier messaging — mirrors the supplier command list:
// suppliers group their conversations (one per order + a general one); Filter /
// Sort dropdowns triage; the open conversation lifts out of a recessed list onto
// a white card. Read + reply to your suppliers.

const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
// Whole amounts show clean (€60); non-whole show cents (€89.90) so quote
// totals reflect typed prices exactly rather than rounding to the nearest euro.
const fmtMoney = (a, cur = 'EUR') => {
  const n = Number(a) || 0;
  const dp = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const supplierName = (t) => t?.supplier_profiles?.name || 'Supplier';
const supplierLogo = (t) => t?.supplier_profiles?.logo_url || null;
const threadLabel = (t) => (t?.order_id ? `Order #${shortId(t.order_id)}` : 'General');
// The provisioning board this conversation relates to (via the order's list), so
// crew can jump from a chat straight to the board it's about.
const threadBoard = (t) => t?.supplier_orders?.provisioning_lists || null;
// Spend sign-off tiers (shared with Defects) — higher rank may always approve.
const TIER_RANK = { COMMAND: 4, CHIEF: 3, HOD: 2, CREW: 1 };
const threadOrder = (t) => t?.supplier_orders || null;
// Quote validity (per the supplier's expiry window, stamped on the message).
const quoteExpired = (m) => !!m?.quote_expires_at && new Date(m.quote_expires_at).getTime() < Date.now();
const fmtDmy = (d) => (d ? new Date(d).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

// Optimistic mirror of react_to_message: one reaction per user — tapping the
// same emoji clears it, a different emoji replaces it.
const toggleReaction = (reactions, emoji, uid) => {
  const arr = Array.isArray(reactions) ? reactions : [];
  const hadSame = arr.some((r) => r.uid === uid && r.emoji === emoji);
  const without = arr.filter((r) => r.uid !== uid);
  return hadSame ? without : [...without, { emoji, by: 'vessel', uid, at: new Date().toISOString() }];
};

const AV_GRADS = [
  ['#3E5C76', '#1E3A5F'], ['#5B6B8C', '#39415C'], ['#6B7A99', '#454E68'],
  ['#2F6E8F', '#20405C'], ['#4B5D8A', '#2A2F52'], ['#527A8A', '#2E4A57'],
];
// Warm palette for supplier faces — distinguishes them from crew (cool navy)
// by colour instead of a dashed ring.
const SUP_GRADS = [
  ['#C65A1A', '#8A3D10'], ['#D2802E', '#A85E1E'], ['#B8551E', '#7C3410'],
  ['#CE6A2A', '#96481A'], ['#BE6733', '#8A4418'],
];
const hashId = (s = '') => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const avatarGrad = (id) => { const [a, b] = AV_GRADS[hashId(String(id)) % AV_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };
const supGrad = (id) => { const [a, b] = SUP_GRADS[hashId(String(id)) % SUP_GRADS.length]; return `linear-gradient(140deg, ${a}, ${b})`; };
// A person's avatar gradient — warm for supplier, cool for crew.
const faceGrad = (p) => (p?.party === 'supplier' ? supGrad(p.user_id) : avatarGrad(p.user_id));

const fmtClock = (d) => (d ? formatTime(d) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
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
  return new Date(d).toLocaleDateString(dateLocale(), { weekday: 'long', day: '2-digit', month: 'long' });
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

// ── Swipeable / hover-revealed thread row (Archive + Delete) ───────────────
const SW_LEFT = 132;  // Archive + Delete
const clampSw = (v) => Math.max(-SW_LEFT, Math.min(0, v));

const CrewThreadRow = ({ t, active, onSelect, onArchive, onDelete, label }) => {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const unread = active ? 0 : (t.vessel_unread_count || 0);
  const waiting = t.last_sender_type === 'supplier';
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
    else setDx(0);
  };
  const reset = () => setDx(0);

  const fgStyle = dx !== 0 ? { transform: `translateX(${dx}px)`, transition: dragging ? 'none' : undefined } : undefined;

  return (
    <div className={`msg-sw${dx < 0 ? ' open-l' : ''}`}>
      <div className="msg-sw-actions left" aria-hidden={dx >= 0}>
        <button type="button" className="msg-sw-btn archive" onClick={() => { reset(); onArchive(t); }}>
          {archived ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v13h18V7" /><path d="M1 3h22v4H1z" /><path d="M12 12v6" /><path d="M9 15l3-3 3 3" /></svg>Restore</> : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>Archive</>}
        </button>
        <button type="button" className="msg-sw-btn del" onClick={() => { reset(); onDelete(t); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></svg>Delete
        </button>
      </div>
      <div
        className={`msg-sw-fg${active ? ' on' : ''}${unread > 0 ? ' unread' : ''}${archived ? ' arch' : ''}${dragging ? ' dragging' : ''}`}
        style={fgStyle}
        role="button" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      >
        <span className="msg-row-main">
          <span className="msg-row-top">
            <span className="msg-row-label">{label || threadLabel(t)}</span>
            <span className="msg-row-when">{fmtWhen(t.last_message_at || t.created_at)}</span>
          </span>
          <span className="msg-row-prev">
            {t.last_message_preview ? `${t.last_sender_type === 'vessel' ? 'You: ' : ''}${t.last_message_preview}` : 'No messages yet'}
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

const CrewMessages = () => {
  const { activeTenantId } = useTenant();
  const { tenantRole } = useAuth();
  const userTier = (tenantRole || '').toUpperCase();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
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
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [declining, setDeclining] = useState(null);   // quote message id being declined
  const [declineReason, setDeclineReason] = useState('');
  const [choosing, setChoosing] = useState(null);     // quote message id in "which order?" mode
  const [addable, setAddable] = useState([]);         // open orders the quote can join
  const [attachments, setAttachments] = useState([]); // pending upload descriptors
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);   // opening a new DM thread
  const [assignedByThread, setAssignedByThread] = useState({}); // thread_id → assigned contact (read-only; the supplier assigns)
  const [peopleByThread, setPeopleByThread] = useState({});     // thread_id → participant roster
  const [peopleOpen, setPeopleOpen] = useState(false);          // add-crew picker open
  const [addableCrew, setAddableCrew] = useState([]);           // crew who can be added
  const [addSearch, setAddSearch] = useState('');               // add-picker search
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [cardPerson, setCardPerson] = useState(null);           // participant whose card is open
  const [cardDetail, setCardDetail] = useState(null);           // fetched card detail
  const [profileModal, setProfileModal] = useState(null);       // { person, detail } messaging profile
  const [profEditing, setProfEditing] = useState(false);
  const [profAbout, setProfAbout] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profSaving, setProfSaving] = useState(false);
  const [approverTier, setApproverTier] = useState('HOD');
  const [myUid, setMyUid] = useState(null);
  const fileRef = useRef(null);

  // Who may sign off an over-threshold chat order (shared with Defects config).
  useEffect(() => {
    if (!activeTenantId) return;
    fetchOrderApprovalSettings(activeTenantId).then((s) => setApproverTier(s.approverTier)).catch(() => {});
  }, [activeTenantId]);
  const canSignOff = (TIER_RANK[userTier] || 0) >= (TIER_RANK[approverTier] || 2);
  const endRef = useRef(null);
  const streamRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyUid(data?.user?.id ?? null)); }, []);

  const load = useCallback(async () => {
    if (!activeTenantId) return [];
    const th = await fetchVesselThreads(activeTenantId);
    setThreads(th);
    fetchThreadsPeople().then((rows) => {
      const a = {}, p = {};
      for (const r of rows) { a[r.thread_id] = r.assigned; p[r.thread_id] = r.people || []; }
      setAssignedByThread(a); setPeopleByThread(p);
    }).catch(() => {});
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
    setReplyTo(null); setEditing(null); setDraft('');
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'supplier_messages', filter: `thread_id=eq.${activeId}` }, (payload) => {
        const msg = payload.new;
        setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, ...msg } : x)));
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

  // Pin the stream to the newest message on open + on new messages. Scroll now,
  // on the next paint, and once more after layout settles (avatars/attachments
  // can push content down after the first pass).
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return undefined;
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    toBottom();
    const raf = requestAnimationFrame(toBottom);
    const t = setTimeout(toBottom, 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [messages, activeId]);

  const totalUnread = useMemo(() => threads.reduce((s, t) => s + (t.id === activeId || t.archived_at ? 0 : (t.vessel_unread_count || 0)), 0), [threads, activeId]);
  const awaiting = useMemo(() => threads.filter((t) => !t.archived_at && t.last_sender_type === 'supplier'), [threads]);
  const awaitingReply = awaiting.length;
  const oldestWaiting = useMemo(() => awaiting.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null), [awaiting]);

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
        const msg = await sendVesselMessage(activeId, body, replyTo?.id ?? null, attachments);
        setMessages((m) => [...m, msg]);
        setReplyTo(null);
        setAttachments([]);
        load();
      }
      setDraft('');
    } catch (e) { setError(e.message); }
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

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); } };
  const quick = (text) => { setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)); taRef.current?.focus(); };

  // Start (or reopen) my own private thread with this supplier. Reuses my
  // existing general DM if I already have one in the list; otherwise the RPC
  // opens a fresh 1:1 (stamping me as a participant so the new RLS lets me in).
  const startNewChat = async (g) => {
    if (!g || starting) return;
    setCollapsed((prev) => { const n = new Set(prev); n.delete(g.supplierId); return n; });
    if (g.general) { setActiveId(g.general.id); requestAnimationFrame(() => taRef.current?.focus()); return; }
    setStarting(true);
    try {
      const thread = await getOrCreateDmThread(g.supplierId, activeTenantId);
      await load();
      setActiveId(thread.id);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) { setError(e.message); }
    finally { setStarting(false); }
  };

  // The "+" opens the add-crew picker (available people only, grouped by dept).
  const openPeople = async () => {
    if (!activeId) return;
    setCardPerson(null);
    const next = !peopleOpen;
    setPeopleOpen(next);
    setAddSearch('');
    if (next) { try { setAddableCrew(await fetchAddableCrew(activeId)); } catch (e) { setError(e.message); } }
  };
  const addCrew = async (userId) => {
    if (!activeId || peopleBusy) return;
    setPeopleBusy(true); setError(null);
    try {
      await addThreadParticipant(activeId, userId, 'crew');
      await load();
      setAddableCrew(await fetchAddableCrew(activeId));
    } catch (e) { setError(e.message); }
    finally { setPeopleBusy(false); }
  };
  const removeCrew = async (userId) => {
    if (!activeId || peopleBusy) return;
    setPeopleBusy(true); setError(null);
    try {
      await removeThreadParticipant(activeId, userId);
      setCardPerson(null);
      await load();
      if (peopleOpen) setAddableCrew(await fetchAddableCrew(activeId));
    } catch (e) { setError(e.message); }
    finally { setPeopleBusy(false); }
  };
  // Clicking a face opens that person's contact card.
  const openCard = async (p) => {
    if (!activeId) return;
    setPeopleOpen(false);
    if (cardPerson?.user_id === p.user_id) { setCardPerson(null); return; }
    setCardPerson(p); setCardDetail(null);
    try { setCardDetail(await fetchPersonCard(activeId, p.user_id)); }
    catch (e) { setError(e.message); }
  };
  // "View profile" — the fuller messaging profile (not the HR record).
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

  const startReply = (m) => { setEditing(null); setReplyTo(m); taRef.current?.focus(); };
  const startEdit = (m) => { setReplyTo(null); setEditing(m); setDraft(m.body || ''); taRef.current?.focus(); };
  const cancelEdit = () => { setEditing(null); setDraft(''); };
  const doReact = async (id, emoji) => {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, reactions: toggleReaction(x.reactions, emoji, myUid) } : x)));
    try { await reactToMessage(id, emoji); } catch (e) { setError(e.message); fetchThreadMessages(activeId).then(setMessages).catch(() => {}); }
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

  const resolveQuote = async (id, accept, reason = null, orderId = null) => {
    if (quoteBusy) return;
    setQuoteBusy(id);
    setError(null);
    try {
      if (accept) await acceptQuote(id, orderId); else await declineQuote(id, reason);
      setDeclining(null); setDeclineReason('');
      setChoosing(null); setAddable([]);
      const msgs = await fetchThreadMessages(activeId);
      setMessages(msgs);
      load();
    } catch (e) {
      setError(e.message || 'Couldn’t update the quote.');
    } finally { setQuoteBusy(null); }
  };

  // Accepting: if the crew member already has open orders with this supplier,
  // let them pick "new order" vs one of those; otherwise just make a new order.
  const beginAccept = async (m) => {
    if (quoteBusy) return;
    const supplierId = activeThread?.supplier_id || activeThread?.supplier_profiles?.id;
    if (!supplierId || !activeTenantId) { resolveQuote(m.id, true); return; }
    setQuoteBusy(m.id); setError(null);
    try {
      const orders = await fetchAddableOrders(supplierId, activeTenantId);
      setQuoteBusy(null);
      if (!orders.length) { resolveQuote(m.id, true); return; }
      setAddable(orders); setChoosing(m.id);
    } catch (e) {
      setQuoteBusy(null);
      setError(e.message || 'Couldn’t load your orders.');
    }
  };

  // Sign off (or decline) an over-threshold chat order that's pending approval.
  const [signBusy, setSignBusy] = useState(false);
  const signOffOrder = async (orderId, approved) => {
    if (signBusy || !orderId) return;
    if (!approved && !window.confirm('Decline this order? It won’t be placed with the supplier.')) return;
    setSignBusy(true); setError(null);
    try {
      await decideOrderApproval(orderId, approved);
      const msgs = await fetchThreadMessages(activeId);
      setMessages(msgs);
      await load();
    } catch (e) { setError(e.message || 'Couldn’t update the sign-off.'); }
    finally { setSignBusy(false); }
  };

  // Archive / restore a conversation (optimistic, then persist via RPC).
  const archiveThread = async (t) => {
    const next = !t.archived_at;
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, archived_at: next ? new Date().toISOString() : null } : x)));
    if (next && t.id === activeId) setActiveId(null);
    try { await setThreadArchived(t.id, next); await load(); }
    catch (e) { setError(e.message || 'Couldn’t archive that conversation.'); load(); }
  };

  // Delete a conversation for both sides — confirm first, it removes messages.
  const removeThread = async (t) => {
    if (!window.confirm(`Delete this conversation with ${supplierName(t)}? This removes it for you and the supplier.`)) return;
    setThreads((prev) => prev.filter((x) => x.id !== t.id));
    if (t.id === activeId) setActiveId(null);
    try { await deleteThread(t.id); await load(); }
    catch (e) { setError(e.message || 'Couldn’t delete that conversation.'); load(); }
  };

  const rendered = useMemo(() => {
    const out = [];
    let lastDay = null, lastSender = null, lastUser = null, lastTime = 0;
    for (const msg of messages) {
      const t = new Date(msg.created_at).getTime();
      const dk = new Date(msg.created_at).toDateString();
      if (dk !== lastDay) { out.push({ kind: 'divider', id: `d${dk}`, at: msg.created_at }); lastSender = null; lastUser = null; }
      // Group only consecutive messages from the SAME person (in a group chat
      // two crew both send as 'vessel' — don't merge their bubbles).
      const grouped = msg.sender_type === lastSender && msg.sender_user_id === lastUser && (t - lastTime) < 5 * 60000 && dk === lastDay;
      out.push({ kind: 'msg', msg, grouped });
      lastDay = dk; lastSender = msg.sender_type; lastUser = msg.sender_user_id; lastTime = t;
    }
    return out;
  }, [messages]);

  // Roster of the open thread → name each sender (only worth showing in a group,
  // where "who wrote this" isn't obvious). >2 participants = a group.
  const roster = peopleByThread[activeId] || [];
  const isGroup = roster.length > 2;
  const nameForUid = (uid) => roster.find((p) => p.user_id === uid)?.name || null;

  const counts = useMemo(() => {
    const nonArch = threads.filter((t) => !t.archived_at);
    return {
      open: nonArch.filter((t) => t.last_message_at || t.id === activeId).length,
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
      // Keep the order-less "general" thread for the start-a-chat action even
      // when empty; only SHOW threads that have messages (or the open one), so
      // empty order/general threads don't clutter the list.
      const general = list.find((t) => !t.order_id) || null;
      const visible = list.filter((t) => t.last_message_at || t.id === activeId);
      const unread = visible.reduce((s, t) => s + (t.id === activeId ? 0 : (t.vessel_unread_count || 0)), 0);
      const waitList = visible.filter((t) => t.last_sender_type === 'supplier');
      const oldest = waitList.reduce((acc, t) => (t.last_message_at && (!acc || t.last_message_at < acc) ? t.last_message_at : acc), null);
      const lastAt = list.reduce((acc, t) => { const v = t.last_message_at || t.created_at; return !acc || v > acc ? v : acc; }, null);
      out.push({ supplierId, name: supplierName(list[0]), logo: supplierLogo(list[0]), threads: visible, general, unread, awaiting: waitList.length, oldest, lastAt });
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
      <div className="cmsg-page">
        <div className="cmsg-wrap">
          <div className="cmsg-head">
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
            <h1 className="editorial-greeting cmsg-title">SUPPLIER<span className="period">,</span> <em>messages</em></h1>
          </div>

          {error && <div className="cmsg-error">{error}</div>}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#8B8478', fontSize: 13 }}>Loading messages…</div>
          ) : threads.length === 0 ? (
            <div className="cmsg-blank-page">
              <div className="cmsg-blank-ico">💬</div>
              <div className="cmsg-blank-t">No supplier messages yet</div>
              <div className="cmsg-blank-s">When a supplier messages your vessel, the conversation appears here for the crew to answer.</div>
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
                        <div className="msg-grp-headrow">
                          <button type="button" className="msg-grp-head" onClick={() => toggleGroup(g.supplierId)}>
                            <span className={`msg-grp-chev${isCollapsed ? ' c' : ''}`}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                            </span>
                            {avatar(g.supplierId, g.name, g.logo)}
                            <span className="msg-grp-name">{g.name}</span>
                            <span className="msg-grp-meta">
                              {g.awaiting > 0 && g.oldest && <span className="msg-grp-wait">{fmtAge(g.oldest)}</span>}
                              {g.unread > 0 ? <span className="msg-grp-un">{g.unread}</span> : g.threads.length > 0 && <span className="msg-grp-count">{g.threads.length}</span>}
                            </span>
                          </button>
                          <button type="button" className="msg-grp-new" title={`New chat with ${g.name}`} aria-label="Start a new chat" disabled={starting} onClick={() => startNewChat(g)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                          </button>
                        </div>
                        {!isCollapsed && g.threads.map((t) => (
                          <CrewThreadRow
                            key={t.id}
                            t={t}
                            active={t.id === activeId}
                            label={assignedByThread[t.id]?.name}
                            onSelect={() => setActiveId(t.id)}
                            onArchive={archiveThread}
                            onDelete={removeThread}
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
                      {avatar(activeThread.supplier_id || activeThread.supplier_profiles?.id, supplierName(activeThread), supplierLogo(activeThread), 'lg')}
                      <div className="msg-convo-id">
                        <div className="msg-convo-name" style={{ cursor: 'default' }}>{supplierName(activeThread)}</div>
                        <div className="msg-convo-sub">
                          <span className="msg-convo-tag">
                            {assignedByThread[activeId]?.name
                              ? `With ${assignedByThread[activeId].name}`
                              : threadLabel(activeThread)}
                          </span>
                          {(() => {
                            const board = threadBoard(activeThread);
                            if (!board) return null;
                            return (
                              <button
                                type="button"
                                className="msg-convo-board"
                                onClick={() => navigate(`/provisioning/${board.id}`)}
                                title={`Open the ${board.title} board`}
                              >
                                <span className="msg-convo-board-ico" aria-hidden>▤</span>
                                {board.title}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                      {(() => {
                        const ppl = peopleByThread[activeId] || [];
                        const CAP = 12;
                        const shown = ppl.slice(0, CAP);
                        const extra = ppl.length - shown.length;
                        const face = (p) => {
                          const nm = p.name || (p.party === 'crew' ? 'Crew' : 'Supplier');
                          const role = p.party === 'crew' ? (p.role || 'crew') : `${p.role || 'sales'} · supplier`;
                          return (
                            <button key={p.user_id} type="button" className="msg-face" style={{ backgroundImage: faceGrad(p) }} title={`${nm}${p.user_id === myUid ? ' (you)' : ''} — ${role}`} onClick={() => openCard(p)}>
                              {initials(nm)}
                              {p.party === 'crew' && p.user_id !== myUid && (
                                <span className="msg-face-x" role="button" tabIndex={0} title={`Remove ${nm}`} aria-label={`Remove ${nm}`} onClick={(e) => { e.stopPropagation(); removeCrew(p.user_id); }}>
                                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                </span>
                              )}
                            </button>
                          );
                        };
                        // Add-picker: available crew, filtered by search, grouped by department.
                        const q = addSearch.trim().toLowerCase();
                        const filtered = addableCrew.filter((c) => !q || (c.name || '').toLowerCase().includes(q));
                        const byDept = new Map();
                        for (const c of filtered) {
                          const d = c.department || 'No department';
                          if (!byDept.has(d)) byDept.set(d, []);
                          byDept.get(d).push(c);
                        }
                        const deptGroups = [...byDept.entries()];
                        return (
                          <div className="msg-people">
                            <div className="msg-facepile">
                              {shown.map(face)}
                              {extra > 0 && <button type="button" className="msg-face more" onClick={openPeople} title="Add crew to this chat" aria-label={`${extra} more — add crew`}>+{extra}</button>}
                              <button type="button" className="msg-face add" onClick={openPeople} title="Add crew to this chat" aria-label="Add crew to this chat">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                              </button>
                            </div>

                            {peopleOpen && (
                              <div className="msg-people-menu" role="menu">
                                <div className="msg-add-search">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                                  <input type="text" placeholder="Search crew…" value={addSearch} onChange={(e) => setAddSearch(e.target.value)} autoFocus />
                                </div>
                                {deptGroups.map(([dept, people]) => (
                                  <div key={dept} className="msg-add-group">
                                    <div className="msg-assign-head">{dept}</div>
                                    {people.map((c) => (
                                      <button key={c.user_id} type="button" className="msg-assign-opt" disabled={peopleBusy} onClick={() => addCrew(c.user_id)} role="menuitem">
                                        <span className="msg-face sm" style={{ backgroundImage: avatarGrad(c.user_id) }} aria-hidden>{initials(c.name)}</span>
                                        <span className="msg-people-info">
                                          <span className="msg-assign-name">{c.name}</span>
                                          <span className="msg-assign-role">{(c.tier || '').toLowerCase()}</span>
                                        </span>
                                        <span className="msg-add-plus" aria-hidden>＋</span>
                                      </button>
                                    ))}
                                  </div>
                                ))}
                                {!filtered.length && <div className="msg-assign-empty">{addableCrew.length ? 'No matches' : 'Everyone’s already in'}</div>}
                              </div>
                            )}

                            {cardPerson && (
                              <div className="msg-card" role="dialog" aria-label="Contact card">
                                <button type="button" className="msg-card-close" onClick={() => setCardPerson(null)} aria-label="Close">×</button>
                                {!cardDetail ? (
                                  <div className="msg-card-loading">Loading…</div>
                                ) : (
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
                                    <div className="msg-card-rows">
                                      {cardDetail.department && (
                                        <div className="msg-card-row"><span className="msg-card-k">Department</span><span className="msg-card-v">{cardDetail.department}</span></div>
                                      )}
                                      {cardDetail.email
                                        ? <a className="msg-card-row link" href={`mailto:${cardDetail.email}`}><span className="msg-card-k">Email</span><span className="msg-card-v">{cardDetail.email}</span></a>
                                        : null}
                                      {cardDetail.phone
                                        ? <a className="msg-card-row link" href={`tel:${cardDetail.phone}`}><span className="msg-card-k">Phone</span><span className="msg-card-v">{cardDetail.phone}</span></a>
                                        : null}
                                      {!cardDetail.email && !cardDetail.phone && !cardDetail.department && (
                                        <div className="msg-card-row"><span className="msg-card-v muted">No contact details on file</span></div>
                                      )}
                                    </div>
                                    <button type="button" className="msg-card-profile" onClick={openProfile}>View profile →</button>
                                    {cardDetail.party === 'crew' && cardPerson.user_id !== myUid && (
                                      <button type="button" className="msg-card-remove" disabled={peopleBusy} onClick={() => removeCrew(cardPerson.user_id)}>Remove from chat</button>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
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
                                <label className="msg-profile-lab">About</label>
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
                                  {d.party === 'supplier'
                                    ? <div className="msg-card-row"><span className="msg-card-k">Company</span><span className="msg-card-v">{supplierName(activeThread)}</span></div>
                                    : d.department ? <div className="msg-card-row"><span className="msg-card-k">Department</span><span className="msg-card-v">{d.department}</span></div> : null}
                                  {d.email ? <a className="msg-card-row link" href={`mailto:${d.email}`}><span className="msg-card-k">Email</span><span className="msg-card-v">{d.email}</span></a> : null}
                                  {d.phone ? <a className="msg-card-row link" href={`tel:${d.phone}`}><span className="msg-card-k">Work phone</span><span className="msg-card-v">{d.phone}</span></a> : null}
                                  {!d.email && !d.phone && <div className="msg-card-row"><span className="msg-card-v muted">No contact details yet</span></div>}
                                </div>
                                {isMe && (
                                  <button type="button" className="msg-card-profile" onClick={() => { setProfEditing(true); setProfAbout(d.about || ''); setProfPhone(d.phone || ''); }}>Edit my profile</button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {(() => {
                      const ord = threadOrder(activeThread);
                      if (ord?.approval_status !== 'pending') return null;
                      return (
                        <div className="msg-signoff">
                          <span className="msg-signoff-txt">
                            ⏱ This order is over the vessel spend limit — it needs {approverTier} sign-off before it’s placed.
                          </span>
                          {canSignOff ? (
                            <span className="msg-signoff-actions">
                              <button type="button" className="msg-signoff-decline" disabled={signBusy} onClick={() => signOffOrder(ord.id, false)}>Decline</button>
                              <button type="button" className="msg-signoff-approve" disabled={signBusy} onClick={() => signOffOrder(ord.id, true)}>{signBusy ? 'Signing…' : 'Approve & place'}</button>
                            </span>
                          ) : (
                            <span className="msg-signoff-wait">Awaiting {approverTier} sign-off</span>
                          )}
                        </div>
                      );
                    })()}

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
                                      <span className="msg-qc-price">{it.unit_price != null ? fmtMoney(Number(it.unit_price) * (Number(it.qty) || 1), it.currency || q.currency) : '—'}</span>
                                    </div>
                                  ))}
                                </div>
                                {q.total > 0 && <div className="msg-qc-total"><span>Total</span><span>{fmtMoney(q.total, q.currency)}</span></div>}
                                {m.body && <div className="msg-qc-note">{m.body}</div>}
                                {status === 'pending' && m.quote_expires_at && (
                                  quoteExpired(m)
                                    ? <div className="msg-qc-expired">⏱ Expired {fmtDmy(m.quote_expires_at)} — ask {supplierName(activeThread)} to re-quote</div>
                                    : <div className="msg-qc-valid">Valid until {fmtDmy(m.quote_expires_at)}</div>
                                )}
                                {status === 'pending' && m.sender_type === 'supplier' && !quoteExpired(m) ? (
                                  choosing === m.id ? (
                                    <div className="msg-qc-orderpick">
                                      <div className="msg-qc-orderpick-title">Add these items to…</div>
                                      <button type="button" className="msg-qc-order-opt new" disabled={quoteBusy === m.id} onClick={() => resolveQuote(m.id, true, null, null)}>
                                        <span className="msg-qc-order-main">＋ New order</span>
                                        <span className="msg-qc-order-sub">Start a fresh order for {supplierName(activeThread)}</span>
                                      </button>
                                      {addable.map((o) => (
                                        <button key={o.order_id} type="button" className="msg-qc-order-opt" disabled={quoteBusy === m.id} onClick={() => resolveQuote(m.id, true, null, o.order_id)}>
                                          <span className="msg-qc-order-main">Order #{o.short_id}{o.title ? ` · ${o.title}` : ''}</span>
                                          <span className="msg-qc-order-sub">{o.item_count} item{o.item_count === 1 ? '' : 's'} · {o.status}</span>
                                        </button>
                                      ))}
                                      <button type="button" className="msg-qc-order-cancel" disabled={quoteBusy === m.id} onClick={() => { setChoosing(null); setAddable([]); }}>Cancel</button>
                                    </div>
                                  ) : declining === m.id ? (
                                    <div className="msg-qc-decline-form">
                                      <input
                                        type="text" autoFocus className="msg-qc-reason"
                                        placeholder="Reason (optional) — e.g. too pricey, wrong item"
                                        value={declineReason}
                                        onChange={(e) => setDeclineReason(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') resolveQuote(m.id, false, declineReason); if (e.key === 'Escape') { setDeclining(null); setDeclineReason(''); } }}
                                      />
                                      <div className="msg-qc-actions">
                                        <button type="button" className="msg-qc-decline" disabled={quoteBusy === m.id} onClick={() => { setDeclining(null); setDeclineReason(''); }}>Cancel</button>
                                        <button type="button" className="msg-qc-decline-go" disabled={quoteBusy === m.id} onClick={() => resolveQuote(m.id, false, declineReason)}>{quoteBusy === m.id ? 'Declining…' : 'Send decline'}</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="msg-qc-actions">
                                      <button type="button" className="msg-qc-decline" disabled={quoteBusy === m.id} onClick={() => { setDeclining(m.id); setDeclineReason(''); }}>Decline</button>
                                      <button type="button" className="msg-qc-accept" disabled={quoteBusy === m.id} onClick={() => beginAccept(m)}>{quoteBusy === m.id ? 'Adding…' : 'Accept & add to order'}</button>
                                    </div>
                                  )
                                ) : (
                                  <>
                                    {status === 'declined' && m.quote_decline_reason && (
                                      <div className="msg-qc-reason-note">Declined: {m.quote_decline_reason}</div>
                                    )}
                                    <span className="msg-time">{fmtClock(m.created_at)}{tick}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        }
                        const src = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
                        const repliedMsg = src ? {
                          label: src.sender_type === 'vessel' ? 'You' : supplierName(activeThread),
                          snippet: src.deleted_at ? 'Message deleted' : (src.kind === 'quote' ? 'Quote' : String(src.body || '').slice(0, 90)),
                        } : null;
                        const mineMsg = m.sender_user_id ? m.sender_user_id === myUid : m.sender_type === 'vessel';
                        const senderLabel = (isGroup && !mineMsg && !r.grouped && m.kind !== 'system')
                          ? (nameForUid(m.sender_user_id) || (m.sender_type === 'vessel' ? 'Crew' : supplierName(activeThread)))
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
                      <div className="msg-quick">
                        {QUICK.map((q) => (
                          <button key={q} type="button" className="msg-qchip" onClick={() => quick(q)}>{q}</button>
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
                            <span className="msg-replybar-label">Replying to {replyTo.sender_type === 'vessel' ? 'yourself' : supplierName(activeThread)}</span>
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
                        <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={`Reply to ${supplierName(activeThread)}…  (Enter to send · Shift+Enter for a new line)`} rows={2} />
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
      </div>
    </>
  );
};

export default CrewMessages;
