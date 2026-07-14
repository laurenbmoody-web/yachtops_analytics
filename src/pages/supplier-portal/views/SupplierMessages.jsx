import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchMessageThreads, getOrCreateThread, fetchMessages, sendSupplierMessage, fetchClients } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

// Supplier ↔ yacht messaging. Threads down the left, the conversation +
// composer on the right. Opens/creates a thread from ?yachtId (with an
// optional ?draft prefill) so Radar nudges, the client profile and every
// "Message yacht" button land straight in a ready-to-send composer.

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const fmtClock = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

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
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

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

  // Deep-link: open/create the thread for ?yachtId and prefill ?draft.
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

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    fetchMessages(activeId).then(setMessages).catch((e) => setError(e.message));
  }, [activeId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const activeThread = useMemo(() => threads.find((t) => t.id === activeId), [threads, activeId]);
  const nameFor = (t) => (t ? (names[t.tenant_id] || t.tenants?.name || 'Yacht client') : '');

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
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`msg-thread${t.id === activeId ? ' on' : ''}`}
                onClick={() => setActiveId(t.id)}
              >
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
          </div>

          {/* Conversation */}
          <div className="msg-convo">
            {activeThread ? (
              <>
                <div className="msg-convo-head">
                  <span className="msg-convo-av">{initials(nameFor(activeThread))}</span>
                  <button type="button" className="msg-convo-name" onClick={() => navigate(`/supplier/clients/${activeThread.tenant_id}`)}>
                    {nameFor(activeThread)}
                  </button>
                </div>

                <div className="msg-stream">
                  {messages.length === 0 ? (
                    <div className="msg-empty">Start the conversation — say hello or send your check-in.</div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className={`msg-row ${msg.sender_type === 'supplier' ? 'me' : 'them'}`}>
                        <div className="msg-bubble">
                          {msg.body}
                          <span className="msg-time">{fmtClock(msg.created_at)}</span>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={endRef} />
                </div>

                <div className="msg-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    placeholder="Write a message…  (⌘↵ to send)"
                    rows={2}
                  />
                  <button type="button" className="msg-send" disabled={!draft.trim() || sending} onClick={send}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
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
