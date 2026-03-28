import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import StatusBadge from './components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchProvisioningList,
  fetchListItems,
  fetchSuppliers,
  upsertItems,
  deleteProvisioningItem,
  updateProvisioningList,
  deleteProvisioningList,
  duplicateList,
  fetchVesselDepartments,
  PROVISIONING_STATUS,
  PROVISION_CATEGORIES,
  PROVISION_UNITS,
  formatCurrency,
} from './utils/provisioningStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { showToast } from '../../utils/toast';
import {
  DETAIL_GRID,
  ITEM_STATUS_OPTIONS,
  getStatusCfg,
  EditCell,
  SelectCell,
  QtyCell,
  StatusCell,
  DeptGroup,
} from './components/DetailTableCells';

// ── Edit Board Modal ──────────────────────────────────────────────────────────

const EditBoardModal = ({ list, onSaved, onClose }) => {
  const [form, setForm] = useState({
    title: list.title || '',
    status: list.status || PROVISIONING_STATUS.DRAFT,
    port_location: list.port_location || '',
    order_by_date: list.order_by_date || '',
    notes: list.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const updated = await updateProvisioningList(list.id, {
        title: form.title.trim(),
        status: form.status,
        port_location: form.port_location,
        order_by_date: form.order_by_date || null,
        notes: form.notes,
      });
      onSaved(updated);
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-foreground">Edit Board</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <Icon name="X" className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Title', key: 'title', type: 'text' },
            { label: 'Port / Location', key: 'port_location', type: 'text' },
            { label: 'Order By Date', key: 'order_by_date', type: 'date' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
              <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={fieldCls} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={fieldCls}>
              {Object.values(PROVISIONING_STATUS).map(v => (
                <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={`${fieldCls} resize-none`} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const ProvisioningBoardDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [trip, setTrip] = useState(null);
  const [allergenGuests, setAllergenGuests] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingCell, setEditingCell] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [addingToDept, setAddingToDept] = useState(null);
  const [newItemName, setNewItemName] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const menuRef = useRef(null);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const canDelete = userTier === 'COMMAND';

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (id) loadAll();
    if (activeTenantId) fetchVesselDepartments(activeTenantId).then(setDepartments);
  }, [id, activeTenantId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedList, fetchedItems, fetchedSuppliers] = await Promise.all([
        fetchProvisioningList(id),
        fetchListItems(id),
        activeTenantId ? fetchSuppliers(activeTenantId).catch(() => []) : Promise.resolve([]),
      ]);
      setList(fetchedList);
      setItems(fetchedItems || []);
      setSuppliers(fetchedSuppliers || []);

      if (fetchedList?.trip_id) {
        try {
          const trips = loadTrips() || [];
          const linked = trips.find(t => t.id === fetchedList.trip_id) || null;
          setTrip(linked);

          if (linked?.guests?.length && activeTenantId) {
            const guestIds = new Set(linked.guests.map(g => g.guestId).filter(Boolean));
            const allGuests = await loadGuests(activeTenantId).catch(() => []);
            const withAllergens = allGuests.filter(g =>
              guestIds.has(g.id) && g.allergies?.trim()
            ).map(g => ({
              name: [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest',
              allergies: g.allergies.trim(),
            }));
            setAllergenGuests(withAllergens);
          }
        } catch { /* trip/guest load failed — non-critical */ }
      }
    } catch (err) {
      console.error('[BoardDetail] loadAll error:', err);
      setError('Could not load board.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showMenu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showMenu]);

  // ── Cell save ─────────────────────────────────────────────────────────────

  const handleCellSave = useCallback(async (item, field, rawValue) => {
    let value = rawValue;
    if (['quantity_ordered', 'quantity_received', 'estimated_unit_cost'].includes(field)) {
      value = rawValue === '' || rawValue == null ? null : parseFloat(rawValue) || 0;
    }
    if (item[field] === value) return;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: value } : i));
    try {
      await upsertItems([{ id: item.id, list_id: id, [field]: value }]);
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: item[field] } : i));
      showToast('Failed to save', 'error');
    }
  }, [id]);

  const handleQtyStep = useCallback(async (item, field, delta) => {
    const next = Math.max(0, (parseFloat(item[field]) || 0) + delta);
    await handleCellSave(item, field, next);
  }, [handleCellSave]);

  const handleStatusSave = useCallback(async (item, field, newStatus) => {
    await handleCellSave(item, 'status', newStatus);
  }, [handleCellSave]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this item?')) return;
    setItems(prev => prev.filter(i => i.id !== itemId));
    try {
      await deleteProvisioningItem(itemId);
    } catch {
      showToast('Failed to delete item', 'error');
      loadAll();
    }
  };

  const handleAddItem = async (dept) => {
    if (!newItemName.trim()) return;
    const payload = { list_id: id, name: newItemName.trim(), department: dept === 'Other' ? '' : dept, quantity_ordered: 1, unit: 'each', status: 'pending', source: 'manual' };
    setNewItemName('');
    setAddingToDept(null);
    try {
      const [saved] = await upsertItems([payload]);
      if (saved) setItems(prev => [...prev, saved]);
      else loadAll();
    } catch {
      showToast('Failed to add item', 'error');
    }
  };

  // ── Board actions ─────────────────────────────────────────────────────────

  const handleStatusUpdate = async (newStatus) => {
    setShowMenu(false);
    try {
      const updated = await updateProvisioningList(id, { status: newStatus });
      setList(prev => ({ ...prev, ...updated }));
      showToast('Status updated', 'success');
    } catch { showToast('Failed to update status', 'error'); }
  };

  const handleDuplicate = async () => {
    setShowMenu(false);
    try {
      const newList = await duplicateList(id, activeTenantId, user?.id);
      showToast('Board duplicated', 'success');
      navigate('/provisioning/' + newList.id);
    } catch { showToast('Failed to duplicate', 'error'); }
  };

  const handleDeleteBoard = async () => {
    setShowMenu(false);
    if (!window.confirm(`Delete "${list?.title}"? This cannot be undone.`)) return;
    try {
      await deleteProvisioningList(id);
      navigate('/provisioning');
      showToast('Board deleted', 'success');
    } catch { showToast('Failed to delete board', 'error'); }
  };

  // ── Allergen helpers ──────────────────────────────────────────────────────

  const isAllergenRisk = useCallback((item) => {
    if (!allergenGuests.length) return false;
    const text = `${item.name || ''} ${item.category || ''}`.toLowerCase();
    return allergenGuests.some(g =>
      g.allergies.split(/[,;]+/).some(a => a.trim() && text.includes(a.trim().toLowerCase()))
    );
  }, [allergenGuests]);

  // ── Filtering & grouping ──────────────────────────────────────────────────

  const filteredItems = useMemo(() => items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (deptFilter !== 'all' && item.department !== deptFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!item.name?.toLowerCase().includes(q) && !item.brand?.toLowerCase().includes(q) && !item.category?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [items, statusFilter, deptFilter, searchQuery]);

  const hasFilters = statusFilter !== 'all' || deptFilter !== 'all' || searchQuery;

  const deptGroups = useMemo(() => {
    const groups = {};
    filteredItems.forEach(item => {
      const d = item.department || 'Other';
      if (!groups[d]) groups[d] = [];
      groups[d].push(item);
    });
    if (addingToDept && !groups[addingToDept]) groups[addingToDept] = [];
    const ordered = [];
    departments.forEach(d => { if (groups[d] !== undefined) ordered.push({ dept: d, items: groups[d] }); });
    Object.keys(groups).forEach(d => { if (!departments.includes(d)) ordered.push({ dept: d, items: groups[d] }); });
    return ordered;
  }, [filteredItems, addingToDept, departments]);

  const grandTotals = useMemo(() => items.reduce((acc, i) => {
    const qty = parseFloat(i.quantity_ordered) || 0;
    const qtyRec = parseFloat(i.quantity_received) || 0;
    const cost = parseFloat(i.estimated_unit_cost) || 0;
    return { estimated: acc.estimated + qty * cost, actual: acc.actual + qtyRec * cost };
  }, { estimated: 0, actual: 0 }), [items]);

  // ── Checkboxes ────────────────────────────────────────────────────────────

  const allChecked = filteredItems.length > 0 && filteredItems.every(i => selectedItems.has(i.id));
  const toggleAll = () => setSelectedItems(allChecked ? new Set() : new Set(filteredItems.map(i => i.id)));
  const toggleItem = (itemId) => setSelectedItems(prev => {
    const n = new Set(prev);
    n.has(itemId) ? n.delete(itemId) : n.add(itemId);
    return n;
  });

  // ── Meta helpers ──────────────────────────────────────────────────────────

  const supplierName = list?.supplier_id ? (suppliers.find(s => s.id === list.supplier_id)?.name || null) : null;
  const deptTags = useMemo(() => {
    if (!list?.department) return [];
    return Array.isArray(list.department) ? list.department.filter(Boolean) : list.department.split(',').map(d => d.trim()).filter(Boolean);
  }, [list]);
  const currency = list?.currency || 'USD';
  const isDraftOrPending = list?.status === PROVISIONING_STATUS.DRAFT || list?.status === PROVISIONING_STATUS.PENDING_APPROVAL;

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (error || !list) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background px-6 py-10">
          <button onClick={() => navigate('/provisioning')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
            <Icon name="ArrowLeft" className="w-4 h-4" /> Back to boards
          </button>
          <p className="text-muted-foreground">{error || 'Board not found.'}</p>
        </div>
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Header />
      <div className="min-h-screen bg-background">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-background border-b border-border px-6 py-3">
          <button
            onClick={() => navigate('/provisioning')}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
          >
            <Icon name="ArrowLeft" className="w-3.5 h-3.5" /> Back to boards
          </button>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{list.title}</h1>
              <StatusBadge status={list.status} />
              {list.order_by_date && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded-full text-xs text-muted-foreground border border-border">
                  <Icon name="Calendar" className="w-3 h-3" />
                  {new Date(list.order_by_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isDraftOrPending && (
                <button
                  onClick={() => handleStatusUpdate(PROVISIONING_STATUS.PENDING_APPROVAL)}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
                >
                  Submit for Approval
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(v => !v)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Icon name="MoreHorizontal" className="w-5 h-5" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[185px] z-50">
                    <button onClick={() => { setShowMenu(false); setShowEditModal(true); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                      <Icon name="Pencil" className="w-4 h-4" /> Edit Board
                    </button>
                    {isDraftOrPending && (
                      <button onClick={() => handleStatusUpdate(PROVISIONING_STATUS.PENDING_APPROVAL)} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                        <Icon name="Send" className="w-4 h-4" /> Submit for Approval
                      </button>
                    )}
                    <button onClick={handleDuplicate} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                      <Icon name="Copy" className="w-4 h-4" /> Duplicate
                    </button>
                    {canDelete && (
                      <>
                        <div className="my-1 border-t border-border" />
                        <button onClick={handleDeleteBoard} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2">
                          <Icon name="Trash2" className="w-4 h-4" /> Delete Board
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Meta row ─────────────────────────────────────────────────── */}
        {(trip || list.port_location || supplierName || list.estimated_cost || deptTags.length > 0) && (
          <div className="px-6 py-2.5 border-b border-border flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-muted/20 text-[13px] text-muted-foreground">
            {trip && <span className="flex items-center gap-1.5"><Icon name="Anchor" className="w-3.5 h-3.5 flex-shrink-0" />{trip.title || trip.name}</span>}
            {list.port_location && <span className="flex items-center gap-1.5"><Icon name="MapPin" className="w-3.5 h-3.5 flex-shrink-0" />{list.port_location}</span>}
            {supplierName && <span className="flex items-center gap-1.5"><Icon name="Building2" className="w-3.5 h-3.5 flex-shrink-0" />{supplierName}</span>}
            {list.estimated_cost > 0 && <span className="flex items-center gap-1.5"><Icon name="DollarSign" className="w-3.5 h-3.5 flex-shrink-0" />Est. {formatCurrency(list.estimated_cost, currency)}</span>}
            {deptTags.map(d => <span key={d} className="px-2 py-0.5 bg-muted border border-border rounded text-xs">{d}</span>)}
          </div>
        )}

        {/* ── Allergen banner ───────────────────────────────────────────── */}
        {allergenGuests.length > 0 && (
          <div className="mx-6 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <span className="flex-shrink-0 mt-0.5">⚠</span>
            <div>
              <span className="font-semibold">Allergen alert: </span>
              {allergenGuests.map((g, i) => (
                <span key={i}>{i > 0 && ' · '}<strong>{g.name}</strong> — {g.allergies}</span>
              ))}
              <span className="text-amber-600 dark:text-amber-400"> · Highlighted rows may be affected.</span>
            </div>
          </div>
        )}

        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div className="px-6 py-3 flex items-center justify-between gap-4 border-b border-border flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Icon name="Search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text" placeholder="Search items…" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-44"
              />
            </div>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary">
              <option value="all">All depts</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary">
              <option value="all">All statuses</option>
              {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {hasFilters && (
              <button onClick={() => { setSearchQuery(''); setDeptFilter('all'); setStatusFilter('all'); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Clear filters
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">
              <Icon name="Printer" className="w-4 h-4" /> Print
            </button>
            <button onClick={() => { showToast('Use "Save as PDF" in the print dialog', 'success'); setTimeout(() => window.print(), 300); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">
              <Icon name="FileDown" className="w-4 h-4" /> Export PDF
            </button>
            {isDraftOrPending && (
              <button onClick={() => handleStatusUpdate(PROVISIONING_STATUS.PENDING_APPROVAL)} className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors">
                Submit for Approval
              </button>
            )}
          </div>
        </div>

        {/* ── Items area ────────────────────────────────────────────────── */}
        <div className="px-6 py-5 pb-12">
          {deptGroups.length === 0 && !hasFilters ? (
            <div className="py-20 text-center">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="ShoppingBag" className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No items yet</p>
              <p className="text-xs text-muted-foreground mb-4">Add items to track your provisioning order.</p>
              <button
                onClick={() => { setAddingToDept(departments[0] || 'Other'); setNewItemName(''); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80"
              >
                <Icon name="Plus" className="w-4 h-4" /> Add first item
              </button>
            </div>
          ) : deptGroups.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No items match your filters.</div>
          ) : (
            <>
              {deptGroups.map(({ dept, items: deptItems }) => (
                <DeptGroup
                  key={dept}
                  dept={dept}
                  items={deptItems}
                  deptOptions={departments.map(d => ({ value: d, label: d }))}
                  currency={currency}
                  selectedItems={selectedItems}
                  allChecked={deptItems.length > 0 && deptItems.every(i => selectedItems.has(i.id))}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  isAllergenRisk={isAllergenRisk}
                  onToggleAll={() => {
                    const allSel = deptItems.every(i => selectedItems.has(i.id));
                    setSelectedItems(prev => {
                      const n = new Set(prev);
                      deptItems.forEach(i => allSel ? n.delete(i.id) : n.add(i.id));
                      return n;
                    });
                  }}
                  onToggleItem={toggleItem}
                  onCellSave={handleCellSave}
                  onQtyStep={handleQtyStep}
                  onStatusSave={handleStatusSave}
                  onDeleteItem={handleDeleteItem}
                  onAddItem={handleAddItem}
                  formatCurrency={formatCurrency}
                  addingToDept={addingToDept}
                  setAddingToDept={setAddingToDept}
                  newItemName={newItemName}
                  setNewItemName={setNewItemName}
                />
              ))}

              {/* Grand total */}
              <div className="mt-2 pt-4 border-t-2 border-border flex items-center justify-between flex-wrap gap-4">
                <span className="text-sm text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                <div className="flex items-center gap-6 text-sm flex-wrap">
                  <span className="text-muted-foreground">
                    Estimated total: <span className="font-semibold text-foreground">{formatCurrency(grandTotals.estimated, currency)}</span>
                  </span>
                  {grandTotals.actual > 0 && (
                    <span className="text-muted-foreground">
                      Actual (received): <span className="font-semibold text-foreground">{formatCurrency(grandTotals.actual, currency)}</span>
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showEditModal && (
        <EditBoardModal
          list={list}
          onSaved={(updated) => { setList(prev => ({ ...prev, ...updated })); setShowEditModal(false); showToast('Board saved', 'success'); }}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </>
  );
};

export default ProvisioningBoardDetail;
