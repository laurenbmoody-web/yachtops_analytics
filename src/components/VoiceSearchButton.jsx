// A microphone button that dictates into a search box using the browser's
// built-in Web Speech API (free, no backend). Speak "show me where the Moët
// is" and it hands back "moët" — the leading "show me where / find / locate"
// command words and trailing "is/are" are stripped so the bare thing you're
// looking for lands in the search. Renders nothing where speech isn't
// supported (e.g. Firefox), so callers can drop it in unconditionally.
import React, { useEffect, useRef, useState } from 'react';
import Icon from './AppIcon';
import './VoiceSearchButton.css';

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

// Turn a spoken phrase into a bare search term.
export const cleanVoiceQuery = (raw) => {
  let t = (raw || '').trim().replace(/[.?!,]+$/g, '');
  t = t.replace(/^(show me where(?:'s| is| are)?|where(?:'s| is| are)?|find(?: me)?|locate|search(?: for)?|look for)\s+/i, '');
  t = t.replace(/^(the|a|an|some)\s+/i, '');
  t = t.replace(/\s+(is|are|located|kept|stored)\??$/i, '');
  return t.trim();
};

export default function VoiceSearchButton({ onResult, className = '', size = 16, title = 'Search by voice' }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  useEffect(() => () => { try { recRef.current?.abort?.(); } catch { /* noop */ } }, []);

  if (!SR) return null;

  const start = () => {
    if (listening) { try { recRef.current?.stop?.(); } catch { /* noop */ } return; }
    let rec;
    try { rec = new SR(); } catch { return; }
    recRef.current = rec;
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const raw = e?.results?.[0]?.[0]?.transcript || '';
      const q = cleanVoiceQuery(raw);
      if (q) onResult?.(q);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  return (
    <button
      type="button"
      className={`voice-mic ${listening ? 'is-listening' : ''} ${className}`}
      onClick={(e) => { e.stopPropagation(); start(); }}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={title}
      aria-pressed={listening}
      title={listening ? 'Listening… tap to stop' : title}
    >
      <Icon name="Mic" size={size} />
    </button>
  );
}
