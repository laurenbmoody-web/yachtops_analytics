import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import StatusBadge from './StatusBadge';
import ItemCard from './ItemCard';
import { PROVISION_DEPARTMENTS } from '../utils/provisioningStorage';

// ── Order-by date badge ──────────────────────────────────────────────────────

const OrderByBadge = ({ date }) => {
  if (!date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  let cls, label;
  if (diff < 0) {
    cls = 'bg-red-500/20 text-red-400 border border-red-500/30';
    label = `Overdue ${Math.abs(diff)}d`;
  } else if (diff === 0) {
    cls = 'bg-red-500/20 text-red-400 border border-red-500/30';
    label = 'Due today';
  } else if (diff <= 3) {
    cls = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    label = `Due in ${diff}d`;
  } else {
    cls = 'bg-white/10 text-slate-400 border border-white/10';
    label = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      <Icon name="Calendar" className="w-3 h-3 mr-1" />
      {label}
    </span>
  );
};

// ── Three-dot menu ──────────────────────────────────────────────────────────

const BoardMenu = ({ canEdit, canDelete, onEdit, onSuggestions, onTemplates, onDuplicate, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Icon name="MoreVertical" className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 w-48 bg-[#162236] border border-[rgba(255,255,255,0.1)] rounded-lg shadow-xl z-30 py-1">
          {canEdit && (
            <button onClick={() => { setOpen(false); onEdit(); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2">
              <Icon name="Pencil" className="w-3.5 h-3.5" /> Edit board details
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setOpen(false); onSuggestions(); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2">
              <Icon name="Lightbulb" className="w-3.5 h-3.5" /> Get suggestions
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setOpen(false); onTemplates(); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2">
              <Icon name="FileText" className="w-3.5 h-3.5" /> Templates & history
            </button>
          )}
          <button onClick={() => { setOpen(false); onDuplicate(); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2">
            <Icon name="Copy" className="w-3.5 h-3.5" /> Duplicate
          </button>
          {canDelete && (
            <>
              <div className="border-t border-white/5 my-1" />
              <button onClick={() => { setOpen(false); onDelete(); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2">
                <Icon name="Trash2" className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Quick-add item form ──────────────────────────────────────────────────────

const QuickAddItem = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [dept, setDept] = useState('Galley');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed, department: dept });
    setName('');
    if (inputRef.current) inputRef.current.focus();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2 text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5"
      >
        <Icon name="Plus" className="w-3.5 h-3.5" />
        Add item
      </button>
    );
  }

  return (
    <div className="px-2 pb-2">
      <div className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg p-2 space-y-2">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setOpen(false); }}
          placeholder="Item name..."
          className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={dept}
            onChange={e => setDept(e.target.value)}
            className="flex-1 bg-[#0d1a2e] border border-[rgba(255,255,255,0.1)] rounded text-xs text-slate-300 px-2 py-1 outline-none"
          >
            {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-2.5 py-1 bg-[#4A90E2] text-white text-xs font-medium rounded hover:bg-[#4A90E2]/80 disabled:opacity-40 transition-colors"
          >
            Add
          </button>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300">
            <Icon name="X" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Board Column ─────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

// department can be text[] from DB (array) or legacy comma-string — normalise to array
const parseDept = (dept) => {
  if (!dept) return [];
  if (Array.isArray(dept)) return dept.filter(Boolean);
  return dept.split(',').map(d => d.trim()).filter(Boolean);
};

const BoardColumn = ({
  list,
  items,
  filteredItems,
  hiddenCount,
  canEdit,
  canDelete,
  onItemClick,
  onQuickAdd,
  onEditBoard,
  onSuggestions,
  onTemplates,
  onDuplicate,
  onDelete,
}) => {
  const currencySymbol = CURRENCY_SYMBOLS[list.currency] || '$';

  return (
    <div className="flex flex-col w-[280px] min-w-[280px] flex-shrink-0 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-xl">
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3
                className="text-sm font-bold text-white truncate cursor-pointer hover:text-[#4A90E2] transition-colors"
                onClick={() => canEdit && onEditBoard()}
                title={list.title}
              >
                {list.title}
              </h3>
              {list.is_private && <Icon name="Lock" className="w-3 h-3 text-amber-400 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={list.status} size="sm" />
              {list.order_by_date && <OrderByBadge date={list.order_by_date} />}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] font-medium bg-white/10 text-slate-400 rounded-full px-1.5 py-0.5">
              {filteredItems.length}
            </span>
            <BoardMenu
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={onEditBoard}
              onSuggestions={onSuggestions}
              onTemplates={onTemplates}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </div>
        </div>

        {/* Cost row */}
        {list.estimated_cost > 0 && (
          <p className="text-xs text-slate-400 mt-1">
            {currencySymbol}{Math.round(list.estimated_cost).toLocaleString()} est.
          </p>
        )}
      </div>

      {/* Items */}
      <div
        className="flex-1 overflow-y-auto px-2 space-y-2 pb-1"
        style={{ maxHeight: 'calc(100vh - 260px)' }}
      >
        {filteredItems.map(item => (
          <ItemCard key={item.id} item={item} onClick={onItemClick} />
        ))}
        {filteredItems.length === 0 && hiddenCount === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-slate-600">No items yet</p>
          </div>
        )}
      </div>

      {/* Hidden count */}
      {hiddenCount > 0 && (
        <p className="text-[10px] text-slate-500 text-center py-1">
          {hiddenCount} item{hiddenCount !== 1 ? 's' : ''} hidden by filter
        </p>
      )}

      {/* Quick-add */}
      {canEdit && <QuickAddItem onAdd={onQuickAdd} />}
    </div>
  );
};

export default BoardColumn;
