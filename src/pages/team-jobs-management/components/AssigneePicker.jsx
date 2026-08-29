import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';

/**
 * Editorial searchable multi-select for crew assignees.
 *
 * Replaces the generic <Select multiple searchable> in the Jobs modals so
 * every control in a panel reads as one system. Selected people show as
 * removable chips; the menu filters as you type.
 *
 * Props:
 *   options   - [{ value, label, description? }]
 *   value     - array of selected `value`s (or a single value / null)
 *   onChange  - fn(nextValueArray) — always called with an array
 *   multiple  - allow more than one selection (default true)
 *   placeholder, disabled, emptyLabel
 */
const AssigneePicker = ({
  options = [],
  value,
  onChange,
  multiple = true,
  placeholder = 'Select crew…',
  disabled = false,
  emptyLabel = 'No crew match that search',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(() => {
    if (Array.isArray(value)) return value;
    return value === null || value === undefined || value === '' ? [] : [value];
  }, [value]);

  const selectedOptions = selected
    ?.map(v => options?.find(o => o?.value === v) || { value: v, label: String(v) })
    ?.filter(Boolean);

  const filtered = useMemo(() => {
    const q = query?.trim()?.toLowerCase();
    if (!q) return options;
    return options?.filter(o =>
      `${o?.label || ''} ${o?.description || ''}`?.toLowerCase()?.includes(q)
    );
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef?.current && !wrapRef?.current?.contains(e?.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document?.addEventListener('mousedown', onDown);
    return () => document?.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open && inputRef?.current) inputRef?.current?.focus();
  }, [open]);

  const toggle = (optValue) => {
    if (!multiple) {
      onChange?.([optValue]);
      setOpen(false);
      setQuery('');
      return;
    }
    const next = selected?.includes(optValue)
      ? selected?.filter(v => v !== optValue)
      : [...selected, optValue];
    onChange?.(next);
  };

  const remove = (optValue) => onChange?.(selected?.filter(v => v !== optValue));

  return (
    <div className="jm-combo" ref={wrapRef}>
      <button
        type="button"
        className={`jm-combo-control${open ? ' open' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
      >
        {selectedOptions?.length === 0 ? (
          <span className="ph">{placeholder}</span>
        ) : (
          <span className="jm-combo-chips">
            {selectedOptions?.map(o => (
              <span key={o?.value} className="jm-tag accent">
                {o?.label}
                <span
                  role="button"
                  tabIndex={-1}
                  title="Remove"
                  onClick={(e) => { e?.stopPropagation(); remove(o?.value); }}
                  style={{ display: 'flex', cursor: 'pointer' }}
                >
                  <Icon name="X" size={10} />
                </span>
              </span>
            ))}
          </span>
        )}
        <Icon name="ChevronDown" size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div className="jm-combo-menu">
          <div className="jm-combo-search">
            <Icon name="Search" size={13} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search crew…"
              onChange={(e) => setQuery(e?.target?.value)}
            />
          </div>
          {filtered?.length === 0 ? (
            <p className="jm-combo-empty">{emptyLabel}</p>
          ) : (
            filtered?.map(o => {
              const on = selected?.includes(o?.value);
              return (
                <button
                  type="button"
                  key={o?.value}
                  className={`jm-option${on ? ' on' : ''}`}
                  onClick={() => toggle(o?.value)}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {o?.label}
                    {o?.description && <span className="jm-combo-desc">{o?.description}</span>}
                  </span>
                  {on && <Icon name="Check" size={14} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default AssigneePicker;
