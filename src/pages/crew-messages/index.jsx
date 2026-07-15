import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import {
  fetchVesselThreads, fetchThreadMessages, sendVesselMessage, markThreadReadVessel,
} from './storage';
import './crew-messages.css';

// Crew (vessel) side of supplier messaging — read + reply to your suppliers.
// Two panes: your supplier conversations on the left, the thread + composer on
// the right. Built in the Cargo editorial system (navy / terracotta / serif).

const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const supplierName = (t) => t?.supplier_profiles?.name || 'Supplier';
const supplierLogo = (t) => t?.supplier_profiles?.logo_url || null;
const threadLabel = (t) => (t?.order_id ? `Order #${shortId(t.order_id)}` : 'General');

const fmtClock = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const fmtWhen = (d) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return fmtClock(d);
  if (days === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const dayLabel = (d) => {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });
};

const CrewMessages = () => {
  const { activeTenantId } = useTenant();
  const [params, setParams] = useSearchParams();
  const threadParam = params.get('threadId');

  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
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

  // Deep link ?threadId, else open the most recent.
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
  }, [activeId]);

  // Realtime — new messages in the open thread.
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

  // Realtime — inbox changes for this vessel.
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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, activeId]);

  const totalUnread = useMemo(() => threads.reduce((s, t) => s + (t.id === activeId ? 0 : (t.vessel_unread_count || 0)), 0), [threads, activeId]);
  const awaiting = useMemo(() => threads.filter((t) => t.last_sender_type === 'supplier').length, [threads]);

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

  // Render list: date dividers + grouping (same sender ≤5 min).
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

  const avatar = (t, cls = '') => {
    const logo = supplierLogo(t);
    return (
      <span className={`cm-av${cls ? ` ${cls}` : ''}${logo ? ' has-logo' : ''}`}>
        {logo ? <img src={logo} alt="" /> : initials(supplierName(t))}
      </span>
    );
  };

  return (
    <>
      <Header />
      <div className="cm-page">
        <div className="cm-wrap">
          <div className="cm-head">
            <p className="editorial-meta" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="dot">●</span>
              {awaiting > 0 ? (
                <>
                  <span style={{ color: '#C65A1A', fontWeight: 600 }}>{awaiting} awaiting your reply</span>
                  {totalUnread > 0 && <><span className="bar" /><span className="muted">{totalUnread} unread</span></>}
                </>
              ) : (
                <>
                  <span>All caught up</span>
                  <span className="bar" /><span className="muted">{threads.length} conversation{threads.length === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting cm-title">SUPPLIER <em>messages</em></h1>
          </div>

          {error && <div className="cm-error">{error}</div>}

          {loading ? (
            <div className="cm-empty" style={{ padding: '60px 0' }}>Loading messages…</div>
          ) : threads.length === 0 ? (
            <div className="cm-blank-page">
              <div className="cm-blank-ico">💬</div>
              <div className="cm-blank-title">No supplier messages yet</div>
              <div className="cm-blank-sub">When a supplier messages your vessel, the conversation will appear here for the crew to answer.</div>
            </div>
          ) : (
            <div className="cm-shell">
              <div className="cm-list">
                {threads.map((t) => {
                  const unread = t.id === activeId ? 0 : (t.vessel_unread_count || 0);
                  return (
                    <button key={t.id} type="button" className={`cm-row${t.id === activeId ? ' on' : ''}`} onClick={() => setActiveId(t.id)}>
                      {avatar(t)}
                      <span className="cm-row-main">
                        <span className="cm-row-top">
                          {unread > 0 && <span className="cm-dot" />}
                          <span className="cm-row-name">{supplierName(t)}</span>
                          <span className="cm-row-when">{fmtWhen(t.last_message_at || t.created_at)}</span>
                        </span>
                        <span className="cm-row-label">{threadLabel(t)}</span>
                        <span className={`cm-row-prev${unread > 0 ? ' unread' : ''}`}>
                          {t.last_message_preview ? `${t.last_sender_type === 'vessel' ? 'You: ' : ''}${t.last_message_preview}` : 'No messages yet'}
                        </span>
                      </span>
                      {unread > 0 && <span className="cm-row-un">{unread}</span>}
                    </button>
                  );
                })}
              </div>

              <div className="cm-convo">
                {activeThread ? (
                  <>
                    <div className="cm-convo-head">
                      {avatar(activeThread, 'lg')}
                      <div className="cm-convo-id">
                        <div className="cm-convo-name">{supplierName(activeThread)}</div>
                        <div className="cm-convo-sub">{threadLabel(activeThread)}</div>
                      </div>
                    </div>

                    <div className="cm-stream">
                      {rendered.length === 0 ? (
                        <div className="cm-blank">
                          {avatar(activeThread, 'xl')}
                          <div className="cm-blank-title">Message {supplierName(activeThread)}</div>
                          <div className="cm-blank-sub">Ask a question, confirm an order, or reply — they’ll get it straight away.</div>
                        </div>
                      ) : rendered.map((r) => r.kind === 'divider' ? (
                        <div key={r.id} className="cm-daysep"><span>{dayLabel(r.at)}</span></div>
                      ) : (
                        <div key={r.msg.id} className={`cm-mrow ${r.msg.sender_type === 'vessel' ? 'me' : 'them'}${r.grouped ? ' grouped' : ''}`}>
                          <div className="cm-bubble">
                            {r.msg.body}
                            <span className="cm-time">
                              {fmtClock(r.msg.created_at)}
                              {r.msg.sender_type === 'vessel' && (
                                <span className={`cm-tick${activeThread?.supplier_last_read_at && new Date(activeThread.supplier_last_read_at) >= new Date(r.msg.created_at) ? ' read' : ''}`}>
                                  {activeThread?.supplier_last_read_at && new Date(activeThread.supplier_last_read_at) >= new Date(r.msg.created_at) ? '✓✓' : '✓'}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                      <div ref={endRef} />
                    </div>

                    <div className="cm-composer">
                      <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={`Reply to ${supplierName(activeThread)}…  (Enter to send · Shift+Enter for a new line)`} rows={2} />
                      <button type="button" className="cm-send" disabled={!draft.trim() || sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button>
                    </div>
                  </>
                ) : (
                  <div className="cm-empty" style={{ margin: 'auto' }}>Pick a conversation on the left.</div>
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
