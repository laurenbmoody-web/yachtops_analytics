import React, { useMemo, useRef, useState } from 'react';

// Shared WhatsApp-style message bubble for both the crew and supplier inboxes.
// Renders the reply quote, the body (or a deleted placeholder), emoji reactions,
// a hover action cluster (reply · react · delete), and swipe-to-reply. Styling
// comes from each page's own scope (.cm-page / #sp-root) so the same markup
// picks up the warm or cool palette.

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅'];

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
  m, grouped, mine, time, tick, repliedMsg, myUid,
  onReply, onReact, onDelete, onJumpTo,
}) => {
  const [dx, setDx] = useState(0);
  const [picker, setPicker] = useState(false);
  const drag = useRef(null);

  const deleted = !!m.deleted_at;
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
      className={`msg-row ${mine ? 'me' : 'them'}${grouped ? ' grouped' : ''}${deleted ? ' is-deleted' : ''}`}
      onMouseLeave={() => setPicker(false)}
    >
      <span className="msg-swipe-hint" aria-hidden>↩</span>

      <div
        className="msg-bubble-wrap"
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="msg-bubble">
          {deleted ? (
            <span className="msg-deleted">🚫 This message was deleted</span>
          ) : (
            <>
              {m.reply_to_id && repliedMsg && (
                <button type="button" className="msg-reply-quote" onClick={() => onJumpTo(m.reply_to_id)}>
                  <span className="msg-reply-quote-label">{repliedMsg.label}</span>
                  <span className="msg-reply-quote-snip">{repliedMsg.snippet}</span>
                </button>
              )}
              <span className="msg-body">{m.body}</span>
              <span className="msg-time">{time}{tick}</span>
            </>
          )}
        </div>

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

      {!deleted && (
        <div className="msg-actions">
          <button type="button" className="msg-act" title="Reply" onClick={() => onReply(m)}>↩</button>
          <div className="msg-act-react">
            <button type="button" className="msg-act" title="React" onClick={() => setPicker((p) => !p)}>🙂</button>
            {picker && (
              <div className="msg-react-pop">
                {REACTION_EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" className="msg-react-opt" onClick={() => { onReact(m.id, emoji); setPicker(false); }}>{emoji}</button>
                ))}
              </div>
            )}
          </div>
          {mine && <button type="button" className="msg-act msg-act-del" title="Delete" onClick={() => onDelete(m.id)}>🗑</button>}
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
