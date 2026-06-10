import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import ItemCard from './ItemCard';
import { updateProvisioningList } from '../utils/provisioningStorage';
import { getBoardStatusConfig } from '../data/statusConfig';

// Lane status line — dot colour + label come from the unified
// statusConfig (BOARD_STATUS_CONFIG). The 3D bottom-edge of the lane
// gets its colour from the same status via data-status (see
// provisioning-board.css).

// ── Drag handle (six-dot grip) ───────────────────────────────────────────────

const DragHandle = ({ dragHandleProps }) => (
  // Sits inline beside the board name (top-left of the header), aligned
  // to the name's vertical centre via .pv-lane-title-row's align-items.
  // stopPropagation on click — dnd-kit's PointerSensor fires a synthetic
  // click on press-without-drag (movement < activation distance 8); that
  // click must never bubble to the lane's onClick → onNavigate route.
  // Drag itself is unaffected (dragHandleProps' listeners are pointer*,
  // not click).
  <div
    {...dragHandleProps}
    onClick={e => e.stopPropagation()}
    title="Drag to reorder"
    className="pv-lane-grip"
    style={{ touchAction: 'none' }}
  >
    {/* 2-col × 3-row dot grid. Smaller radius for a lighter weight. */}
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      <circle cx="2.5" cy="3"  r="1.25" />
      <circle cx="7.5" cy="3"  r="1.25" />
      <circle cx="2.5" cy="8"  r="1.25" />
      <circle cx="7.5" cy="8"  r="1.25" />
      <circle cx="2.5" cy="13" r="1.25" />
      <circle cx="7.5" cy="13" r="1.25" />
    </svg>
  </div>
);


// ── Colour picker ────────────────────────────────────────────────────────────
// Pale-wash palette only — navy editorial text sits on the tinted header
// and must remain readable. Saturated hues would clash with the body text.

