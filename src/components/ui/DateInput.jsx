import React, { useState, useEffect, useRef } from 'react';
import { isoToUK, ukToISO } from '../../utils/dateFormat';

/**
 * European date field. Displays/accepts dd/mm/yyyy regardless of browser
 * locale (native <input type="date"> can't be forced to a format), while
 * keeping the value/onChange contract in ISO (yyyy-mm-dd):
 *
 *   <DateInput value={iso} onChange={(e) => set(e.target.value)} />
 *
 * A calendar button opens the native picker (showPicker) for convenience;
 * typing dd/mm/yyyy works too.
 */
const DateInput = React.forwardRef(({
  value = '', onChange, disabled = false, className, id, placeholder = 'dd/mm/yyyy', ...props
}, ref) => {
  const [text, setText] = useState(isoToUK(value));
  const hiddenRef = useRef(null);

  useEffect(() => { setText(isoToUK(value)); }, [value]);

  const emit = (iso) => onChange?.({ target: { value: iso } });

  const handleText = (e) => {
    const t = e.target.value.replace(/[^\d/]/g, '');
    setText(t);
    if (t === '') { emit(''); return; }
    const iso = ukToISO(t);
    if (iso) emit(iso);
  };

  // Re-normalise the visible text to the canonical value on blur.
  const handleBlur = () => setText(isoToUK(value));

  const openPicker = () => {
    const el = hiddenRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: '100%', alignItems: 'center' }}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        disabled={disabled}
        id={id}
        className={className}
        style={{ width: '100%' }}
        {...props}
      />
      <input
        ref={hiddenRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={value || ''}
        onChange={(e) => emit(e.target.value)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', right: 0 }}
      />
      {!disabled && (
        <button
          type="button"
          onClick={openPicker}
          aria-label="Open calendar"
          tabIndex={-1}
          style={{ position: 'absolute', right: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: '#9098B1', lineHeight: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      )}
    </span>
  );
});

DateInput.displayName = 'DateInput';
export default DateInput;
