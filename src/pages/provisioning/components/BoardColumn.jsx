import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import StatusBadge from './StatusBadge';
import ItemCard from './ItemCard';

// ── Order-by date badge ──────────────────────────────────────────────────────

const OrderByBadge = ({ date }) => {
  if (!date) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  let cls, label;
  if (diff < 0) {
    cls = 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 border border-red-200 dark:border-red-500/30';
    label = `Overdue ${Math.abs(diff)}d`;
  } else if (diff === 0) {
    cls = 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 border border-red-200 dark:border-red-500/30';
    label = 'Due today';
  } else if (diff <= 3) {
    cls = 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30';
    label = `Due in ${diff}d`;
  } else {
    cls = 'bg-muted text-muted-foreground border border-border';
    label = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      <Icon name="Calendar" className="w-3 h-3 mr-1" />
      {label}
    </span>
  );
};

// ── Three-dot menu ───────────────────────────────────────────────────────────

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
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Icon name="MoreVertical" className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 w-48 bg-card border border-border rounded-lg shadow-xl z-30 py-1">
          {canEdit && (
            <button onClick={() => { setOpen(false); onEdit(); }} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
              <Icon name="Pencil" className="w-3.5 h-3.5" /> Edit board details
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setOpen(false); onSuggestions(); }} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
              <Icon name="Lightbulb" className="w-3.5 h-3.5" /> Get suggestions
            </button>
          )}
          {canEdit && (
            <button onClick={() => { setOpen(false); onTemplates(); }} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
              <Icon name="FileText" className="w-3.5 h-3.5" /> Templates & history
            </button>
          )}
          <button onClick={() => { setOpen(false); onDuplicate(); }} className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
            <Icon name="Copy" className="w-3.5 h-3.5" /> Duplicate
          </button>
          {canDelete && (
            <>
              <div className="border-t border-border my-1" />
              <button onClick={() => { setOpen(false); onDelete(); }} className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2">
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
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed });
    setName('');
    if (inputRef.current) inputRef.current.focus();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2 border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 rounded-lg transition-colors"
      >
        + Add item
      </button>
    );
  }

  return (
    <div className="px-1 pb-1">
      <div className="bg-muted border border-border rounded-lg px-3 py-2 flex items-center gap-2">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') { setOpen(false); setName(''); }
          }}
          placeholder="Item name..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        <button onClick={() => { setOpen(false); setName(''); }} className="text-muted-foreground hover:text-foreground flex-shrink-0">
          <Icon name="X" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

// ── Board Column ─────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

const BoardColumn = ({
  list,
  items,
  filteredItems,
  hiddenCount,
  canEdit,
  canDelete,
  onItemClick,
  onItemStatusChange,
  onItemQuantityChange,
  onQuickAdd,
  onEditBoard,
  onSuggestions,
  onTemplates,
  onDuplicate,
  onDelete,
  onNavigate,
}) => {
  const currencySymbol = CURRENCY_SYMBOLS[list.currency] || '$';

  return (
    <div
      className="flex flex-col w-[340px] min-w-[340px] flex-shrink-0 bg-card border border-border rounded-xl shadow-sm"
      style={{ height: 'calc(100vh - 160px)' }}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0 border-b border-border">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3
                className="text-sm font-bold text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                style={{ transition: 'color 0.15s' }}
                onClick={() => onNavigate(list.id)}
                title={list.title}
              >
                {list.title}
              </h3>
              {list.is_private && <Icon name="Lock" className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={list.status} size="sm" />
              {list.order_by_date && <OrderByBadge date={list.order_by_date} />}
            </div>
          </div>

          {/* Right side: count, expand, menu */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] font-medium bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {filteredItems.length}
            </span>
            <button
              onClick={() => onNavigate(list.id)}
              title="Open full detail"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="ExternalLink" className="w-3.5 h-3.5" />
            </button>
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

        {list.estimated_cost > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {currencySymbol}{Math.round(list.estimated_cost).toLocaleString()} est.
          </p>
        )}
      </div>

      {/* Items — scrollable */}
      <div className="flex-1 overflow-y-auto px-2 pt-2 min-h-0">
        {filteredItems.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            onClick={onItemClick}
            onStatusChange={onItemStatusChange}
            onQuantityChange={onItemQuantityChange}
          />
        ))}
        {filteredItems.length === 0 && hiddenCount === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-muted-foreground">No items yet</p>
          </div>
        )}
        {hiddenCount > 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            {hiddenCount} item{hiddenCount !== 1 ? 's' : ''} hidden by filter
          </p>
        )}
      </div>

      {/* Quick-add — always visible */}
      <div className="px-2 pb-2 pt-1 flex-shrink-0">
        <QuickAddItem onAdd={onQuickAdd} />
      </div>
    </div>
  );
};

export default BoardColumn;
