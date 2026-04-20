import React, { useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

const LONG_PRESS_MS = 500;

function initials(g) {
  return `${g.first_name?.[0] ?? ''}${g.last_name?.[0] ?? ''}`.toUpperCase();
}

function stateLabel(state) {
  if (state === 'asleep') return 'Asleep';
  if (state === 'ashore') return 'Ashore';
  return 'Awake';
}

export default function GuestAvatar({ guest, onToggleState, onLongPress }) {
  const state = guest.current_state ?? 'awake';
  const longTimer = useRef(null);
  const didLongPress = useRef(false);

  const handlePointerDown = useCallback(() => {
    if (state === 'ashore') return;
    didLongPress.current = false;
    longTimer.current = setTimeout(() => {
      didLongPress.current = true;
      onLongPress?.(guest);
    }, LONG_PRESS_MS);
  }, [state, guest, onLongPress]);

  const handlePointerUp = useCallback(() => {
    clearTimeout(longTimer.current);
  }, []);

  const handleClick = useCallback(() => {
    if (state === 'ashore') return;
    if (didLongPress.current) return;
    const next = state === 'awake' ? 'asleep' : 'awake';
    onToggleState?.(guest.id, next);
  }, [state, guest.id, onToggleState]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleClick();
    if (e.key === 'F2' || (e.shiftKey && e.key === 'Enter')) onLongPress?.(guest);
  }, [handleClick, onLongPress, guest]);

  const imgSrc = guest.photo?.dataUrl ?? null;

  return (
    <div className="p-avatar-wrap">
      <motion.div
        className={`p-avatar-circle ${state}`}
        role={state !== 'ashore' ? 'button' : undefined}
        tabIndex={state !== 'ashore' ? 0 : undefined}
        aria-label={`${guest.first_name} ${guest.last_name} — ${stateLabel(state)}. ${state !== 'ashore' ? 'Press Enter to toggle, Shift+Enter for details.' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        animate={{ backgroundColor: state === 'awake' ? 'var(--ink)' : 'transparent' }}
        transition={{ duration: 0.26 }}
        style={{ touchAction: 'none' }}
      >
        {imgSrc
          ? <img src={imgSrc} alt={`${guest.first_name} ${guest.last_name}`} draggable={false} />
          : initials(guest)
        }
      </motion.div>

      <div className="p-avatar-name-row">
        {guest.current_mood_emoji && (
          <span role="img" aria-label={guest.current_mood ?? 'mood'}
            style={{ fontSize: 13 }}>
            {guest.current_mood_emoji}
          </span>
        )}
        <span>{guest.first_name}</span>
      </div>

      <div className="p-avatar-state">{stateLabel(state)}</div>
    </div>
  );
}
