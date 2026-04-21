import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { useDictate } from '../hooks/useDictate';
import { useStewNotes } from '../hooks/useStewNotes';

function fmt(secs) {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function AutoApplyCard({ action, onUndo, onDone }) {
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const intervalRef = useRef(null);

  useEffect(() => {
    const start = Date.now();
    const DURATION = 5000;
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / DURATION) * 100, 100);
      setProgress(pct);
      setCountdown(Math.max(0, Math.ceil((DURATION - elapsed) / 1000)));
      if (elapsed >= DURATION) {
        clearInterval(intervalRef.current);
        onDone(action);
      }
    }, 50);
    return () => clearInterval(intervalRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-parse-card auto">
      <div className="p-parse-icon auto" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div className="p-parse-meta auto">
          {action.intent.replace(/-/g, ' ')}
          {action.subject && (
            <> <span style={{ color: 'var(--ink-tertiary)', margin: '0 4px' }}>·</span>
              <span className="p-caps-sm">{action.subject.displayName}</span>
            </>
          )}
        </div>
        <div className="p-parse-sentence">{action.content}</div>
        <div className="p-parse-progress">
          <div className="p-parse-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="p-parse-actions">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--confirm-deep)' }}>
            Applying · {countdown}s
          </span>
          <button className="p-btn ghost" onClick={onUndo} style={{ marginLeft: 'auto' }}>
            Undo
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmCard({ action, onConfirm, onCancel, onEdit }) {
  return (
    <div className="p-parse-card confirm">
      <div className="p-parse-icon confirm" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div className="p-parse-meta confirm">
          {action.intent.replace(/-/g, ' ')}
          {action.subject && (
            <> <span style={{ color: 'var(--ink-tertiary)', margin: '0 4px' }}>·</span>
              <span className="p-caps-sm">{action.subject.displayName}</span>
            </>
          )}
        </div>
        <div className="p-parse-sentence">{action.content}</div>
        {action.context && (
          <div className="p-parse-context">{action.context}</div>
        )}
        <div className="p-parse-actions">
          <button className="p-btn primary" onClick={onConfirm}
            aria-label={`Confirm: ${action.intent.replace(/-/g, ' ')}`}>
            Confirm
          </button>
          <button className="p-btn outline" onClick={onCancel}>Cancel</button>
          <button className="p-btn ghost" onClick={onEdit} style={{ marginLeft: 'auto' }}>
            Edit →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DictateBar() {
  const { addNote } = useStewNotes();
  const isHeld = useRef(false);

  const handleApply = async (action) => {
    if (action.intent === 'stew-note' || action.intent === 'day-note') {
      await addNote(action.content, { source: 'voice' });
    }
    // Other intents: wire mutation hooks in later sprints
  };

  const {
    state, waveHeights, elapsed, transcript,
    startRecording, stopRecording,
    confirmApply, cancel, undo, autoApplyDone,
  } = useDictate({ onApply: handleApply });

  const handlePointerDown = (e) => {
    e.preventDefault();
    if (state.kind !== 'resting') return;
    isHeld.current = true;
    startRecording();
  };
  const handlePointerUp = () => {
    if (!isHeld.current) return;
    isHeld.current = false;
    if (state.kind === 'recording') stopRecording();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (e.type === 'keydown' && state.kind === 'resting' && !isHeld.current) {
        isHeld.current = true;
        startRecording();
      }
      if (e.type === 'keyup' && state.kind === 'recording') {
        isHeld.current = false;
        stopRecording();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [state.kind, startRecording, stopRecording]);

  return (
    <motion.div layout className="p-dictate" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <AnimatePresence mode="wait">
        {/* State 1 — Resting */}
        {state.kind === 'resting' && (
          <motion.div
            key="resting"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: 'flex', alignItems: 'center', gap: 14 }}
          >
            <div
              className="p-dictate-mic"
              role="button"
              tabIndex={0}
              aria-label="Hold to dictate (or hold Space)"
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              style={{ touchAction: 'none' }}
            >
              <Mic size={20} color="#fff" />
            </div>
            <div className="p-dictate-body">
              <div className="p-dictate-hint">Hold to dictate</div>
              <div className="p-dictate-prompt">Add a note, preference, or update…</div>
            </div>
            <div className="p-dictate-kbd">⌘ + space</div>
          </motion.div>
        )}

        {/* State 2 — Recording */}
        {state.kind === 'recording' && (
          <motion.div
            key="recording"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                className="p-dictate-mic recording"
                style={{ width: 44, height: 44, touchAction: 'none' }}
                role="button"
                aria-label="Release to stop recording"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
              >
                <Mic size={22} color="#fff" />
              </div>
              <div className="p-waveform" aria-hidden="true">
                {waveHeights.map((h, i) => (
                  <div key={i} className="p-waveform-bar" style={{ height: h }} />
                ))}
              </div>
              <div className="p-dictate-timer">{fmt(elapsed)}</div>
            </div>
            <div className="p-dictate-divider" />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
              <div className="p-dictate-hint" style={{ flexShrink: 0 }}>Hearing you</div>
              <div className="p-dictate-transcript" style={{ marginLeft: 8 }}>
                {transcript || <em>listening…</em>}
                <span className="p-dictate-cursor" aria-hidden="true" />
              </div>
            </div>
          </motion.div>
        )}

        {/* State 3 — Auto-apply */}
        {state.kind === 'parsed-auto' && (
          <motion.div
            key="auto"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ background: 'transparent' }}
          >
            <AutoApplyCard
              action={state.action}
              onUndo={undo}
              onDone={autoApplyDone}
            />
          </motion.div>
        )}

        {/* State 4 — Confirm required */}
        {state.kind === 'parsed-confirm' && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ConfirmCard
              action={state.action}
              onConfirm={confirmApply}
              onCancel={cancel}
              onEdit={cancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
