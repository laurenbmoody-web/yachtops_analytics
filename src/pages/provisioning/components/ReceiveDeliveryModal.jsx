import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { supabase } from '../../../lib/supabaseClient';
import {
  receiveItems,
  findMatchingInventoryItem,
  pushReceivedQtyToLocation,
  createInventoryItemFromProvItem,
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

const deriveStatus = (qty, ordered) => {
  if (!qty || qty <= 0) return 'not_delivered';
  if (qty >= ordered) return 'received';
  return 'short_delivered';
};

const STATUS_PILL = {
  received:        { label: 'Received',       bg: '#ECFDF5', color: '#047857' },
  short_delivered: { label: 'Short',          bg: '#FEF3E2', color: '#B45309' },
  not_delivered:   { label: 'Not delivered',  bg: '#FEF2F2', color: '#DC2626' },
};

const ICON_BTN = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
  color: '#94A3B8', display: 'flex', alignItems: 'center',
};

// ── Step 1 ─ Receive checklist ────────────────────────────────────────────────

const ReceiveStep = ({ items, receiving, onChange, onReceiveAll, onNext, onClose, saving }) => {
  const pendingCount = items.filter(i => !receiving[i.id]?.checked).length;

  return (
    <>
      {/* Sub-header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 1 of 2</p>
          <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>Tick each item that arrived and enter the received quantity</p>
        </div>
        <button
          onClick={onReceiveAll}
          style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8', whiteSpace: 'nowrap' }}
        >
          Receive All
        </button>
      </div>

      {/* Item rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 56px', gap: 0, padding: '6px 20px', background: '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
          <div />
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>Item</p>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, textAlign: 'center' }}>Ordered</p>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, textAlign: 'center' }}>Received</p>
          <div />
        </div>

        {items.map(item => {
          const r = receiving[item.id] || { checked: false, qty: item.quantity_ordered || 0 };
          const ordered = parseFloat(item.quantity_ordered) || 0;
          const rcvQty = parseFloat(r.qty) || 0;
          const status = r.checked ? deriveStatus(rcvQty, ordered) : null;
          const pill = status ? STATUS_PILL[status] : null;
          const itemLabel = [item.name, item.brand, item.size].filter(Boolean).join(' · ');

          return (
            <div
              key={item.id}
              style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 56px', gap: 0,
                padding: '10px 20px', borderBottom: '1px solid #F8FAFC',
                background: r.checked ? '#FAFCFF' : 'white', alignItems: 'center',
                transition: 'background 0.1s',
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={!!r.checked}
                onChange={e => onChange(item.id, 'checked', e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#4A90E2', cursor: 'pointer', flexShrink: 0 }}
              />
              {/* Name */}
              <div style={{ minWidth: 0, paddingRight: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                {(item.brand || item.size) && (
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[item.brand, item.size].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {/* Ordered */}
              <p style={{ fontSize: 13, color: '#64748B', textAlign: 'center', margin: 0 }}>
                {ordered} <span style={{ fontSize: 10, color: '#CBD5E1' }}>{item.unit || ''}</span>
              </p>
              {/* Received qty input */}
              <input
                type="number"
                min="0"
                value={r.qty}
                disabled={!r.checked}
                onChange={e => onChange(item.id, 'qty', e.target.value)}
                style={{
                  width: '100%', textAlign: 'center', fontSize: 13, fontWeight: 600,
                  padding: '4px 6px', border: '1px solid',
                  borderColor: !r.checked ? '#F1F5F9' : rcvQty < ordered ? '#FCA5A5' : '#86EFAC',
                  borderRadius: 6, outline: 'none', background: r.checked ? 'white' : '#FAFAFA',
                  color: r.checked ? '#0F172A' : '#CBD5E1',
                }}
              />
              {/* Status pill */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {pill && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: pill.bg, color: pill.color, whiteSpace: 'nowrap' }}>
                    {pill.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#94A3B8' }}>No items on this board.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
          {items.filter(i => receiving[i.id]?.checked).length} of {items.length} items ticked
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
          >
            Cancel
          </button>
          <button
            onClick={onNext}
            disabled={saving || items.filter(i => receiving[i.id]?.checked).length === 0}
            style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: '#1E3A5F', border: '1px solid #1E3A5F', color: 'white', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save & Continue →'}
          </button>
        </div>
      </div>
    </>
  );
};

// ── Step 2 ─ Push to inventory ────────────────────────────────────────────────

const PushStep = ({ items, receiving, matches, locations, onLocationChange, onNewItemForm, newItemForms, onPush, onBack, pushing }) => {
  const receivedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);

  return (
    <>
      {/* Sub-header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #F1F5F9' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 2 of 2</p>
        <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>
          Confirm where each item goes in inventory. Matched items will have their stock updated.
        </p>
      </div>

      {/* Items */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
        {receivedItems.map(item => {
          const qty = parseFloat(receiving[item.id]?.qty) || 0;
          const match = matches[item.id];
          const isLoading = match === 'loading';
          const hasMatch = match && match !== 'loading';
          const loc = locations[item.id] || '';
          const newForm = newItemForms[item.id];

          return (
            <div key={item.id} style={{ padding: '12px 20px', borderBottom: '1px solid #F8FAFC' }}>
              {/* Item header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{item.name}</span>
                {(item.brand || item.size) && (
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>{[item.brand, item.size].filter(Boolean).join(' · ')}</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>
                  +{qty} {item.unit || ''}
                </span>
              </div>

              {/* Match status */}
              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94A3B8', fontSize: 12 }}>
                  <div style={{ width: 12, height: 12, border: '2px solid #CBD5E1', borderTopColor: '#4A90E2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Searching inventory…
                </div>
              ) : hasMatch ? (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Icon name="CheckCircle" style={{ width: 13, height: 13, color: '#16A34A' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>
                      Matched → {match.name}
                      {match.cargo_item_id && <span style={{ fontWeight: 400, color: '#86EFAC', marginLeft: 4 }}>({match.cargo_item_id})</span>}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
                      Current stock: {match.total_qty ?? 0}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: 11, color: '#64748B', flexShrink: 0 }}>Add to location:</label>
                    <input
                      value={loc}
                      onChange={e => onLocationChange(item.id, e.target.value)}
                      placeholder={match.stock_locations?.[0]?.locationName || match.location || 'e.g. Cellar > Red Wine'}
                      style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #BBF7D0', borderRadius: 6, outline: 'none', background: 'white', color: '#0F172A' }}
                    />
                  </div>
                </div>
              ) : (
                /* No match */
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Icon name="AlertCircle" style={{ width: 13, height: 13, color: '#EA580C' }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#C2410C' }}>No inventory match found</span>
                    {!newForm && (
                      <button
                        onClick={() => onNewItemForm(item.id, item)}
                        style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', background: '#FFF7ED', border: '1px solid #FED7AA', color: '#EA580C' }}
                      >
                        + Create new item
                      </button>
                    )}
                  </div>
                  {newForm && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>Brand</label>
                          <input
                            value={newForm.brand || ''}
                            onChange={e => onNewItemForm(item.id, { ...newForm, brand: e.target.value })}
                            placeholder="Brand"
                            style={{ width: '100%', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>Size</label>
                          <input
                            value={newForm.size || ''}
                            onChange={e => onNewItemForm(item.id, { ...newForm, size: e.target.value })}
                            placeholder="e.g. 750ml"
                            style={{ width: '100%', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: '#94A3B8', display: 'block', marginBottom: 2 }}>Inventory location (e.g. "Bar &gt; Spirits")</label>
                        <input
                          value={newForm.locationName || ''}
                          onChange={e => onNewItemForm(item.id, { ...newForm, locationName: e.target.value })}
                          placeholder="Bar > Spirits"
                          style={{ width: '100%', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {receivedItems.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#94A3B8' }}>No received items to push.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          onClick={onBack}
          style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          ← Back
        </button>
        <button
          onClick={onPush}
          disabled={pushing || receivedItems.length === 0}
          style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: '#15803D', border: '1px solid #15803D', color: 'white', opacity: pushing ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {pushing ? 'Pushing…' : `Push to Inventory (${receivedItems.length})`}
        </button>
      </div>
    </>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const ReceiveDeliveryModal = ({ list, items, tenantId, onClose, onComplete }) => {
  const { user } = useAuth();
  const userId = user?.id;

  const [step, setStep] = useState(1);
  const [receiving, setReceiving] = useState({});
  const [matches, setMatches] = useState({});          // {[id]: row | 'loading' | null}
  const [locations, setLocations] = useState({});      // {[id]: string}
  const [newItemForms, setNewItemForms] = useState({}); // {[id]: {brand, size, locationName}}
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);

  // Initialise receiving state from current item data
  useEffect(() => {
    const init = {};
    items.forEach(item => {
      const alreadyReceived = item.status === 'received' || item.status === 'short_delivered';
      init[item.id] = {
        checked: alreadyReceived,
        qty: item.quantity_received ?? item.quantity_ordered ?? 0,
      };
    });
    setReceiving(init);
  }, [items]);

  // When entering step 2, run matching for all checked items
  useEffect(() => {
    if (step !== 2) return;
    const checkedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);
    setMatches({});
    checkedItems.forEach(item => {
      setMatches(prev => ({ ...prev, [item.id]: 'loading' }));
      findMatchingInventoryItem(item, tenantId).then(match => {
        setMatches(prev => ({ ...prev, [item.id]: match || null }));
        if (match) {
          const defaultLoc = match.stock_locations?.[0]?.locationName
            || match.stock_locations?.[0]?.name
            || match.location
            || '';
          setLocations(prev => ({ ...prev, [item.id]: defaultLoc }));
        }
      });
    });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (id, field, value) => {
    setReceiving(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
        // Auto-fill qty when ticking a checkbox
        ...(field === 'checked' && value && { qty: items.find(i => i.id === id)?.quantity_ordered ?? 0 }),
      },
    }));
  };

  const handleReceiveAll = () => {
    const next = {};
    items.forEach(item => { next[item.id] = { checked: true, qty: item.quantity_ordered ?? 0 }; });
    setReceiving(next);
  };

  const handleSaveReceiving = async () => {
    setSaving(true);
    try {
      const updates = items.map(item => {
        const r = receiving[item.id] || {};
        const qty = r.checked ? Math.max(0, parseFloat(r.qty) || 0) : 0;
        const ordered = parseFloat(item.quantity_ordered) || 0;
        return {
          id: item.id,
          quantity_received: qty,
          status: deriveStatus(qty, ordered),
        };
      });
      await receiveItems(updates);
      setStep(2);
    } catch (err) {
      console.error('[ReceiveDeliveryModal] save error:', err);
      showToast('Failed to save receiving data', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleNewItemForm = (id, data) => {
    if (typeof data === 'object' && !data.name) {
      // initialise from provisioning item
      setNewItemForms(prev => ({
        ...prev,
        [id]: { brand: data.brand || '', size: data.size || '', locationName: '' },
      }));
    } else {
      setNewItemForms(prev => ({ ...prev, [id]: data }));
    }
  };

  const handlePushToInventory = async () => {
    setPushing(true);
    const receivedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);
    let pushed = 0, skipped = 0;

    for (const item of receivedItems) {
      const qty = parseFloat(receiving[item.id]?.qty) || 0;
      const match = matches[item.id];

      if (match && typeof match === 'object') {
        // Push qty to existing inventory item
        const locName = locations[item.id] || match.stock_locations?.[0]?.locationName || match.location || '';
        const ok = await pushReceivedQtyToLocation({ inventoryItemId: match.id, locationName: locName, qtyToAdd: qty, tenantId });
        if (ok) {
          // Link provisioning item to inventory item
          try {
            await supabase?.from('provisioning_items')?.update({ inventory_item_id: match.id })?.eq('id', item.id);
          } catch { /* non-fatal */ }
          pushed++;
        } else {
          skipped++;
        }
      } else {
        const form = newItemForms[item.id];
        if (form?.locationName) {
          const created = await createInventoryItemFromProvItem({
            provItem: { ...item, brand: form.brand || item.brand, size: form.size || item.size },
            locationName: form.locationName,
            qty,
            tenantId,
            userId,
          });
          if (created) pushed++;
          else skipped++;
        } else {
          skipped++; // No location given — user chose not to create
        }
      }
    }

    setPushing(false);
    if (pushed > 0) showToast(`${pushed} item${pushed > 1 ? 's' : ''} pushed to inventory`, 'success');
    if (skipped > 0) showToast(`${skipped} item${skipped > 1 ? 's' : ''} skipped (no location set)`, 'info');
    onComplete?.();
  };

  const checkedCount = items.filter(i => receiving[i.id]?.checked).length;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: 'white', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.18)', width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: 0 }}>Receive Delivery</h2>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '3px 0 0' }}>{list?.title}</p>
          </div>
          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto', marginLeft: 24 }}>
            {[1, 2].map(n => (
              <React.Fragment key={n}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: step === n ? '#1E3A5F' : step > n ? '#DCFCE7' : '#F1F5F9',
                  color: step === n ? 'white' : step > n ? '#15803D' : '#94A3B8',
                }}>
                  {step > n ? '✓' : n}
                </div>
                {n < 2 && <div style={{ width: 24, height: 2, background: step > n ? '#86EFAC' : '#F1F5F9', borderRadius: 1 }} />}
              </React.Fragment>
            ))}
          </div>
          <button onClick={onClose} style={{ ...ICON_BTN, marginLeft: 'auto' }}>
            <Icon name="X" style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Step content */}
        {step === 1 ? (
          <ReceiveStep
            items={items}
            receiving={receiving}
            onChange={handleChange}
            onReceiveAll={handleReceiveAll}
            onNext={handleSaveReceiving}
            onClose={onClose}
            saving={saving}
          />
        ) : (
          <PushStep
            items={items}
            receiving={receiving}
            matches={matches}
            locations={locations}
            onLocationChange={(id, val) => setLocations(prev => ({ ...prev, [id]: val }))}
            newItemForms={newItemForms}
            onNewItemForm={handleNewItemForm}
            onPush={handlePushToInventory}
            onBack={() => setStep(1)}
            pushing={pushing}
          />
        )}
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default ReceiveDeliveryModal;
