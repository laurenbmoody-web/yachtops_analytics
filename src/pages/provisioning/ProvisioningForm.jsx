import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import SmartSuggestionsPanel from './components/SmartSuggestionsPanel';
import {
  fetchProvisioningList,
  fetchListItems,
  createProvisioningList,
  updateProvisioningList,
  upsertItems,
  fetchSuppliers,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
  PROVISION_UNITS,
  PROVISION_CATEGORIES,
} from './utils/provisioningStorage';
import { getSmartSuggestions } from '../../utils/provisioningSuggestions';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';

const STEPS = ['List Details', 'Smart Suggestions', 'Build List', 'Review & Submit'];

const emptyItem = () => ({
  _id: `new_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  name: '',
  category: '',
  department: 'Galley',
  quantity_ordered: 1,
  unit: 'each',
  estimated_unit_cost: '',
  allergen_flags: [],
  source: 'manual',
  notes: '',
  status: 'pending',
});

const ProvisioningForm = () => {
  const navigate = useNavigate();
  const { listId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const isEdit = !!listId;
  const duplicateFromId = searchParams.get('duplicate');
  const prefillTripId = searchParams.get('trip_id');

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(isEdit || !!duplicateFromId);
  const [error, setError] = useState(null);

  // Step 1 — List details
  const [details, setDetails] = useState({
    title: '',
    trip_id: prefillTripId || '',
    department: [],
    port_location: '',
    supplier_id: '',
    notes: '',
    estimated_cost: '',
  });

  // Step 2 — Smart suggestions
  const [suggestions, setSuggestions] = useState({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Step 3 — Items
  const [items, setItems] = useState([emptyItem()]);

  // Supporting data
  const [trips, setTrips] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [tripGuests, setTripGuests] = useState([]);

  useEffect(() => {
    const t = loadTrips() || [];
    setTrips(t);
  }, []);

  useEffect(() => {
    if (!activeTenantId) return;
    fetchSuppliers(activeTenantId).then(setSuppliers).catch(() => {});
  }, [activeTenantId]);

  useEffect(() => {
    if (!isEdit && !duplicateFromId) return;
    const id = listId || duplicateFromId;
    const load = async () => {
      try {
        const [list, listItems] = await Promise.all([
          fetchProvisioningList(id),
          fetchListItems(id),
        ]);
        if (list) {
          setDetails({
            title: duplicateFromId ? `Copy of ${list.title}` : list.title,
            trip_id: list.trip_id || '',
            department: list.department ? list.department.split(',').map(d => d.trim()) : [],
            port_location: list.port_location || '',
            supplier_id: list.supplier_id || '',
            notes: list.notes || '',
            estimated_cost: list.estimated_cost || '',
          });
        }
        if (listItems?.length) {
          setItems(listItems.map(i => ({ ...i, _id: i.id })));
        }
      } catch (err) {
        setError('Failed to load list data.');
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [isEdit, duplicateFromId, listId]);

  // Load smart suggestions when trip_id changes
  useEffect(() => {
    if (!details.trip_id || !activeTenantId) return;
    setSuggestionsLoading(true);
    getSmartSuggestions(details.trip_id, activeTenantId)
      .then(setSuggestions)
      .catch(() => setSuggestions({}))
      .finally(() => setSuggestionsLoading(false));
  }, [details.trip_id, activeTenantId]);

  // Compute trip guest count for scaling banner
  const linkedTrip = trips.find(t => t.id === details.trip_id);
  const guestCount = linkedTrip?.guests?.filter(g => g.isActive !== false)?.length || 0;
  const tripDays = linkedTrip
    ? Math.max(1, Math.round((new Date(linkedTrip.endDate) - new Date(linkedTrip.startDate)) / 86400000))
    : 1;

  // Allergen cross-reference
  const guestAllergens = React.useMemo(() => {
    if (!linkedTrip) return [];
    const stored = localStorage.getItem('cargo.trips.v1');
    return []; // Allergen checking done via suggestions engine
  }, [linkedTrip]);

  // ── Item editing helpers ──────────────────────────────────────────────────

  const addItem = (dept = 'Galley') => {
    setItems(prev => [...prev, { ...emptyItem(), department: dept }]);
  };

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  };

  const removeItem = (id) => {
    setItems(prev => prev.filter(i => i._id !== id));
  };

  const addSuggestions = (suggested) => {
    const newItems = suggested
      .filter(s => !s.is_allergen_note)
      .map(s => ({
        ...emptyItem(),
        name: s.name,
        category: s.category || '',
        department: s.department || 'Galley',
        quantity_ordered: s.quantity_ordered || 1,
        unit: s.unit || 'each',
        source: s.source,
        notes: s.reason || '',
        allergen_flags: s.allergen_flags || [],
      }));
    setItems(prev => [...prev, ...newItems]);
  };

  // ── Department multi-select ───────────────────────────────────────────────

  const toggleDept = (dept) => {
    setDetails(prev => ({
      ...prev,
      department: prev.department.includes(dept)
        ? prev.department.filter(d => d !== dept)
        : [...prev.department, dept],
    }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async (status = PROVISIONING_STATUS.DRAFT) => {
    if (!details.title.trim()) { setError('List title is required.'); setStep(0); return; }
    setSaving(true);
    setError(null);
    try {
      const listPayload = {
        vessel_id: activeTenantId,
        title: details.title.trim(),
        trip_id: details.trip_id || null,
        department: details.department.join(', '),
        port_location: details.port_location || null,
        supplier_id: details.supplier_id || null,
        notes: details.notes || null,
        estimated_cost: details.estimated_cost ? parseFloat(details.estimated_cost) : null,
        status,
        created_by: user?.id,
      };

      let savedListId;
      if (isEdit) {
        await updateProvisioningList(listId, listPayload);
        savedListId = listId;
      } else {
        const created = await createProvisioningList(listPayload);
        savedListId = created.id;
      }

      // Upsert items
      const validItems = items.filter(i => i.name?.trim());
      if (validItems.length) {
        const itemPayload = validItems.map(({ _id, ...i }) => ({
          ...(isEdit || _id?.startsWith('new_') ? {} : { id: _id }),
          ...i,
          list_id: savedListId,
          quantity_ordered: parseFloat(i.quantity_ordered) || 1,
          quantity_received: i.quantity_received ? parseFloat(i.quantity_received) : null,
          estimated_unit_cost: i.estimated_unit_cost ? parseFloat(i.estimated_unit_cost) : null,
          allergen_flags: i.allergen_flags || [],
        }));
        await upsertItems(itemPayload);
      }

      navigate(`/provisioning/${savedListId}`);
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loadingData) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  // Group items by department for display
  const itemsByDept = PROVISION_DEPARTMENTS.reduce((acc, dept) => {
    const deptItems = items.filter(i => i.department === dept);
    if (deptItems.length || details.department.includes(dept)) acc[dept] = deptItems;
    return acc;
  }, {});

  const totalEstimated = items.reduce((sum, i) => {
    const qty = parseFloat(i.quantity_ordered) || 0;
    const cost = parseFloat(i.estimated_unit_cost) || 0;
    return sum + qty * cost;
  }, 0);

  return (
    <>
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/provisioning')} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <Icon name="ArrowLeft" className="w-4 h-4 text-muted-foreground" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">{isEdit ? 'Edit Provisioning List' : 'New Provisioning List'}</h1>
          </div>
        </div>

        {/* Step tabs */}
        <div className="flex gap-0 mb-8 bg-muted rounded-xl p-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => setStep(i)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                i === step ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="hidden sm:inline">{i + 1}. </span>{s}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* ── STEP 0: List Details ─────────────────────────────────────────── */}
        {step === 0 && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">List Title <span className="text-red-500">*</span></label>
              <input
                value={details.title}
                onChange={e => setDetails(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g. Monaco Charter — Week 1 Galley"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Link to Trip (optional)</label>
              <select
                value={details.trip_id}
                onChange={e => setDetails(p => ({ ...p, trip_id: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— No trip linked —</option>
                {trips.filter(t => t.status !== 'completed').map(t => (
                  <option key={t.id} value={t.id}>{t.name || t.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-2">Departments</label>
              <div className="flex flex-wrap gap-2">
                {PROVISION_DEPARTMENTS.map(dept => (
                  <button
                    key={dept}
                    onClick={() => toggleDept(dept)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      details.department.includes(dept)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Port / Location</label>
                <input
                  value={details.port_location}
                  onChange={e => setDetails(p => ({ ...p, port_location: e.target.value }))}
                  placeholder="e.g. Monaco, FR"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Estimated Total Cost</label>
                <input
                  type="number"
                  min="0"
                  value={details.estimated_cost}
                  onChange={e => setDetails(p => ({ ...p, estimated_cost: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Supplier</label>
              <select
                value={details.supplier_id}
                onChange={e => setDetails(p => ({ ...p, supplier_id: e.target.value }))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">— Select supplier (optional) —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.port_location ? ` — ${s.port_location}` : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Notes</label>
              <textarea
                value={details.notes}
                onChange={e => setDetails(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Any specific instructions or requirements…"
              />
            </div>
          </div>
        )}

        {/* ── STEP 1: Smart Suggestions ────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            {!details.trip_id ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <Icon name="Lightbulb" className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Link this list to a trip in Step 1 to get smart suggestions based on guest preferences, low stock items, and order history.</p>
              </div>
            ) : (
              <>
                {guestCount > 0 && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl px-4 py-3 flex items-center gap-2">
                    <Icon name="Users" className="w-4 h-4 text-blue-600 shrink-0" />
                    <p className="text-sm text-blue-700 dark:text-blue-400">
                      This trip has <strong>{guestCount} guest{guestCount !== 1 ? 's' : ''}</strong> for <strong>{tripDays} day{tripDays !== 1 ? 's' : ''}</strong>. Suggested quantities have been scaled accordingly.
                    </p>
                  </div>
                )}
                <SmartSuggestionsPanel
                  suggestions={suggestions}
                  loading={suggestionsLoading}
                  onAdd={addSuggestions}
                  onAddAll={addSuggestions}
                />
              </>
            )}
          </div>
        )}

        {/* ── STEP 2: Build the List ───────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            {Object.entries(itemsByDept).map(([dept, deptItems]) => (
              <div key={dept} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-muted/50 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">{dept}</h3>
                  <button
                    onClick={() => addItem(dept)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Icon name="Plus" className="w-3.5 h-3.5" />
                    Add item
                  </button>
                </div>

                {deptItems.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">No items yet.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {deptItems.map(item => (
                      <ItemRow
                        key={item._id}
                        item={item}
                        dept={dept}
                        onChange={(field, val) => updateItem(item._id, field, val)}
                        onRemove={() => removeItem(item._id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            <button
              onClick={() => addItem()}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <Icon name="Plus" className="w-4 h-4" />
              Add item to any department
            </button>
          </div>
        )}

        {/* ── STEP 3: Review & Submit ──────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Summary</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{items.filter(i => i.name?.trim()).length}</p>
                  <p className="text-xs text-muted-foreground">Total items</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{details.department.length}</p>
                  <p className="text-xs text-muted-foreground">Departments</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {totalEstimated > 0 ? `$${Math.round(totalEstimated).toLocaleString()}` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">Est. total</p>
                </div>
              </div>
            </div>

            {Object.entries(itemsByDept).filter(([, deptItems]) => deptItems.some(i => i.name?.trim())).map(([dept, deptItems]) => {
              const validItems = deptItems.filter(i => i.name?.trim());
              if (!validItems.length) return null;
              return (
                <div key={dept} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-muted/50 border-b border-border">
                    <h4 className="text-sm font-semibold text-foreground">{dept}</h4>
                  </div>
                  <div className="divide-y divide-border/50">
                    {validItems.map(item => (
                      <div key={item._id} className="flex items-center gap-3 px-5 py-2.5">
                        <div className="flex-1">
                          <p className="text-sm text-foreground">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.category}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">{item.quantity_ordered} {item.unit}</p>
                        {item.estimated_unit_cost > 0 && (
                          <p className="text-sm text-foreground font-medium">
                            ${(item.quantity_ordered * item.estimated_unit_cost).toFixed(2)}
                          </p>
                        )}
                        {item.allergen_flags?.length > 0 && (
                          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded">⚠ Allergen</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Navigation / Actions */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : navigate('/provisioning')}
            className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            disabled={saving}
          >
            {step === 0 ? 'Cancel' : '← Back'}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave(PROVISIONING_STATUS.DRAFT)}
              disabled={saving}
              className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>

            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={() => handleSave(PROVISIONING_STATUS.PENDING_APPROVAL)}
                disabled={saving}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : 'Submit for Approval'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ── Item Row ──────────────────────────────────────────────────────────────────

const ItemRow = ({ item, dept, onChange, onRemove }) => {
  const categories = PROVISION_CATEGORIES[dept] || ['Other'];
  const [showAllergen, setShowAllergen] = useState(item.allergen_flags?.length > 0);

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="grid grid-cols-[1fr_120px_80px_90px_90px_32px] gap-2 items-start">
        <input
          value={item.name}
          onChange={e => onChange('name', e.target.value)}
          placeholder="Item name"
          className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={item.category}
          onChange={e => onChange('category', e.target.value)}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Category</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number"
          min="0"
          step="0.1"
          value={item.quantity_ordered}
          onChange={e => onChange('quantity_ordered', e.target.value)}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-center text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={item.unit}
          onChange={e => onChange('unit', e.target.value)}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {PROVISION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={item.estimated_unit_cost}
          onChange={e => onChange('estimated_unit_cost', e.target.value)}
          placeholder="$/unit"
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={onRemove} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors">
          <Icon name="X" className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowAllergen(p => !p)}
          className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${showAllergen || item.allergen_flags?.length ? 'text-red-600 bg-red-50 dark:bg-red-950/30' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon name="AlertTriangle" className="w-3 h-3" />
          Allergen flag
        </button>
        {showAllergen && (
          <input
            value={item.allergen_flags?.join(', ') || ''}
            onChange={e => onChange('allergen_flags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="nuts, dairy, gluten…"
            className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
        <input
          value={item.notes}
          onChange={e => onChange('notes', e.target.value)}
          placeholder="Notes…"
          className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
};

export default ProvisioningForm;