const SWATCHES = [
  { label: 'Blue',      value: '#E4ECF4' },
  { label: 'Green',     value: '#E7F0E7' },
  { label: 'Amber',     value: '#FAEEDA' },
  { label: 'Pink',      value: '#F4E4EC' },
  { label: 'Lilac',     value: '#EDE9F4' },
  { label: 'Warm grey', value: '#F0EBE0' },
  { label: 'Default',   value: null },
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
      onClick={e => e.stopPropagation()}
      className="absolute right-0 top-8 z-50"
      style={{
        background: '#FFFFFF',
        border: '0.5px solid #D4CCBB',
        borderRadius: 11,
        padding: 12,
        width: 184,
        boxShadow: '0 12px 28px rgba(38,42,83,0.10)',
      }}
    >
      <p style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.13em',
        textTransform: 'uppercase', color: '#695880',
        margin: '0 0 8px',
      }}>Board colour</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {SWATCHES.map((s) => {
          const isSelected = s.value === current || (!s.value && !current);
          return (
            <button
              key={s.label}
              title={s.label}
              onClick={() => { onSelect(s.value); onClose(); }}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: s.value || '#FFFFFF',
                border: isSelected ? '2px solid #262A53' : '0.5px solid #D4CCBB',
                cursor: 'pointer', padding: 0, position: 'relative', flexShrink: 0,
                outline: 'none',
              }}
            >
              {/* Default swatch — diagonal slash */}
              {!s.value && (
                <svg viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  <line x1="5" y1="5" x2="19" y2="19" stroke="#C65A1A" strokeWidth="2" strokeLinecap="round" />
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

// stopPropagation wraps the whole BoardMenu so the trigger, dropdown,
// every menu item, and the colour-picker swatches it can open never
// bubble to the .pv-lane click → onNavigate route.
const BoardMenu = ({ canEdit, canCommandDelete, onEdit, onDuplicate, onDeleteClick, onShare, onSaveAsTemplate, currentColour, onColourSelect }) => {
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => { setOpen(!open); setPaletteOpen(false); }}
        className="pv-menu-trigger"
        title="Board actions"
      >
        <Icon name="MoreVertical" className="w-4 h-4" />
      </button>
      {open && (
        <div className="pv-menu-dropdown">
          {canEdit && (
            <button onClick={() => { setOpen(false); onEdit(); }} className="pv-menu-item">
              <span className="pv-menu-item-icon"><Icon name="Pencil" className="w-3.5 h-3.5" /></span>
              Edit board details
            </button>
          )}
          <button onClick={() => { setOpen(false); onDuplicate(); }} className="pv-menu-item">
            <span className="pv-menu-item-icon"><Icon name="Copy" className="w-3.5 h-3.5" /></span>
            Duplicate
          </button>
          {onSaveAsTemplate && (
            <button onClick={() => { setOpen(false); onSaveAsTemplate(); }} className="pv-menu-item">
              <span className="pv-menu-item-icon"><Icon name="FileText" className="w-3.5 h-3.5" /></span>
              Save as Template
            </button>
          )}
          {onShare && (
            <button onClick={() => { setOpen(false); onShare(); }} className="pv-menu-item">
              <span className="pv-menu-item-icon"><Icon name="Share2" className="w-3.5 h-3.5" /></span>
              Share board
            </button>
          )}
          <button onClick={() => { setOpen(false); setPaletteOpen(true); }} className="pv-menu-item">
            <span className="pv-menu-item-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" stroke="none" />
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" stroke="none" />
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" stroke="none" />
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" stroke="none" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
            </span>
            Board colour
          </button>
          <div className="pv-menu-divider" />
          <button
            onClick={() => { setOpen(false); onDeleteClick(); }}
            className="pv-menu-item pv-menu-item-destructive"
          >
            <span className="pv-menu-item-icon"><Icon name="Trash2" className="w-3.5 h-3.5" /></span>
            Delete board
          </button>
        </div>
      )}
      {paletteOpen && (
        <ColourPicker
          current={currentColour}
          onSelect={onColourSelect}
          onClose={() => setPaletteOpen(false)}
        />
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
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="w-full text-left px-3 py-2 border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 rounded-lg transition-colors"
      >
        + Add item
      </button>
    );
  }

  return (
    <div className="px-1 pb-1" onClick={e => e.stopPropagation()}>
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
  onDuplicate,
  onDelete,
  onNavigate,
  onTitleSave,
  onColourChange,
  onShare,
  onSaveAsTemplate,
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
  // Entry point now lives inside BoardMenu ("Board colour" menu item).
  // Selection still calls the prop the workspace wires up.
  const handleColourSelect = (colour) => {
    onColourChange(list.id, colour);
  };

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Derived values ──────────────────────────────────────────────────────
  const colour = list.board_colour || null;
  const statusVisual = getBoardStatusConfig(list.status);

  // Subline: DEPT · N ITEMS. department may be text[] or comma-string.
  const deptList = Array.isArray(list.department)
    ? list.department.filter(Boolean)
    : (list.department ? String(list.department).split(',').map(s => s.trim()).filter(Boolean) : []);
  const deptLabel = deptList[0] || '';
  const itemTotal = items.length;
  const sublineParts = [];
  if (deptLabel) sublineParts.push(deptLabel);
  sublineParts.push(`${itemTotal} item${itemTotal === 1 ? '' : 's'}`);
  const subline = sublineParts.join(' · ');

  // Progress: only shown once at least one item has been received/partial.
  // Matches the workspace's existing "received-or-partial" definition.
  const receivedCount = items.filter(i => ['received', 'partial'].includes(i.status)).length;
  const showProgress = receivedCount > 0 && items.length > 0;
  const progressPct = items.length > 0 ? Math.round((receivedCount / items.length) * 100) : 0;

  const isPrivate = list.visibility === 'private' || (!list.visibility && list.is_private);

  // Whole-card click routes to the board detail. Excluded zones (name,
  // grip, items, stepper, +Add item, three-dot menu / its picker) each
  // call stopPropagation so they don't bubble here. Drag-in-progress is
  // skipped — dnd-kit suppresses click during an active drag, this is a
  // belt-and-suspenders guard for synthetic clicks at drag-end.
  const handleCardClick = () => { if (!isDragging) onNavigate(list.id); };

  return (
    <div
      className="pv-lane"
      data-status={list.status}
      style={{ opacity: isDragging ? 0.5 : 1, cursor: 'pointer' }}
      onClick={handleCardClick}
    >
      {/* Header — tinted with the user's chosen pale wash when set */}
      <div className="pv-lane-header" style={colour ? { background: colour } : undefined}>
        <div className="pv-lane-header-top">
          {/* Title block: grip + name + flash + lock, then subline */}
          <div className="pv-lane-title-block">
            <div className="pv-lane-title-row">
              {/* Drag handle sits inline beside the name (hover-fade) */}
              <DragHandle dragHandleProps={dragHandleProps} />
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
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                  className="pv-lane-name-input"
                />
              ) : (
                <h3
                  className="pv-lane-name"
                  onClick={e => { e.stopPropagation(); setEditingTitle(true); }}
                  title={list.title}
                >
                  {list.title}
                </h3>
              )}
              {savedFlash && (
                <span className="pv-lane-saved-flash">Saved ✓</span>
              )}
              {isPrivate && (
                <span className="pv-lane-lock"><Icon name="Lock" className="w-3 h-3" /></span>
              )}
            </div>
            <p className="pv-lane-subline">{subline}</p>
          </div>

          {/* Header right: collaborators (decorative) + three-dot menu (sole top-right control) */}
          <div className="pv-lane-actions">
            {collaborators?.length > 0 && (
              <div className="pv-lane-avatars">
                {collaborators.slice(0, 3).map((c, i) => (
                  <div
                    key={c.user_id || i}
                    title={c.full_name || c.email || 'Collaborator'}
                    className="pv-lane-avatar"
                    style={{
                      backgroundImage: c.avatar_url ? `url(${c.avatar_url})` : undefined,
                    }}
                  >
                    {!c.avatar_url && (c.full_name?.[0] || c.email?.[0] || '?').toUpperCase()}
                  </div>
                ))}
                {collaborators.length > 3 && (
                  <div className="pv-lane-avatar pv-lane-avatar-more">+{collaborators.length - 3}</div>
                )}
              </div>
            )}
            <BoardMenu
              canEdit={canEdit}
              canCommandDelete={canCommandDelete}
              onEdit={onEditBoard}
              onDuplicate={onDuplicate}
              onDeleteClick={() => setConfirmDelete(true)}
              onShare={onShare ? () => onShare(list) : undefined}
              onSaveAsTemplate={onSaveAsTemplate}
              currentColour={colour}
              onColourSelect={handleColourSelect}
            />
          </div>
        </div>

        {/* Refined status line: 6px dot + tracked-caps label + 3px progress bar */}
        <div className="pv-lane-statusline">
          <span className="pv-lane-statusdot" style={{ background: statusVisual.color }} />
          <span className="pv-lane-statuslabel" style={{ color: statusVisual.color }}>
            {statusVisual.label}
          </span>
          {showProgress && (
            <div className="pv-lane-progress" title={`${receivedCount} of ${items.length} received`}>
              <div className="pv-lane-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}
        </div>

        {list.estimated_cost > 0 && (
          <p className="pv-lane-cost">
            {currencySymbol}{Math.round(list.estimated_cost).toLocaleString()} est.
          </p>
        )}
      </div>

      {/* Delete confirmation banner — replaces items area */}
      {confirmDelete ? (
        <div
          style={{ flex: 1, display: 'flex', alignItems: 'flex-start', padding: 14 }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            width: '100%',
            background: 'rgba(220, 38, 38, 0.06)',
            border: '0.5px solid rgba(220, 38, 38, 0.35)',
            borderRadius: 12,
            padding: 14,
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', margin: '0 0 4px' }}>Delete this board?</p>
            <p style={{ fontSize: 11, color: '#695880', margin: '0 0 12px' }}>
              This will permanently delete the board and all its items. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(false); onDelete(); }}
                style={{ flex: 1, padding: '8px 0', background: '#B91C1C', color: 'white', fontSize: 13, fontWeight: 600, border: 0, borderRadius: 9, cursor: 'pointer' }}
              >
                Delete
              </button>
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                style={{ flex: 1, padding: '8px 0', background: 'transparent', color: '#262A53', fontSize: 13, border: '0.5px solid #D4CCBB', borderRadius: 9, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Items — scrollable */}
          <div className="pv-lane-items">
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
              <div className="pv-lane-empty">
                {items.length > 0 && items.every(i => i.status === 'received') ? (
                  <>
                    <p className="pv-lane-empty-done" style={{ margin: 0 }}>All items received ✓</p>
                    <p style={{ fontSize: 10, margin: '4px 0 0' }}>Open board for details</p>
                  </>
                ) : (
                  <p style={{ margin: 0 }}>No items yet</p>
                )}
              </div>
            )}
            {hiddenCount > 0 && (
              <p className="pv-lane-hidden-count">
                {hiddenCount} item{hiddenCount !== 1 ? 's' : ''} hidden by filter
              </p>
            )}
          </div>

          {/* Quick-add — always visible */}
          <div className="pv-lane-quickadd">
            <QuickAddItem onAdd={onQuickAdd} />
          </div>
        </>
      )}
    </div>
  );
};

export default BoardColumn;
