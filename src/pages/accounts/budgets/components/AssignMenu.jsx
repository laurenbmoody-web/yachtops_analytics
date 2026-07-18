// Searchable, grouped "Assign to…" menu for the Needs-a-category review list.
// Replaces the long flat native <select>: a search box filters, options are grouped
// under their bucket header, and a "＋ New line…" action sits at the foot. Portaled
// + fixed-positioned so it escapes any table/overflow and never clips.
import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

export default function AssignMenu({ options = [], onSelect, onNew, label = 'Assign to…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = options.filter((o) => !q || `${o.bucket} ${o.value} ${o.code || ''}`.toLowerCase().includes(q));
    const order = [];
    const map = new Map();
    filtered.forEach((o) => {
      if (!map.has(o.bucket)) { map.set(o.bucket, []); order.push(o.bucket); }
      map.get(o.bucket).push(o);
    });
    return order.map((b) => ({ bucket: b, items: map.get(b) }));
  }, [options, query]);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 320; const margin = 8;
    const maxH = 360;
    let left = r.right - w;               // right-align to the trigger
    if (left < margin) left = margin;
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
    let top = r.bottom + 6;
    if (top + maxH > window.innerHeight - margin) top = Math.max(margin, r.top - maxH - 6); // flip up
    setCoords({ top, left, width: w, maxH });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return undefined; }
    place();
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e) => { if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return; setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = (value) => { setOpen(false); setQuery(''); onSelect?.(value); };

  return (
    <div className="bg-am" ref={wrapRef}>
      <button type="button" className={`bg-am-trigger${open ? ' is-open' : ''}`} onClick={() => setOpen((v) => !v)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5L6 7.5l3-3" /></svg>
      </button>
      {open && createPortal(
        <div className="bg-am-panel" ref={panelRef}
          style={coords ? { top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxH } : { visibility: 'hidden' }}>
          <div className="bg-am-search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#8B8478" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M11 11l3 3" strokeLinecap="round" /></svg>
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search categories…" />
          </div>
          <div className="bg-am-list">
            {groups.length === 0 && <div className="bg-am-empty">No matching lines</div>}
            {groups.map((g) => (
              <div key={g.bucket} className="bg-am-group">
                <div className="bg-am-ghead">{g.bucket}</div>
                {g.items.map((o) => (
                  <button key={o.value} type="button" className="bg-am-opt" onClick={() => choose(o.value)}>
                    {o.code && <span className="bg-am-code">{o.code}</span>}
                    <span className="bg-am-optname">{o.value}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <button type="button" className="bg-am-new" onClick={() => { setOpen(false); setQuery(''); onNew?.(); }}>＋ New line…</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
