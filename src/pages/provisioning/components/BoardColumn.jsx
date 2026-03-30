import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import StatusBadge from './StatusBadge';
import ItemCard from './ItemCard';
import { updateProvisioningList } from '../utils/provisioningStorage';

// ── Drag handle (six-dot grip) ───────────────────────────────────────────────

const DragHandle = ({ dragHandleProps }) => (
  <div
    {...dragHandleProps}
    title="Drag to reorder"
    className="flex-shrink-0 flex items-center justify-center w-5 h-full cursor-grab active:cursor-grabbing group/drag"
    style={{ touchAction: 'none' }}
  >
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"
      className="text-muted-foreground group-hover/drag:text-foreground transition-colors">
      <circle cx="2.5" cy="2.5" r="1.5" />
      <circle cx="7.5" cy="2.5" r="1.5" />
      <circle cx="2.5" cy="7.5" r="1.5" />
      <circle cx="7.5" cy="7.5" r="1.5" />
      <circle cx="2.5" cy="12.5" r="1.5" />
      <circle cx="7.5" cy="12.5" r="1.5" />
    </svg>
  </div>
);

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
      <Icon name="Calendar" className="w-3 h-3 mr-1" />{label}
    </span>
  );
};

// ── Colour picker ────────────────────────────────────────────────────────────

const SWATCHES = [
  { label: 'Navy',   value: '#1E3A5F' },
  { label: 'Blue',   value: '#4A90E2' },
  { label: 'Teal',   value: '#0D9488' },
  { label: 'Green',  value: '#16A34A' },
  { label: 'Lime',   value: '#65A30D' },
  { label: 'Amber',  value: '#D97706' },
  { label: 'Orange', value: '#EA580C' },
  { label: 'Red',    value: '#DC2626' },
  { label: 'Pink',   value: '#DB2777' },
  { label: 'Purple', value: '#9333EA' },
  { label: 'Slate',  value: '#475569' },
  { label: 'Default', value: null },
];

