import React, { useState, useEffect, useRef } from 'react';
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
  fetchTemplates,
  fetchMasterOrderHistory,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
  PROVISION_UNITS,
  PROVISION_CATEGORIES,
} from './utils/provisioningStorage';
import { getSmartSuggestions } from '../../utils/provisioningSuggestions';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { getAllCategoriesL1, getCategoriesL2ByL1 } from '../inventory/utils/taxonomyStorage';

const STEPS = ['List Details', 'Smart Suggestions', 'Build List', 'Templates & History', 'Review & Submit'];

const emptyItem = () => ({
  _id: `new_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  name: '',
  brand: '',
  size: '',
  category: '',
  sub_category: '',
  department: '',
  quantity_ordered: 1,
  unit: 'each',
  estimated_unit_cost: '',
  allergen_flags: [],
  source: 'manual',
  notes: '',
  item_notes: '',
  status: 'pending',
});

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

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
    currency: 'GBP',
    order_by_date: '',
    is_private: false,
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

  // loadTrips is async post-A3.1 — IIFE + cancellation guard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = (await loadTrips()) || [];
        if (!cancelled) setTrips(t);
      } catch (err) {
        console.warn('[ProvisioningForm] loadTrips failed:', err);
        if (!cancelled) setTrips([]);
      }
    })();
    return () => { cancelled = true; };
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
            currency: list.currency || 'GBP',
            order_by_date: list.order_by_date || '',
            is_private: list.is_private || false,
          });
        }
        if (listItems?.length) {
          setItems(listItems.map(i => ({ ...i, _id: i.id, brand: i.brand || '', size: i.size || '', sub_category: i.sub_category || '', item_notes: i.item_notes || '' })));
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

  // Allergen cross-reference — actual checking happens via the
  // suggestions engine (utils/provisioningSuggestions.js). The
  // placeholder localStorage read here was dead code; removed during
  // the A3.2 sweep. If allergen surfacing comes back to this surface,
  // hydrate via the async helpers, not localStorage.
  const guestAllergens = React.useMemo(() => {
    if (!linkedTrip) return [];
    return [];
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
        department: s.department || '',
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
        tenant_id: activeTenantId,
        title: details.title.trim(),
        trip_id: details.trip_id || null,
        department: details.department.join(', '),
        port_location: details.port_location || null,
        supplier_id: details.supplier_id || null,
        notes: details.notes || null,
        estimated_cost: details.estimated_cost ? parseFloat(details.estimated_cost) : null,
        currency: details.currency || 'GBP',
        order_by_date: details.order_by_date || null,
        is_private: details.is_private || false,
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
          brand: i.brand || null,
          size: i.size || null,
          sub_category: i.sub_category || null,
          item_notes: i.item_notes || null,
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
                <label className="block text-xs font-medium text-foreground mb-1.5">Order By Date</label>
                <input
                  type="date"
                  value={details.order_by_date}
                  onChange={e => setDetails(p => ({ ...p, order_by_date: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Estimated Total Cost</label>
              <div className="flex gap-2">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, symbol]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setDetails(p => ({ ...p, currency: code }))}
                      className={`px-3 py-2 text-xs font-medium transition-colors ${details.currency === code ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                    >
                      {symbol} {code}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="0"
                  value={details.estimated_cost}
                  onChange={e => setDetails(p => ({ ...p, estimated_cost: e.target.value }))}
                  placeholder="0.00"
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

            <button
              type="button"
              role="switch"
              aria-checked={details.is_private}
              onClick={() => setDetails(p => ({ ...p, is_private: !p.is_private }))}
              className={`flex items-center justify-between w-full p-3 rounded-lg border transition-colors ${details.is_private ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700' : 'bg-muted border-border hover:bg-muted/80'}`}
            >
              <div className="flex items-center gap-2 text-left">
                <Icon name="Lock" className={`w-4 h-4 flex-shrink-0 ${details.is_private ? 'text-amber-500' : 'text-muted-foreground'}`} />
                <div>
                  <p className={`text-sm font-medium ${details.is_private ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>Private list</p>
                  <p className="text-xs text-muted-foreground">Only visible to you — you keep full edit and delete access</p>
                </div>
              </div>
              <div className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${details.is_private ? 'bg-amber-500' : 'bg-muted-foreground/30'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${details.is_private ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
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
                        onChange={(field, val) => updateItem(item._id, field, val)}
                        onRemove={() => removeItem(item._id)}
                        currencySymbol={CURRENCY_SYMBOLS[details.currency] || '£'}
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

        {/* ── STEP 3: Templates & History ──────────────────────────────────── */}
        {step === 3 && (
          <TemplatesHistoryStep
            activeTenantId={activeTenantId}
            items={items}
            setItems={setItems}
            setStep={setStep}
          />
        )}

        {/* ── STEP 4: Review & Submit ──────────────────────────────────────── */}
        {step === 4 && (
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

const FALLBACK_L1 = ['Dry Goods','Fresh Produce','Frozen','Dairy','Beverages','Cleaning & Laundry','Deck Stores','Engineering Supplies','Guest Amenities','Crew Supplies'];

const ItemRow = ({ item, onChange, onRemove, currencySymbol }) => {
  const [showAllergen, setShowAllergen] = useState(item.allergen_flags?.length > 0);
  const [showNotes, setShowNotes] = useState(!!item.item_notes);
  const [customL1, setCustomL1] = useState('');
  const [customL2, setCustomL2] = useState('');
  const [showCustomL1, setShowCustomL1] = useState(false);
  const [showCustomL2, setShowCustomL2] = useState(false);
  const [sessionL1, setSessionL1] = useState([]);
  const [sessionL2, setSessionL2] = useState([]);

  const l1List = [...(getAllCategoriesL1() || []).map(c => c.name), ...sessionL1];
  const hasTaxL1 = l1List.length > 0;
  const topCategories = hasTaxL1 ? l1List : FALLBACK_L1;

  const selectedL1 = getAllCategoriesL1()?.find(c => c.name === item.category);
  const l2Raw = selectedL1 ? (getCategoriesL2ByL1(selectedL1.id) || []).map(c => c.name) : [];
  const l2List = [...l2Raw, ...sessionL2];

  const handleL1Change = (val) => {
    if (val === '__custom__') { setShowCustomL1(true); return; }
    onChange('category', val);
    onChange('sub_category', '');
  };

  const handleL2Change = (val) => {
    if (val === '__custom__') { setShowCustomL2(true); return; }
    onChange('sub_category', val);
  };

  const addCustomL1 = () => {
    if (!customL1.trim()) return;
    setSessionL1(p => [...p, customL1.trim()]);
    onChange('category', customL1.trim());
    onChange('sub_category', '');
    setCustomL1(''); setShowCustomL1(false);
  };

  const addCustomL2 = () => {
    if (!customL2.trim()) return;
    setSessionL2(p => [...p, customL2.trim()]);
    onChange('sub_category', customL2.trim());
    setCustomL2(''); setShowCustomL2(false);
  };

  return (
    <div className="px-5 py-3 space-y-2">
      {/* Row 1: name, brand, size, dept, qty, unit, cost, remove */}
      <div className="grid grid-cols-[1fr_100px_80px_110px_70px_90px_90px_32px] gap-2 items-start">
        <input
          value={item.name}
          onChange={e => onChange('name', e.target.value)}
          placeholder="Item name"
          className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          value={item.brand || ''}
          onChange={e => onChange('brand', e.target.value)}
          placeholder="Brand"
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <input
          value={item.size || ''}
          onChange={e => onChange('size', e.target.value)}
          placeholder="Size"
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={item.department}
          onChange={e => onChange('department', e.target.value)}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          type="number" min="0" step="0.1"
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
          type="number" min="0" step="0.01"
          value={item.estimated_unit_cost}
          onChange={e => onChange('estimated_unit_cost', e.target.value)}
          placeholder={`${currencySymbol || '$'}/unit`}
          className="bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={onRemove} className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors">
          <Icon name="X" className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: L1 category, L2 sub-category */}
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          {showCustomL1 ? (
            <div className="flex gap-1">
              <input autoFocus value={customL1} onChange={e => setCustomL1(e.target.value)} placeholder="Custom category" onKeyDown={e => e.key === 'Enter' && addCustomL1()} className="flex-1 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={addCustomL1} className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-lg">Add</button>
              <button onClick={() => setShowCustomL1(false)} className="text-xs px-2 py-1 text-muted-foreground">✕</button>
            </div>
          ) : (
            <select value={item.category || ''} onChange={e => handleL1Change(e.target.value)} className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Category</option>
              {topCategories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">Add custom…</option>
            </select>
          )}
        </div>
        {item.category && (
          <div className="flex-1">
            {showCustomL2 ? (
              <div className="flex gap-1">
                <input autoFocus value={customL2} onChange={e => setCustomL2(e.target.value)} placeholder="Custom sub-category" onKeyDown={e => e.key === 'Enter' && addCustomL2()} className="flex-1 bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                <button onClick={addCustomL2} className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-lg">Add</button>
                <button onClick={() => setShowCustomL2(false)} className="text-xs px-2 py-1 text-muted-foreground">✕</button>
              </div>
            ) : l2List.length > 0 ? (
              <select value={item.sub_category || ''} onChange={e => handleL2Change(e.target.value)} className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">Sub-category</option>
                {l2List.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__custom__">Add custom…</option>
              </select>
            ) : (
              <button onClick={() => setShowCustomL2(true)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-dashed border-border rounded-lg w-full text-left">+ Sub-category</button>
            )}
          </div>
        )}
      </div>

      {/* Row 3: allergen + notes icon + item_notes */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowAllergen(p => !p)}
          className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${showAllergen || item.allergen_flags?.length ? 'text-red-600 bg-red-50 dark:bg-red-950/30' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon name="AlertTriangle" className="w-3 h-3" />
          Allergen
        </button>
        {showAllergen && (
          <input
            value={item.allergen_flags?.join(', ') || ''}
            onChange={e => onChange('allergen_flags', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="nuts, dairy, gluten…"
            className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
        <button
          onClick={() => setShowNotes(p => !p)}
          className={`p-1 rounded transition-colors ${showNotes || item.item_notes ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title="Item note"
        >
          <Icon name="StickyNote" className="w-3.5 h-3.5" />
        </button>
        {showNotes && (
          <input
            value={item.item_notes || ''}
            onChange={e => onChange('item_notes', e.target.value)}
            placeholder="Item note e.g. check expiry, specific brand only"
            className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        )}
      </div>
    </div>
  );
};

// ── Templates & History Step ──────────────────────────────────────────────────

const TemplatesHistoryStep = ({ activeTenantId, items, setItems, setStep }) => {
  const [subTab, setSubTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  const [previewItems, setPreviewItems] = useState([]);
  const [checked, setChecked] = useState(new Set());
  const [historySearch, setHistorySearch] = useState('');
  const [historyDept, setHistoryDept] = useState('all');
  const [openPopover, setOpenPopover] = useState(null);

  useEffect(() => {
    if (!activeTenantId) return;
    setLoadingTemplates(true);
    fetchTemplates(activeTenantId).then(setTemplates).finally(() => setLoadingTemplates(false));
    setLoadingHistory(true);
    fetchMasterOrderHistory(activeTenantId).then(setHistory).finally(() => setLoadingHistory(false));
  }, [activeTenantId]);

  const handleUseTemplate = async (template) => {
    const tItems = await fetchListItems(template.id);
    const mapped = (tItems || []).map(i => ({
      ...emptyItem(),
      name: i.name || '',
      brand: i.brand || '',
      size: i.size || '',
      category: i.category || '',
      sub_category: i.sub_category || '',
      department: i.department || 'Galley',
      quantity_ordered: i.quantity_ordered || 1,
      unit: i.unit || 'each',
      estimated_unit_cost: i.estimated_unit_cost || '',
      allergen_flags: i.allergen_flags || [],
      item_notes: i.item_notes || '',
      notes: i.notes || '',
      source: 'template',
    }));
    setItems(prev => [...prev, ...mapped]);
    setStep(2);
  };

  const handlePreview = async (template) => {
    if (previewId === template.id) { setPreviewId(null); return; }
    const tItems = await fetchListItems(template.id);
    setPreviewItems(tItems || []);
    setPreviewId(template.id);
  };

  // History filtering
  const filteredHistory = history.filter(h => {
    if (historyDept !== 'all' && h.department !== historyDept) return false;
    if (historySearch) {
      const q = historySearch.toLowerCase();
      return (h.name||'').toLowerCase().includes(q) || (h.brand||'').toLowerCase().includes(q) || (h.category||'').toLowerCase().includes(q);
    }
    return true;
  });

  // Group by dept → category
  const grouped = filteredHistory.reduce((acc, h) => {
    const dept = h.department || 'Other';
    const cat = h.category || 'Uncategorised';
    if (!acc[dept]) acc[dept] = {};
    if (!acc[dept][cat]) acc[dept][cat] = [];
    acc[dept][cat].push(h);
    return acc;
  }, {});

  const deptList = [...new Set(history.map(h => h.department || 'Other'))].sort();

  const toggleChecked = (key) => setChecked(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleDeptAll = (dept) => {
    const deptItems = filteredHistory.filter(h => (h.department||'Other') === dept);
    const keys = deptItems.map(h => `${h.name}|${h.brand}|${h.size}`);
    const allChecked = keys.every(k => checked.has(k));
    setChecked(prev => {
      const n = new Set(prev);
      keys.forEach(k => allChecked ? n.delete(k) : n.add(k));
      return n;
    });
  };

  const handleAddSelected = () => {
    const selected = filteredHistory.filter(h => checked.has(`${h.name}|${h.brand}|${h.size}`));
    const mapped = selected.map(h => ({
      ...emptyItem(),
      name: h.name,
      brand: h.brand || '',
      size: h.size || '',
      category: h.category || '',
      sub_category: h.sub_category || '',
      department: h.department || 'Galley',
      unit: h.unit || 'each',
      quantity_ordered: '',
      source: 'history',
    }));
    setItems(prev => [...prev, ...mapped]);
    setChecked(new Set());
    setStep(2);
  };

  const inputCls = 'bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {[['templates','Saved Templates'],['history','Master Order History']].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)} className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${subTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      {subTab === 'templates' && (
        <>
          {loadingTemplates ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-20" />)}</div>
          ) : templates.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <Icon name="BookTemplate" className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No templates saved yet. Save a list as a template from its detail view.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => {
                const depts = t.department ? t.department.split(',').map(d => d.trim()).filter(Boolean) : [];
                const lastUsed = t.updated_at ? new Date(t.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                return (
                  <div key={t.id} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm">{t.title}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {depts.map(d => <span key={d} className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">{d}</span>)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{t.item_count ?? '?'} items · Last used {lastUsed}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handlePreview(t)} className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                          {previewId === t.id ? 'Hide' : 'Preview'}
                        </button>
                        <button onClick={() => handleUseTemplate(t)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                          Use template
                        </button>
                      </div>
                    </div>
                    {previewId === t.id && (
                      <div className="mt-3 pt-3 border-t border-border space-y-1">
                        {previewItems.map((i, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="text-foreground">{i.name}</span>
                            <span>·</span>
                            <span>{i.quantity_ordered} {i.unit}</span>
                            {i.brand && <span className="text-slate-500">{i.brand}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {subTab === 'history' && (
        <>
          <div className="flex gap-2">
            <input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="Search items, brands, categories…" className={`flex-1 ${inputCls}`} />
            <select value={historyDept} onChange={e => setHistoryDept(e.target.value)} className={inputCls}>
              <option value="all">All departments</option>
              {deptList.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {loadingHistory ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse h-12" />)}</div>
          ) : filteredHistory.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <Icon name="History" className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{history.length === 0 ? 'Your master order history will build automatically as deliveries are logged. Start by creating and delivering your first provisioning list.' : 'No items match your search.'}</p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {Object.entries(grouped).map(([dept, cats]) => {
                  const deptItems = filteredHistory.filter(h => (h.department||'Other') === dept);
                  const deptKeys = deptItems.map(h => `${h.name}|${h.brand}|${h.size}`);
                  const allDeptChecked = deptKeys.length > 0 && deptKeys.every(k => checked.has(k));
                  return (
                    <div key={dept} className="bg-card border border-border rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 border-b border-border">
                        <input type="checkbox" checked={allDeptChecked} onChange={() => toggleDeptAll(dept)} className="rounded border-border" />
                        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{dept}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{deptItems.length} items</span>
                      </div>
                      {Object.entries(cats).map(([cat, catItems]) => (
                        <div key={cat}>
                          <div className="px-4 py-1.5 bg-muted/20 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">{cat}</span>
                          </div>
                          {catItems.map(h => {
                            const key = `${h.name}|${h.brand}|${h.size}`;
                            const daysAgo = h.last_ordered_date ? Math.round((Date.now() - new Date(h.last_ordered_date)) / 86400000) : null;
                            return (
                              <div key={key} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-muted/20 transition-colors">
                                <input type="checkbox" checked={checked.has(key)} onChange={() => toggleChecked(key)} className="rounded border-border" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm text-foreground">{h.name}</span>
                                    {h.brand && <span className="text-xs text-muted-foreground">{h.brand}</span>}
                                    {h.size && <span className="text-xs text-muted-foreground">{h.size}</span>}
                                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{dept}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{cat}</p>
                                </div>
                                <span className="text-xs text-muted-foreground shrink-0">×{h.times_ordered}</span>
                                {daysAgo != null && <span className="text-xs text-muted-foreground shrink-0">{daysAgo}d ago</span>}
                                <div className="relative">
                                  <button onClick={() => setOpenPopover(openPopover === key ? null : key)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                                    <Icon name="Info" className="w-3.5 h-3.5" />
                                  </button>
                                  {openPopover === key && (
                                    <div className="absolute right-0 bottom-7 z-20 bg-card border border-border rounded-lg p-3 shadow-lg text-xs space-y-1 w-44">
                                      <p className="text-muted-foreground">Last ordered: <span className="text-foreground font-medium">{h.last_quantity != null ? `${h.last_quantity} ${h.unit}` : '—'}</span></p>
                                      <p className="text-muted-foreground">Average: <span className="text-foreground font-medium">{h.avg_quantity != null ? `${h.avg_quantity} ${h.unit}` : '—'}</span></p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {checked.size > 0 && (
                <div className="sticky bottom-0 bg-background/90 backdrop-blur border-t border-border pt-3 pb-1">
                  <button onClick={handleAddSelected} className="w-full py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
                    Add {checked.size} selected item{checked.size !== 1 ? 's' : ''} to list
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ProvisioningForm;
