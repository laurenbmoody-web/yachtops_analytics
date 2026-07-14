import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchMessageThreads, getOrCreateThread, fetchMessages, sendSupplierMessage, fetchClients, fetchClientOrders } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

// Supplier ↔ yacht messaging. Threads on the left, the conversation + composer
// on the right. Opens/creates a thread from ?yachtId (with optional ?draft) so
// Radar nudges, the client profile and every "Message yacht" button land in a
// ready-to-send composer. Precision detail: search, date dividers, grouped
// bubbles, an order-context chip, and domain quick-replies.

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
const dayLabel = (d) => {
  const dt = new Date(d);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(dt).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });
};

// Domain quick-replies — prefill the composer with a useful opener.
const QUICK = [
  { label: 'Confirm delivery', text: (o) => `Confirming your delivery${o?.delivery_date ? ` for ${new Date(o.delivery_date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : ''}${o?.delivery_time ? ` at ${String(o.delivery_time).slice(0, 5)}` : ''} — does that still work for you?` },
  { label: 'On our way 🚚', text: () => `We're on our way with your delivery 🚚 — I'll message when we're close.` },
  { label: 'Substitution', text: () => `Quick one — an item's short today and I can swap in a close match. Want me to sort that for you?` },
];

const SupplierMessages = () => {
  const { supplier } = useSupplier();
  const supplierId = supplier?.id;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const yachtParam = params.get('yachtId');
  const draftParam = params.get('draft');

  const [threads, setThreads] = useState([]);
  const [names, setNames] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
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

  useEffect(() => {
    if (!supplierId || !yachtParam) return;
    let cancelled = false;
    getOrCreateThread(supplierId, yachtParam)
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
  }, [supplierId, yachtParam]);

  useEffect(() => {
    if (!activeId && threads.length && !yachtParam) setActiveId(threads[0].id);
  }, [threads, activeId, yachtParam]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId), [threads, activeId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    fetchMessages(activeId).then(setMessages).catch((e) => setError(e.message));
  }, [activeId]);

  // Order-context: the yacht's most recent order with this supplier.
  useEffect(() => {
    setActiveOrder(null);
    if (!supplierId || !activeThread?.tenant_id) return;
    let cancelled = false;
    fetchClientOrders(supplierId, activeThread.tenant_id)
      .then((os) => { if (!cancelled) setActiveOrder(os?.[0] || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [supplierId, activeThread?.tenant_id]);

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
  const onKey = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } };
  const quick = (fn) => { setDraft((d) => (d.trim() ? `${d.trim()} ${fn(activeOrder)}` : fn(activeOrder))); taRef.current?.focus(); };

  // Build a render list: date dividers + grouping flags (same sender ≤5 min).
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

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => nameFor(t).toLowerCase().includes(q) || (t.last_message_preview || '').toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, search, names]);

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Inbox</div>
          <h1 className="sp-page-title">Yacht <em>messages</em></h1>
          <p className="sp-page-sub">Direct conversations with your yacht clients.</p>
        </div>
      </div>

      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px 0', color: 'var(--muted)', fontSize: 13 }}>Loading messages…</div>
      ) : threads.length === 0 && !activeThread ? (
        <EmptyState icon="💬" title="No conversations yet" body="Message a yacht from Radar, a client profile, or an order and the thread will appear here." />
      ) : (
        <div className="msg-shell">
          {/* Thread list */}
          <div className="msg-threads">
            <div className="msg-search">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" />
            </div>
            <div className="msg-tlist">
              {visibleThreads.map((t) => (
                <button key={t.id} type="button" className={`msg-thread${t.id === activeId ? ' on' : ''}`} onClick={() => setActiveId(t.id)}>
                  <span className="msg-thread-av">{initials(nameFor(t))}</span>
                  <span className="msg-thread-main">
                    <span className="msg-thread-top">
                      <span className="msg-thread-name">{nameFor(t)}</span>
                      <span className="msg-thread-when">{fmtWhen(t.last_message_at || t.created_at)}</span>
                    </span>
                    <span className="msg-thread-prev">{t.last_message_preview || 'No messages yet'}</span>
                  </span>
                </button>
              ))}
              {visibleThreads.length === 0 && <div className="msg-empty" style={{ padding: '24px 12px' }}>No matches.</div>}
            </div>
          </div>

          {/* Conversation */}
          <div className="msg-convo">
            {activeThread ? (
              <>
                <div className="msg-convo-head">
                  <span className="msg-convo-av">{initials(nameFor(activeThread))}</span>
                  <div className="msg-convo-id">
                    <button type="button" className="msg-convo-name" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}>{nameFor(activeThread)}</button>
                    {contact && <div className="msg-convo-sub">{contact}</div>}
                  </div>
                  <div className="msg-convo-actions">
                    {phone && <a className="msg-ic" href={`tel:${phone}`} title={`Call ${contact || 'yacht'}`} aria-label="Call"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.86.68 2.75a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.33-1.33a2 2 0 0 1 2.11-.45c.89.32 1.81.55 2.75.68A2 2 0 0 1 22 16.92z" /></svg></a>}
                    <button type="button" className="msg-ic" title="View client profile" aria-label="View profile" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></button>
                  </div>
                </div>

                {activeOrder && (
                  <div className="msg-ctx">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                    <span>Latest order <b>#{shortId(activeOrder.id)}</b> · <span style={{ textTransform: 'capitalize' }}>{activeOrder.status}</span> · {fmtMoney0(orderTotal(activeOrder), activeOrder.currency || 'EUR')}</span>
                    <button type="button" className="msg-ctx-go" onClick={() => navigate(`/supplier/orders/${activeOrder.id}`)}>View order →</button>
                  </div>
                )}

                <div className="msg-stream">
                  {rendered.length === 0 ? (
                    <div className="msg-empty">Start the conversation — say hello or send your check-in.</div>
                  ) : rendered.map((r) => r.kind === 'divider' ? (
                    <div key={r.id} className="msg-daysep">{dayLabel(r.at)}</div>
                  ) : (
                    <div key={r.msg.id} className={`msg-row ${r.msg.sender_type === 'supplier' ? 'me' : 'them'}${r.grouped ? ' grouped' : ''}`}>
                      <div className="msg-bubble">
                        {r.msg.body}
                        <span className="msg-time">{fmtClock(r.msg.created_at)}</span>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                <div className="msg-quick">
                  {QUICK.map((q) => (
                    <button key={q.label} type="button" className="msg-qchip" onClick={() => quick(q.text)}>{q.label}</button>
                  ))}
                </div>
                <div className="msg-composer">
                  <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Write a message…  (⌘↵ to send)" rows={2} />
                  <button type="button" className="msg-send" disabled={!draft.trim() || sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button>
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