const ColourPicker = ({ current, onSelect, onClose }) => {
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50"
      style={{
        background: '#1a2540',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: 10,
        width: 132,
      }}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {SWATCHES.map((s) => {
          const isSelected = s.value === current || (!s.value && !current);
          return (
            <button
              key={s.label}
              title={s.label}
              onClick={() => { onSelect(s.value); onClose(); }}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                background: s.value || 'white',
                border: isSelected ? '2px solid white' : '2px solid transparent',
                cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0,
                outline: 'none',
              }}
            >
              {/* Default swatch — diagonal line */}
              {!s.value && (
                <svg viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <line x1="4" y1="4" x2="20" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Three-dot menu ───────────────────────────────────────────────────────────

const BoardMenu = ({ canEdit, canCommandDelete, onEdit, onDuplicate, onDeleteClick, onShare }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
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
        <div className="absolute right-0 top-7 w-48 bg-card border border-border rounded-lg shadow-xl z-30 py-1 overflow-hidden">
          {canEdit && (
            <button onClick={() => { setOpen(false); onEdit(); }} className="w-full text-left mx-1 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md flex items-center gap-2">
              <Icon name="Pencil" className="w-3.5 h-3.5" /> Edit board details
            </button>
          )}
          <button onClick={() => { setOpen(false); onDuplicate(); }} className="w-full text-left mx-1 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md flex items-center gap-2">
            <Icon name="Copy" className="w-3.5 h-3.5" /> Duplicate
          </button>
          {onShare && (
            <button onClick={() => { setOpen(false); onShare(); }} className="w-full text-left mx-1 px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md flex items-center gap-2">
              <Icon name="Share2" className="w-3.5 h-3.5" /> Share board
            </button>
          )}
          <div className="border-t border-border my-1" />
          <button
            onClick={() => { setOpen(false); onDeleteClick(); }}
            className="w-full text-left mx-1 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md flex items-center gap-2"
          >
            <Icon name="Trash2" className="w-3.5 h-3.5" /> Delete board
          </button>
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
  canCommandDelete,
  dragHandleProps,
  isDragging,
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
  onTitleSave,
  onColourChange,
  onShare,
  collaborators,
}) => {
  const currencySymbol = CURRENCY_SYMBOLS[list.currency] || '$';

  // ── Inline title edit ───────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(list.title);
  const [savedFlash, setSavedFlash] = useState(false);
  const titleInputRef = useRef(null);

  useEffect(() => { setTitleValue(list.title); }, [list.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleCommit = async () => {
    const trimmed = titleValue.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === list.title) {
      setTitleValue(list.title);
      return;
    }
    try {
      await onTitleSave(list.id, trimmed);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch {
      setTitleValue(list.title);
    }
  };

  // ── Colour picker ───────────────────────────────────────────────────────
  const [colourOpen, setColourOpen] = useState(false);
  const colourBtnRef = useRef(null);

  const handleColourSelect = (colour) => {
    onColourChange(list.id, colour);
  };

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Derived styles ──────────────────────────────────────────────────────
  const colour = list.board_colour || null;
  const containerStyle = {
    height: 'calc(100vh - 160px)',
    opacity: isDragging ? 0.5 : 1,
    transition: 'opacity 0.15s',
    overflow: 'hidden',
  };
  const headerStyle = colour ? { backgroundColor: `${colour}14` } : {};

  return (
    <div
      className="flex flex-col w-[340px] min-w-[340px] flex-shrink-0 bg-card border border-border rounded-xl shadow-sm"
      style={containerStyle}
    >
      {/* Top accent bar */}
      {colour && (
        <div style={{ height: 3, background: colour, borderRadius: '10px 10px 0 0', flexShrink: 0 }} />
      )}
      {/* Header */}
      <div
        className="px-2 pt-3 pb-2 flex-shrink-0 border-b border-border"
        style={{ ...headerStyle, minHeight: 80 }}
      >
        <div className="flex items-start gap-1">
          {/* Drag handle */}
          <DragHandle dragHandleProps={dragHandleProps} />

          {/* Title + badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleValue}
                  onChange={e => setTitleValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleTitleCommit();
                    if (e.key === 'Escape') { setTitleValue(list.title); setEditingTitle(false); }
                  }}
                  onBlur={handleTitleCommit}
                  className="text-sm font-bold bg-transparent border-b border-primary text-foreground outline-none w-full leading-tight pb-0.5"
                />
              ) : (
                <h3
                  className="text-sm font-bold text-foreground truncate cursor-pointer hover:underline decoration-dotted underline-offset-2"
                  onClick={() => setEditingTitle(true)}
                  title={list.title}
                >
                  {list.title}
                </h3>
              )}
              {savedFlash && (
                <span className="text-[10px] text-green-400 font-semibold whitespace-nowrap flex-shrink-0">Saved ✓</span>
              )}
              {list.is_private && <Icon name="Lock" className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={list.status} size="sm" />
              {list.order_by_date && <OrderByBadge date={list.order_by_date} />}
            </div>
          </div>

          {/* Right actions: collaborators, count, expand, palette, share, menu */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Collaborator avatars */}
            {collaborators?.length > 0 && (
              <div className="flex items-center -space-x-1.5 mr-1">
                {collaborators.slice(0, 3).map((c, i) => (
                  <div
                    key={c.user_id || i}
                    title={c.full_name || c.email || 'Collaborator'}
                    style={{
                      width: 20, height: 20, borderRadius: '50%',
                      background: c.avatar_url ? 'transparent' : '#4A90E2',
                      border: '1.5px solid var(--color-card, #fff)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, fontWeight: 700, color: '#fff',
                      overflow: 'hidden', flexShrink: 0,
                      backgroundImage: c.avatar_url ? `url(${c.avatar_url})` : undefined,
                      backgroundSize: 'cover',
                    }}
                  >
                    {!c.avatar_url && (c.full_name?.[0] || c.email?.[0] || '?').toUpperCase()}
                  </div>
                ))}
                {collaborators.length > 3 && (
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#E2E8F0', border: '1.5px solid var(--color-card, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#64748B', flexShrink: 0 }}>
                    +{collaborators.length - 3}
                  </div>
                )}
              </div>
            )}
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
            {/* Palette button */}
            <div className="relative" ref={colourBtnRef}>
              <button
                onClick={() => setColourOpen(v => !v)}
                title="Board colour"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {/* Palette SVG */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" stroke="none" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" stroke="none" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" stroke="none" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" stroke="none" />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                </svg>
              </button>
              {colourOpen && (
                <ColourPicker
                  current={colour}
                  onSelect={handleColourSelect}
                  onClose={() => setColourOpen(false)}
                />
              )}
            </div>

            <BoardMenu
              canEdit={canEdit}
              canCommandDelete={canCommandDelete}
              onEdit={onEditBoard}
              onDuplicate={onDuplicate}
              onDeleteClick={() => setConfirmDelete(true)}
              onShare={onShare ? () => onShare(list) : undefined}
            />
          </div>
        </div>

        {list.estimated_cost > 0 && (
          <p className="text-xs text-muted-foreground mt-1 pl-6">
            {currencySymbol}{Math.round(list.estimated_cost).toLocaleString()} est.
          </p>
        )}
      </div>

      {/* Delete confirmation banner — replaces items area */}
      {confirmDelete ? (
        <div className="flex-1 flex items-start p-4">
          <div className="w-full bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-sm font-semibold text-red-400 mb-1">Delete this board?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will permanently delete the board and all its items. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmDelete(false); onDelete(); }}
                className="flex-1 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 bg-muted text-foreground text-sm rounded-lg hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Suggestions + Templates buttons */}
          <div className="flex items-center gap-1.5 px-2 pt-2 flex-shrink-0">
            <button
              onClick={onSuggestions}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors border border-border"
            >
              <span>✦</span><span>Suggestions</span>
            </button>
            <button
              onClick={onTemplates}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors border border-border"
            >
              <Icon name="FileText" className="w-3 h-3" />
              <span>Templates</span>
            </button>
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
        </>
      )}
    </div>
  );
};

export default BoardColumn;
