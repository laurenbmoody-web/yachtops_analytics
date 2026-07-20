// Cargo Accounts — compact searchable category picker (a type-ahead popover, not
// a wall of pills). Anchored under the trigger; type to filter, arrow-keys + Enter
// to pick, grouped by the tenant chart of accounts. Used by the reconcile register.
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './category-picker.css';

export default function CategoryPicker({ anchorRect, groups, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const popRef = useRef(null);

  // Flat list for filtering; keep group headings for display.
  const flat = useMemo(
    () => (groups || []).flatMap((g) => g.lines.map((l) => ({ bucket: g.bucket, ...l }))),
    [groups],
  );
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? flat.filter((o) => `${o.bucket} ${o.category} ${o.code || ''}`.toLowerCase().includes(s)) : flat;
  }, [q, flat]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 10); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', onScroll, true); };
  }, [onClose]);

  if (!anchorRect) return null;
  let left = Math.min(anchorRect.left, window.innerWidth - 300);
  let top = anchorRect.bottom + 6;
  if (top + 340 > window.innerHeight) top = Math.max(12, anchorRect.top - 346);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) onPick(items[active]); }
    else if (e.key === 'Escape') { onClose(); }
  };

  let lastBucket = null;
  return createPortal(
    <div ref={popRef} className="cp-pop" style={{ left, top }}>
      <div className="cp-head">
        <div className="cp-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search categories…" />
        </div>
      </div>
      <div className="cp-list">
        {items.length === 0 && <div className="cp-none">No match</div>}
        {items.map((o, i) => {
          const head = o.bucket !== lastBucket ? (lastBucket = o.bucket) : null;
          return (
            <React.Fragment key={o.id || `${o.bucket}:${o.category}`}>
              {head && <div className="cp-grp">{o.bucket}</div>}
              <div className={`cp-opt ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)}
                onClick={() => onPick(o)}>
                {o.code ? <span className="cp-code">{o.code}</span> : null}{o.category}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
