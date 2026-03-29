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
  updateProvisioningItem,
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
import ItemDrawer from './components/ItemDrawer';
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
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null });
  const [activeTab, setActiveTab] = useState('items');
  const [hoveredRow, setHoveredRow] = useState(null);
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
      await updateProvisioningItem(item.id, { [field]: value });
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: item[field] } : i));
      showToast('Failed to save', 'error');
    }
  }, []);

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

  const handleItemDrawerSaved = useCallback((listId, savedItems) => {
    setItems(prev => prev.map(i => {
      const match = savedItems.find(s => s.id === i.id);
      return match ? { ...i, ...match } : i;
    }));
    // Keep drawer item in sync so re-saving reflects latest values
    setItemDrawer(prev => {
      if (!prev.item) return prev;
      const updated = savedItems.find(s => s.id === prev.item.id);
      return updated ? { ...prev, item: { ...prev.item, ...updated } } : prev;
    });
  }, []);

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

  // ── Style constants ───────────────────────────────────────────────────────

  const DEPT_CHIP_STYLES = {
    Galley:      { bg: '#FEF9C3', color: '#854D0E' },
    Interior:    { bg: '#EDE9FE', color: '#5B21B6' },
    Deck:        { bg: '#DCFCE7', color: '#166534' },
    Engineering: { bg: '#FFF7ED', color: '#9A3412' },
  };
  const getDeptChip = (dept) => DEPT_CHIP_STYLES[dept] || { bg: '#F1F5F9', color: '#64748B' };

  const STATUS_BADGE = {
    pending:         { bg: '#F8FAFC', color: '#94A3B8', border: '#F1F5F9', dot: '#CBD5E1', label: 'Pending' },
    ordered:         { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', dot: '#60A5FA', label: 'Ordered' },
    received:        { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0', dot: '#4ADE80', label: 'Received' },
    short_delivered: { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A', dot: '#FCD34D', label: 'Short' },
    not_delivered:   { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA', dot: '#FCA5A5', label: 'Not Delivered' },
  };

  const STATUS_HERO_COLOR = {
    draft:                        { dot: '#94A3B8', text: '#94A3B8' },
    pending_approval:             { dot: '#F59E0B', text: '#F59E0B' },
    sent_to_supplier:             { dot: '#3B82F6', text: '#3B82F6' },
    partially_delivered:          { dot: '#F59E0B', text: '#F59E0B' },
    delivered_with_discrepancies: { dot: '#EF4444', text: '#EF4444' },
    delivered:                    { dot: '#22C55E', text: '#22C55E' },
  };

  const TABLE_GRID = '36px minmax(200px,1.5fr) minmax(160px,1fr) minmax(210px,1.2fr) 90px 90px 120px 56px';

  const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
  const currSymbol = CURR_SYMBOLS[currency] || '$';

  // ── Additional computed values ────────────────────────────────────────────

  const isOverdue = list?.order_by_date
    ? new Date(list.order_by_date) < new Date(new Date().setHours(0, 0, 0, 0))
    : false;

  const heroStatus = STATUS_HERO_COLOR[list?.status] || { dot: '#94A3B8', text: '#94A3B8' };
  const statusLabel = (list?.status || '').replace(/_/g, ' ').toUpperCase();

  const renderTitle = (title = '') => {
    const emIdx = title.indexOf('—');
    const hypIdx = title.indexOf(' - ');
    const idx = emIdx !== -1 ? emIdx : hypIdx;
    const sep = emIdx !== -1 ? '—' : ' - ';
    if (idx === -1) return <span>{title}</span>;
    return (
      <>
        <span>{title.slice(0, idx + sep.length)}</span>
        <span style={{ color: '#4A90E2' }}>{title.slice(idx + sep.length)}</span>
      </>
    );
  };

  const metaItems = [
    trip && { icon: 'Calendar', content: trip.title || trip.name },
    list?.port_location && { icon: 'MapPin', content: list.port_location },
    supplierName && { icon: 'User', content: supplierName },
    deptTags.length > 0 && { type: 'chips', content: deptTags },
  ].filter(Boolean);

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

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '36px 32px 0' }}>

          {/* Back link */}
          <button
            onClick={() => navigate('/provisioning')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 20, padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#1E3A5F'}
            onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
          >
            <Icon name="ArrowLeft" style={{ width: 13, height: 13 }} /> Back to boards
          </button>

          {/* Two-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 48, alignItems: 'start', marginBottom: 32 }}>

            {/* Left */}
            <div>
              {/* Status line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: heroStatus.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: heroStatus.text }}>
                  {statusLabel}
                </span>
                {isOverdue && (
                  <span style={{ fontSize: 10, color: '#EF4444', background: '#FEF2F2', padding: '2px 8px', borderRadius: 4, border: '1px solid #FECACA' }}>
                    Overdue
                  </span>
                )}
              </div>

              {/* Board name */}
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.025em', lineHeight: 1.05, marginBottom: 18, margin: '0 0 18px' }}>
                {renderTitle(list.title)}
              </h1>

              {/* Meta band */}
              {metaItems.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                  {metaItems.map((m, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontSize: 11, color: '#94A3B8',
                      paddingLeft: idx === 0 ? 0 : 16, paddingRight: 16,
                      borderRight: idx === metaItems.length - 1 ? 'none' : '1px solid #F1F5F9',
                    }}>
                      {m.type === 'chips' ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {m.content.map(d => {
                            const cs = getDeptChip(d);
                            return (
                              <span key={d} style={{ background: cs.bg, color: cs.color, fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                {d}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          <Icon name={m.icon} style={{ width: 13, height: 13, flexShrink: 0 }} />
                          {m.content}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 16 }}>
              {/* Total block */}
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#CBD5E1', marginBottom: 6 }}>
                  Estimated Total
                </p>
                <div style={{ fontSize: 40, fontWeight: 300, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>
                  <span style={{ fontSize: 20, color: '#CBD5E1', fontWeight: 300 }}>{currSymbol}</span>
                  {Math.round(grandTotals.estimated).toLocaleString()}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80', display: 'inline-block', flexShrink: 0 }} />
                    {currSymbol}{Math.round(grandTotals.actual).toLocaleString()} received
                  </span>
                  <span style={{ fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FCD34D', display: 'inline-block', flexShrink: 0 }} />
                    {currSymbol}{Math.round(Math.max(0, grandTotals.estimated - grandTotals.actual)).toLocaleString()} outstanding
                  </span>
                </div>
              </div>

              {/* Actions row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => showToast('Smart Suggestions coming soon', 'success')}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8' }}
                >
                  ✦ Suggestions
                </button>
                <button
                  onClick={() => showToast('Templates coming soon', 'success')}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
                >
                  <Icon name="FileText" style={{ width: 13, height: 13 }} /> Templates
                </button>
                <button
                  onClick={() => { showToast('Use "Save as PDF" in the print dialog', 'success'); setTimeout(() => window.print(), 300); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
                >
                  <Icon name="FileDown" style={{ width: 13, height: 13 }} /> PDF
                </button>
                <button
                  onClick={() => window.print()}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
                >
                  <Icon name="Printer" style={{ width: 13, height: 13 }} /> Print
                </button>
                {isDraftOrPending && (
                  <button
                    onClick={() => handleStatusUpdate(PROVISIONING_STATUS.PENDING_APPROVAL)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '7px 13px', borderRadius: 7, cursor: 'pointer', background: '#1E3A5F', border: '1px solid #1E3A5F', color: 'white' }}
                  >
                    <Icon name="Send" style={{ width: 13, height: 13 }} /> Submit for Approval
                  </button>
                )}
                {/* More options */}
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setShowMenu(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', padding: '7px 9px', borderRadius: 7, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
                  >
                    <Icon name="MoreHorizontal" style={{ width: 14, height: 14 }} />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[185px] z-50">
                      <button onClick={() => { setShowMenu(false); setShowEditModal(true); }} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                        <Icon name="Pencil" className="w-4 h-4" /> Edit Board
                      </button>
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

          {/* Tabs */}
          <div style={{ display: 'flex', borderTop: '1px solid #F8FAFC', marginTop: 0 }}>
            {[
              { id: 'items', label: 'Items' },
              { id: 'details', label: 'Board Details' },
              { id: 'deliveries', label: 'Deliveries' },
              { id: 'history', label: 'History' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 500,
                  color: activeTab === tab.id ? '#1E3A5F' : '#94A3B8',
                  padding: '12px 18px', cursor: 'pointer', background: 'none', border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #4A90E2' : '2px solid transparent',
                  marginBottom: -1, transition: 'all 0.15s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

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
        <div style={{ background: 'white', borderBottom: '1px solid #F1F5F9', padding: '10px 32px', position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ position: 'relative' }}>
              <Icon name="Search" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#CBD5E1', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search items…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 28, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: 12, background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 7, color: '#0F172A', outline: 'none', width: 220 }}
              />
            </div>
            {/* Dept filter */}
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              style={{ fontSize: 11, background: 'white', border: '1px solid #F1F5F9', borderRadius: 7, padding: '6px 10px', color: '#64748B', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All depts</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ fontSize: 11, background: 'white', border: '1px solid #F1F5F9', borderRadius: 7, padding: '6px 10px', color: '#64748B', outline: 'none', cursor: 'pointer' }}
            >
              <option value="all">All statuses</option>
              {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {hasFilters && (
              <button
                onClick={() => { setSearchQuery(''); setDeptFilter('all'); setStatusFilter('all'); }}
                style={{ fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                onMouseEnter={e => e.currentTarget.style.color = '#1E3A5F'}
                onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
              >
                Clear filters
              </button>
            )}
          </div>
          {/* Progress */}
          {(() => {
            const totalItems = items.length;
            const receivedItems = items.filter(i => i.status === 'received').length;
            const pct = totalItems > 0 ? receivedItems / totalItems : 0;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                  {receivedItems} of {totalItems} items received
                </span>
                <div style={{ width: 64, height: 3, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                  <div style={{ height: '100%', width: `${Math.round(pct * 100)}%`, background: 'linear-gradient(90deg, #4A90E2, #34D399)', borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Items area ────────────────────────────────────────────────── */}
        <div style={{ padding: '24px 32px 48px' }}>
          {deptGroups.length === 0 && !hasFilters ? (
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, background: '#F8FAFC', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Icon name="ShoppingBag" style={{ width: 28, height: 28, color: '#CBD5E1' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#0F172A', marginBottom: 4 }}>No items yet</p>
              <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>Add items to track your provisioning order.</p>
              <button
                onClick={() => { setAddingToDept(departments[0] || 'Other'); setNewItemName(''); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#1E3A5F', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                <Icon name="Plus" style={{ width: 14, height: 14 }} /> Add first item
              </button>
            </div>
          ) : deptGroups.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>No items match your filters.</div>
          ) : (
            <>
              {deptGroups.map(({ dept, items: deptItems }) => {
                const deptChip = getDeptChip(dept);
                const deptSubtotal = deptItems.reduce((acc, i) => acc + (parseFloat(i.quantity_ordered) || 0) * (parseFloat(i.estimated_unit_cost) || 0), 0);
                const allDeptSel = deptItems.length > 0 && deptItems.every(i => selectedItems.has(i.id));
                return (
                  <div key={dept} style={{ marginBottom: 24 }}>
                    {/* Dept header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ background: deptChip.bg, color: deptChip.color, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 4, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                        {dept}
                      </span>
                      <span style={{ fontSize: 11, color: '#CBD5E1', flexShrink: 0 }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                      <div style={{ flex: 1, height: 1, background: '#F1F5F9' }} />
                      <span style={{ fontSize: 11, color: '#94A3B8', flexShrink: 0 }}>{currSymbol}{deptSubtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    </div>

                    {/* White card table */}
                    <div style={{ background: 'white', border: '1px solid #F1F5F9', borderRadius: 10, overflow: 'hidden' }}>
                      {/* Table header */}
                      <div style={{ display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px', background: '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
                        {/* Checkbox */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0' }}>
                          <input type="checkbox" checked={allDeptSel} onChange={() => {
                            setSelectedItems(prev => {
                              const n = new Set(prev);
                              deptItems.forEach(i => allDeptSel ? n.delete(i.id) : n.add(i.id));
                              return n;
                            });
                          }} style={{ width: 13, height: 13, accentColor: '#4A90E2', cursor: 'pointer' }} />
                        </div>
                        {['Item', 'Brand / Size', 'Category', 'Qty', 'Unit Cost', 'Status', ''].map((h, hi) => (
                          <div key={hi} style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                            {h}
                          </div>
                        ))}
                      </div>

                      {/* Item rows */}
                      {deptItems.map((item, rowIdx) => {
                        const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
                        const isHovered = hoveredRow === item.id;
                        const isEditing = editingCell?.itemId === item.id;
                        const allergen = isAllergenRisk(item);
                        return (
                          <div
                            key={item.id}
                            onMouseEnter={() => setHoveredRow(item.id)}
                            onMouseLeave={() => setHoveredRow(null)}
                            style={{
                              display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px',
                              background: allergen ? '#FFFBEB' : isHovered ? '#FAFCFF' : 'white',
                              borderBottom: rowIdx < deptItems.length - 1 ? '1px solid #F8FAFC' : 'none',
                              transition: 'background 0.1s',
                            }}
                          >
                            {/* Checkbox */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0' }}>
                              <input type="checkbox" checked={selectedItems.has(item.id)} onChange={() => toggleItem(item.id)} style={{ width: 13, height: 13, accentColor: '#4A90E2', cursor: 'pointer' }} />
                            </div>
                            {/* Item name */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 6 }}>
                              {allergen && <span title="Allergen risk" style={{ fontSize: 11 }}>⚠</span>}
                              {editingCell?.itemId === item.id && editingCell?.field === 'name' ? (
                                <input
                                  autoFocus
                                  defaultValue={item.name}
                                  onBlur={e => { handleCellSave(item, 'name', e.target.value); setEditingCell(null); }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                  style={{ fontSize: 13, color: '#0F172A', background: '#F0F7FF', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 6px', width: '100%', outline: 'none' }}
                                />
                              ) : (
                                <span
                                  onDoubleClick={() => setEditingCell({ itemId: item.id, field: 'name' })}
                                  style={{ fontSize: 13, color: '#0F172A', fontWeight: 500, cursor: 'default', lineHeight: 1.3 }}
                                >
                                  {item.name}
                                </span>
                              )}
                            </div>
                            {/* Brand / Size */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              <span style={{ fontSize: 12, color: '#64748B' }}>
                                {[item.brand, item.size].filter(Boolean).join(' · ') || <span style={{ color: '#CBD5E1' }}>—</span>}
                              </span>
                            </div>
                            {/* Category */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              <span style={{ fontSize: 12, color: '#64748B' }}>
                                {[item.category, item.sub_category].filter(Boolean).join(' / ') || <span style={{ color: '#CBD5E1' }}>—</span>}
                              </span>
                            </div>
                            {/* Qty + Unit */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px', gap: 4 }}>
                              {editingCell?.itemId === item.id && editingCell?.field === 'quantity_ordered' ? (
                                <input
                                  autoFocus
                                  type="number"
                                  defaultValue={item.quantity_ordered ?? ''}
                                  onBlur={e => { handleCellSave(item, 'quantity_ordered', e.target.value); setEditingCell(null); }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                  style={{ fontSize: 13, color: '#0F172A', background: '#F0F7FF', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 6px', width: 56, outline: 'none' }}
                                />
                              ) : (
                                <span
                                  onDoubleClick={() => setEditingCell({ itemId: item.id, field: 'quantity_ordered' })}
                                  style={{ fontSize: 13, color: '#0F172A', cursor: 'default', minWidth: 24 }}
                                >
                                  {item.quantity_ordered ?? <span style={{ color: '#CBD5E1' }}>—</span>}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: '#94A3B8' }}>{item.unit || ''}</span>
                            </div>
                            {/* Unit Cost */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              {editingCell?.itemId === item.id && editingCell?.field === 'estimated_unit_cost' ? (
                                <input
                                  autoFocus
                                  type="number"
                                  defaultValue={item.estimated_unit_cost ?? ''}
                                  onBlur={e => { handleCellSave(item, 'estimated_unit_cost', e.target.value); setEditingCell(null); }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                  style={{ fontSize: 13, color: '#0F172A', background: '#F0F7FF', border: '1px solid #93C5FD', borderRadius: 5, padding: '2px 6px', width: 64, outline: 'none' }}
                                />
                              ) : (
                                <span
                                  onDoubleClick={() => setEditingCell({ itemId: item.id, field: 'estimated_unit_cost' })}
                                  style={{ fontSize: 13, color: '#0F172A', cursor: 'default' }}
                                >
                                  {item.estimated_unit_cost != null ? `${currSymbol}${parseFloat(item.estimated_unit_cost).toFixed(2)}` : <span style={{ color: '#CBD5E1' }}>—</span>}
                                </span>
                              )}
                            </div>
                            {/* Status badge select */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 8px' }}>
                              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 5, height: 5, borderRadius: '50%', background: badge.dot, pointerEvents: 'none', zIndex: 1 }} />
                                <select
                                  value={item.status || 'pending'}
                                  onChange={e => handleStatusSave(item, 'status', e.target.value)}
                                  style={{
                                    paddingLeft: 16, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
                                    fontSize: 11, fontWeight: 600, background: badge.bg, color: badge.color,
                                    border: `1px solid ${badge.border}`, borderRadius: 6,
                                    cursor: 'pointer', outline: 'none', appearance: 'none',
                                  }}
                                >
                                  {ITEM_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                              </div>
                            </div>
                            {/* Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '11px 0', gap: 2 }}>
                              {isHovered && (
                                <>
                                  <button
                                    onClick={() => setItemDrawer({ open: true, item })}
                                    title="Edit"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                  >
                                    <Icon name="Pencil" style={{ width: 12, height: 12 }} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    title="Delete"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', color: '#94A3B8' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#EF4444'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
                                  >
                                    <Icon name="Trash2" style={{ width: 12, height: 12 }} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Subtotal row */}
                      <div style={{ display: 'grid', gridTemplateColumns: TABLE_GRID, gap: 0, padding: '0 16px', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                        <div style={{ gridColumn: '1 / 6', padding: '8px 8px 8px 0' }}>
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>{deptItems.length} item{deptItems.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ padding: '8px 8px', display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1E3A5F' }}>{currSymbol}{deptSubtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                        <div />
                      </div>

                      {/* Add item row */}
                      {addingToDept === dept ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px dashed #E2E8F0', background: '#FAFEFF' }}>
                          <input
                            autoFocus
                            type="text"
                            placeholder="Item name…"
                            value={newItemName}
                            onChange={e => setNewItemName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddItem(dept); if (e.key === 'Escape') { setAddingToDept(null); setNewItemName(''); } }}
                            style={{ flex: 1, fontSize: 13, background: 'white', border: '1px solid #93C5FD', borderRadius: 6, padding: '5px 10px', outline: 'none', color: '#0F172A' }}
                          />
                          <button onClick={() => handleAddItem(dept)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', background: '#1E3A5F', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer' }}>Add</button>
                          <button onClick={() => { setAddingToDept(null); setNewItemName(''); }} style={{ fontSize: 12, padding: '5px 10px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, color: '#94A3B8', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAddingToDept(dept); setNewItemName(''); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '9px 16px', background: 'none', border: 'none', borderTop: '1px dashed #F1F5F9', cursor: 'pointer', fontSize: 12, color: '#CBD5E1', textAlign: 'left' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#FAFEFF'; e.currentTarget.style.color = '#4A90E2'; e.currentTarget.style.borderTopColor = '#4A90E2'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#CBD5E1'; e.currentTarget.style.borderTopColor = '#F1F5F9'; }}
                        >
                          <Icon name="Plus" style={{ width: 13, height: 13 }} /> Add item to {dept}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Grand total row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderTop: '2px solid #F1F5F9', marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{items.length} item{items.length !== 1 ? 's' : ''} total</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>
                    Estimated: <span style={{ fontWeight: 700, color: '#0F172A' }}>{currSymbol}{Math.round(grandTotals.estimated).toLocaleString()}</span>
                  </span>
                  {grandTotals.actual > 0 && (
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>
                      Received: <span style={{ fontWeight: 700, color: '#15803D' }}>{currSymbol}{Math.round(grandTotals.actual).toLocaleString()}</span>
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

      <ItemDrawer
        open={itemDrawer.open}
        item={itemDrawer.item}
        listId={id}
        tenantId={activeTenantId}
        listCurrency={currency}
        departments={departments}
        theme="light"
        onSaved={handleItemDrawerSaved}
        onDeleted={(listId, itemId) => {
          setItems(prev => prev.filter(i => i.id !== itemId));
          setItemDrawer({ open: false, item: null });
        }}
        onClose={() => setItemDrawer({ open: false, item: null })}
      />
    </>
  );
};

export default ProvisioningBoardDetail;
