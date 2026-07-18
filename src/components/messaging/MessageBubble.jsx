import React, { useMemo, useRef, useState } from 'react';

// Shared WhatsApp-style message bubble for both the crew and supplier inboxes.
// Renders the reply quote, the body (or a deleted placeholder), emoji reactions,
// a hover caret menu (react · reply · copy · edit · delete), and swipe-to-reply. Styling
// comes from each page's own scope (.cm-page / #sp-root) so the same markup
// picks up the warm or cool palette.

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅'];

// Render a message body with URLs turned into links. An in-app order deep link
// (/provisioning/orders/…) renders as a friendly "Open your order →" chip.
const URL_RE = /(https?:\/\/[^\s]+)/g;
const linkifyBody = (text) => {
  const parts = String(text).split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 0) return part || null;
    const isOrder = part.includes('/provisioning/orders/');
    return (
      <a key={i} className={`msg-link${isOrder ? ' order' : ''}`} href={part} target={isOrder ? '_self' : '_blank'} rel="noopener noreferrer">
        {isOrder ? 'Open your order →' : part}
      </a>
    );
  });
};

// Fold a message's reaction array into { emoji: { count, mine } }.
const aggregate = (reactions, myUid) => {
  const out = {};
  for (const r of reactions || []) {
    if (!out[r.emoji]) out[r.emoji] = { count: 0, mine: false };
    out[r.emoji].count += 1;
    if (r.uid && r.uid === myUid) out[r.emoji].mine = true;
  }
  return out;
};

const MessageBubble = ({
  m, grouped, mine, time, tick, repliedMsg, myUid, senderLabel,
  onReply, onReact, onDelete, onEdit, onJumpTo,
}) => {
  const [dx, setDx] = useState(0);
  const [menu, setMenu] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const drag = useRef(null);

  const deleted = !!m.deleted_at;
  const attachments = Array.isArray(m.attachments) ? m.attachments : [];
  const isImage = (a) => (a?.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a?.url || '');
  const reactions = useMemo(() => aggregate(m.reactions, myUid), [m.reactions, myUid]);
  const reactionList = Object.entries(reactions);

  // Swipe-to-reply: drag the bubble toward the centre; release past the
  // threshold to open a reply. Them-messages swipe right, mine swipe left.
  const dir = mine ? -1 : 1;
  const onPointerDown = (e) => {
    if (deleted || e.button === 1 || e.button === 2) return;
    drag.current = { x0: e.clientX, y0: e.clientY, active: false, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const raw = e.clientX - drag.current.x0;
    const dy = e.clientY - drag.current.y0;
    const along = raw * dir;
    if (!drag.current.active) {
      // Only start a swipe on clearly-horizontal, inward movement — leaves
      // vertical scroll and text selection untouched.
      if (along > 8 && Math.abs(raw) > Math.abs(dy) * 1.4) {
        drag.current.active = true;
        try { e.currentTarget.setPointerCapture(drag.current.id); } catch { /* noop */ }
      } else if (Math.abs(dy) > 10) {
        drag.current = null; return;
      } else return;
    }
    setDx(dir * Math.max(0, Math.min(72, along)));
  };
  const endDrag = () => {
    if (drag.current?.active && Math.abs(dx) >= 44) onReply(m);
    drag.current = null;
    setDx(0);
  };

  return (
    <div
      id={`msg-${m.id}`}
      className={`msg-row ${mine ? 'me' : 'them'}${grouped ? ' grouped' : ''}${deleted ? ' is-deleted' : ''}${menu ? ' menu-open' : ''}`}
      onMouseLeave={() => setMenu(false)}
    >
      <div
        className="msg-bubble-wrap"
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="msg-bubble">
          {senderLabel && !deleted && <span className="msg-sender">{senderLabel}</span>}
          {deleted ? (
            <span className="msg-deleted">🚫 This message was deleted</span>
          ) : (
            <>
              <button type="button" className="msg-caret" title="Message options" onClick={() => setMenu((o) => !o)} aria-label="Message options">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {m.reply_to_id && repliedMsg && (
                <button type="button" className="msg-reply-quote" onClick={() => onJumpTo(m.reply_to_id)}>
                  <span className="msg-reply-quote-label">{repliedMsg.label}</span>
                  <span className="msg-reply-quote-snip">{repliedMsg.snippet}</span>
                </button>
              )}
              {attachments.length > 0 && (
                <div className={`msg-attach${attachments.length > 1 ? ' multi' : ''}`}>
                  {attachments.map((a, i) => (
                    isImage(a) ? (
                      <button key={i} type="button" className="msg-attach-img" onClick={() => setLightbox(a.url)} title={a.name || 'Photo'}>
                        <img src={a.url} alt={a.name || 'Photo'} loading="lazy" />
                      </button>
                    ) : (
                      <a key={i} className="msg-attach-file" href={a.url} target="_blank" rel="noopener noreferrer" title={a.name || 'File'}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                        <span className="msg-attach-name">{a.name || 'Attachment'}</span>
                      </a>
                    )
                  ))}
                </div>
              )}
              {m.body && <span className="msg-body">{linkifyBody(m.body)}</span>}
              <span className="msg-time">{m.edited_at && <span className="msg-edited">edited</span>}{time}{tick}</span>
            </>
          )}
        </div>

        {!deleted && menu && (
          <div className="msg-menu-pop" onPointerDown={(e) => e.stopPropagation()}>
            <div className="msg-menu-emojis">
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" className="msg-menu-emoji" onClick={() => { onReact(m.id, emoji); setMenu(false); }}>{emoji}</button>
              ))}
            </div>
            <button type="button" className="msg-menu-item" onClick={() => { onReply(m); setMenu(false); }}>Reply</button>
            {m.body && (
              <button type="button" className="msg-menu-item" onClick={() => { try { navigator.clipboard?.writeText(m.body); } catch { /* noop */ } setMenu(false); }}>Copy</button>
            )}
            {mine && m.kind !== 'quote' && <button type="button" className="msg-menu-item" onClick={() => { onEdit(m); setMenu(false); }}>Edit</button>}
            {mine && <button type="button" className="msg-menu-item del" onClick={() => { onDelete(m.id); setMenu(false); }}>Delete</button>}
          </div>
        )}

        {reactionList.length > 0 && (
          <div className="msg-reactions">
            {reactionList.map(([emoji, { count, mine: didI }]) => (
              <button
                key={emoji}
                type="button"
                className={`msg-reaction${didI ? ' mine' : ''}`}
                onClick={() => onReact(m.id, emoji)}
              >
                <span className="msg-reaction-emoji">{emoji}</span>
                {count > 1 && <span className="msg-reaction-n">{count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="msg-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button type="button" className="msg-lightbox-x" aria-label="Close" onClick={() => setLightbox(null)}>✕</button>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
