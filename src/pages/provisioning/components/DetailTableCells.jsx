import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import {
  PROVISION_CATEGORIES,
  PROVISION_UNITS,
} from '../utils/provisioningStorage';

// ── Grid template shared across header / rows / subtotal ─────────────────────
// cols: check | name | brand | size | category | dept | qty_ord | qty_rec | unit | unit_cost | total | status | actions
export const DETAIL_GRID = '36px minmax(140px,1fr) 95px 72px 118px 98px 98px 98px 68px 80px 80px 118px 72px';

// ── Item status config ────────────────────────────────────────────────────────
export const ITEM_STATUS_OPTIONS = [
  { value: 'pending',         label: 'Pending',       color: '#94A3B8', bg: 'rgba(100,116,139,0.15)' },
  { value: 'ordered',         label: 'Ordered',       color: '#4A90E2', bg: 'rgba(74,144,226,0.15)'  },
  { value: 'received',        label: 'Received',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)'   },
  { value: 'short_delivered', label: 'Short',         color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  { value: 'not_delivered',   label: 'Not Delivered', color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
];
export const getStatusCfg = (s) => ITEM_STATUS_OPTIONS.find(o => o.value === s) || ITEM_STATUS_OPTIONS[0];

// ── EditCell — click to edit text / number cell ───────────────────────────────
export const EditCell = ({ item, field, value, type = 'text', align = 'left', placeholder, editingCell, setEditingCell, onSave }) => {
  const isActive = editingCell?.itemId === item.id && editingCell?.field === field;
  const inputRef = useRef(null);
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch { /* number inputs don't support select on all browsers */ }
    }
  }, [isActive]);

  const activate = () => {
    setLocal(value ?? '');
    setEditingCell({ itemId: item.id, field });
  };

  const commit = () => {
    setEditingCell(null);
    onSave(item, field, local);
  };

  if (isActive) {
    return (
      <div className="px-1 flex items-center min-h-[38px]">
        <input
          ref={inputRef}
          type={type}
          value={local}
          onChange={e => setLocal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditingCell(null);
          }}
          onBlur={commit}
          className={`w-full bg-primary/5 border border-primary/40 rounded px-1.5 py-0.5 text-[13px] text-foreground outline-none ${align === 'right' ? 'text-right tabular-nums' : ''}`}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center px-2 min-h-[38px] cursor-text select-none ${align === 'right' ? 'justify-end' : ''}`}
      onClick={activate}
    >
      {value != null && value !== '' ? (
        <span className={`text-[13px] text-foreground truncate ${align === 'right' ? 'tabular-nums' : ''}`}>{value}</span>
      ) : (
        <span className="text-[12px] text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors">{placeholder || '—'}</span>
      )}
    </div>
  );
};

// ── SelectCell — click to open inline select ──────────────────────────────────
export const SelectCell = ({ item, field, value, options, editingCell, setEditingCell, onSave }) => {
  const isActive = editingCell?.itemId === item.id && editingCell?.field === field;
  const selectRef = useRef(null);

  useEffect(() => {
    if (isActive && selectRef.current) selectRef.current.focus();
  }, [isActive]);

  if (isActive) {
    return (
      <div className="px-1 flex items-center min-h-[38px]">
        <select
          ref={selectRef}
          defaultValue={value ?? ''}
          onChange={e => {
            onSave(item, field, e.target.value);
            setEditingCell(null);
          }}
          onBlur={() => setEditingCell(null)}
          className="w-full bg-muted border border-primary/40 rounded px-1.5 py-0.5 text-[13px] text-foreground outline-none"
        >
          <option value="">—</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }

  const display = options.find(o => o.value === value)?.label || value;
  return (
    <div
      className="flex items-center px-2 min-h-[38px] cursor-pointer select-none"
      onClick={() => setEditingCell({ itemId: item.id, field })}
    >
      {display ? (
        <span className="text-[13px] text-foreground truncate">{display}</span>
      ) : (
        <span className="text-[12px] text-muted-foreground/25">—</span>
      )}
    </div>
  );
};

// ── QtyCell — qty with − / + buttons and click-to-type ───────────────────────
export const QtyCell = ({ item, field, value, editingCell, setEditingCell, onSave, onStep }) => {
  const isActive = editingCell?.itemId === item.id && editingCell?.field === field;
  const inputRef = useRef(null);
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch { /* ok */ }
    }
  }, [isActive]);

  const activate = () => {
    setLocal(value ?? '');
    setEditingCell({ itemId: item.id, field });
  };

  const commit = () => {
    setEditingCell(null);
    onSave(item, field, local);
  };

  if (isActive) {
    return (
      <div className="flex items-center justify-end px-2 min-h-[38px]">
        <input
          ref={inputRef}
          type="number"
          min="0"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditingCell(null);
          }}
          onBlur={commit}
          className="w-14 bg-primary/5 border border-primary/40 rounded px-1.5 py-0.5 text-[13px] text-foreground text-right outline-none tabular-nums"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5 px-2 min-h-[38px]" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => onStep(item, field, -1)}
        style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0 }}
      >−</button>
      <span
        className="text-[13px] font-medium text-foreground tabular-nums min-w-[24px] text-center cursor-text"
        onClick={activate}
      >
        {value ?? '—'}
      </span>
      <button
        onClick={() => onStep(item, field, 1)}
        style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0 }}
      >+</button>
    </div>
  );
};

// ── StatusCell — click to open status select ──────────────────────────────────
export const StatusCell = ({ item, editingCell, setEditingCell, onSave }) => {
  const isActive = editingCell?.itemId === item.id && editingCell?.field === 'status';
  const selectRef = useRef(null);
  const cfg = getStatusCfg(item.status);

  useEffect(() => {
    if (isActive && selectRef.current) selectRef.current.focus();
  }, [isActive]);

  if (isActive) {
    return (
      <div className="px-1 flex items-center min-h-[38px]">
        <select
          ref={selectRef}
          defaultValue={item.status}
          onChange={e => {
            onSave(item, 'status', e.target.value);
            setEditingCell(null);
          }}
          onBlur={() => setEditingCell(null)}
          className="w-full bg-muted border border-primary/40 rounded px-1.5 py-0.5 text-[12px] text-foreground outline-none"
        >
          {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div
      className="flex items-center px-2 min-h-[38px] cursor-pointer select-none"
      onClick={() => setEditingCell({ itemId: item.id, field: 'status' })}
    >
      <span
        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap"
        style={{ background: cfg.bg, color: cfg.color }}
      >
        {cfg.label}
      </span>
    </div>
  );
};

// ── DeptGroup — one department section with items table ───────────────────────
export const DeptGroup = ({
  dept,
  items,
  currency,
  selectedItems,
  allChecked,
  editingCell,
  setEditingCell,
  isAllergenRisk,
  deptOptions = [],
  onEditItem,
  onToggleAll,
  onToggleItem,
  onCellSave,
  onQtyStep,
  onStatusSave,
  onDeleteItem,
  onAddItem,
  formatCurrency: fmt,
  addingToDept,
  setAddingToDept,
  newItemName,
  setNewItemName,
}) => {
  const subtotal = items.reduce((sum, i) => {
    return sum + (parseFloat(i.quantity_ordered) || 0) * (parseFloat(i.estimated_unit_cost) || 0);
  }, 0);

  const categoryOptions = (PROVISION_CATEGORIES[dept] || []).map(c => ({ value: c, label: c }));
  const unitOptions = PROVISION_UNITS.map(u => ({ value: u, label: u }));
  const isAdding = addingToDept === dept;

  return (
    <div className="mb-8">
      {/* Dept heading */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {dept}
        </span>
        <span className="text-[11px] text-muted-foreground/50">({items.length})</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header row */}
        <div
          className="grid bg-muted/60 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: DETAIL_GRID }}
        >
          <div className="flex items-center justify-center p-2.5">
            <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="w-3.5 h-3.5 cursor-pointer accent-primary" />
          </div>
          <div className="p-2.5">Item Name</div>
          <div className="p-2.5">Brand</div>
          <div className="p-2.5">Size</div>
          <div className="p-2.5">Category</div>
          <div className="p-2.5">Dept</div>
          <div className="p-2.5 text-right">Qty Ord.</div>
          <div className="p-2.5 text-right">Qty Rec.</div>
          <div className="p-2.5">Unit</div>
          <div className="p-2.5 text-right">Unit Cost</div>
          <div className="p-2.5 text-right">Total</div>
          <div className="p-2.5">Status</div>
          <div className="p-2.5" />
        </div>

        {/* Item rows */}
        {items.map((item) => {
          const isRisk = isAllergenRisk(item);
          const isSelected = selectedItems.has(item.id);
          const total = (parseFloat(item.quantity_ordered) || 0) * (parseFloat(item.estimated_unit_cost) || 0);

          return (
            <div
              key={item.id}
              className={`grid border-b border-border last:border-0 transition-colors group
                ${isRisk ? 'bg-amber-50/60 dark:bg-amber-900/10' : isSelected ? 'bg-primary/5' : 'hover:bg-muted/20'}
              `}
              style={{ gridTemplateColumns: DETAIL_GRID }}
            >
              {/* Checkbox */}
              <div className="flex items-center justify-center p-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleItem(item.id)}
                  className="w-3.5 h-3.5 cursor-pointer accent-primary"
                  onClick={e => e.stopPropagation()}
                />
              </div>

              <EditCell item={item} field="name" value={item.name} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} placeholder="Item name" />
              <EditCell item={item} field="brand" value={item.brand} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />
              <EditCell item={item} field="size" value={item.size} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />
              <SelectCell item={item} field="category" value={item.category} options={categoryOptions} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />
              <SelectCell item={item} field="department" value={item.department} options={deptOptions} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />
              <QtyCell item={item} field="quantity_ordered" value={item.quantity_ordered} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} onStep={onQtyStep} />
              <QtyCell item={item} field="quantity_received" value={item.quantity_received} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} onStep={onQtyStep} />
              <SelectCell item={item} field="unit" value={item.unit} options={unitOptions} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />
              <EditCell item={item} field="estimated_unit_cost" value={item.estimated_unit_cost} type="number" align="right" editingCell={editingCell} setEditingCell={setEditingCell} onSave={onCellSave} />

              {/* Total (read-only) */}
              <div className="flex items-center justify-end px-2 min-h-[38px]">
                <span className="text-[13px] text-foreground tabular-nums">
                  {total > 0 ? fmt(total, currency) : '—'}
                </span>
              </div>

              <StatusCell item={item} editingCell={editingCell} setEditingCell={setEditingCell} onSave={onStatusSave} />

              {/* Delete + edit */}
              <div className="flex items-center justify-center gap-0.5 min-h-[38px]">
                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-red-500 transition-colors"
                >
                  <Icon name="Trash2" className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onEditItem?.(item)}
                  className="p-1 rounded transition-colors"
                  style={{ color: 'rgba(0,0,0,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#1E3A5F'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,0,0,0.3)'}
                >
                  <Icon name="Pencil" style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Subtotal row */}
        {subtotal > 0 && (
          <div
            className="grid bg-muted/30 border-t border-border"
            style={{ gridTemplateColumns: DETAIL_GRID }}
          >
            <div /><div className="px-2 py-2 text-[12px] font-medium text-muted-foreground">Subtotal</div>
            <div /><div /><div /><div /><div /><div /><div />
            <div />
            <div className="px-2 py-2 text-right text-[12px] font-semibold text-foreground tabular-nums">
              {fmt(subtotal, currency)}
            </div>
            <div /><div />
          </div>
        )}
      </div>

      {/* + Add item */}
      <div className="mt-2 px-1">
        {isAdding ? (
          <div className="flex items-center gap-2 px-3 py-1.5 border border-dashed border-primary/40 rounded-lg bg-primary/3">
            <Icon name="Plus" className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onAddItem(dept);
                if (e.key === 'Escape') { setAddingToDept(null); setNewItemName(''); }
              }}
              onBlur={() => {
                if (newItemName.trim()) onAddItem(dept);
                else { setAddingToDept(null); setNewItemName(''); }
              }}
              placeholder="Item name — press Enter to add"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            <button
              onClick={() => { setAddingToDept(null); setNewItemName(''); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setAddingToDept(dept); setNewItemName(''); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded hover:bg-muted"
          >
            <Icon name="Plus" className="w-3.5 h-3.5" />
            Add item to {dept}
          </button>
        )}
      </div>
    </div>
  );
};
