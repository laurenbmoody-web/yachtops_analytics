import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import StatusBadge, { ITEM_STATUS_CONFIG } from './components/StatusBadge';
import DeliveryModal from './components/DeliveryModal';
import {
  fetchProvisioningList,
  fetchListItems,
  fetchSuppliers,
  updateProvisioningList,
  deleteProvisioningList,
  PROVISIONING_STATUS,
  formatCurrency,
} from './utils/provisioningStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';

const ProvisioningDetail = () => {
  const navigate = useNavigate();
  const { listId } = useParams();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [supplier, setSupplier] = useState(null);
  const [tripName, setTripName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showDelivery, setShowDelivery] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const userTier = (tenantRole || '').toUpperCase();
  const isCommandChief = ['COMMAND', 'CHIEF'].includes(userTier);
  const isCommand = userTier === 'COMMAND';

  useEffect(() => {
    if (!listId || !activeTenantId) return;
    loadData();
  }, [listId, activeTenantId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [listData, listItems, suppliers] = await Promise.all([
        fetchProvisioningList(listId),
        fetchListItems(listId),
        fetchSuppliers(activeTenantId),
      ]);
      setList(listData);
      setItems(listItems);

      if (listData?.supplier_id) {
        const s = suppliers.find(x => x.id === listData.supplier_id);
        setSupplier(s || null);
      }

      if (listData?.trip_id) {
        const trips = loadTrips() || [];
        const trip = trips.find(t => t.id === listData.trip_id);
        setTripName(trip?.name || trip?.title || '');
      }
    } catch (err) {
      setError('Could not load list.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    setActionLoading(true);
    try {
      await updateProvisioningList(listId, { status: newStatus });
      setList(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${list?.title}"? This cannot be undone.`)) return;
    try {
      await deleteProvisioningList(listId);
      navigate('/provisioning');
    } catch (err) {
      alert('Failed to delete list.');
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (error || !list) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <p className="text-muted-foreground mb-3">{error || 'List not found.'}</p>
            <button onClick={() => navigate('/provisioning')} className="text-sm text-primary hover:underline">Back to provisioning</button>
          </div>
        </div>
      </>
    );
  }

  // Group items by department then category
  const groupedItems = items.reduce((acc, item) => {
    const dept = item.department || 'Other';
    const cat = item.category || 'Other';
    if (!acc[dept]) acc[dept] = {};
    if (!acc[dept][cat]) acc[dept][cat] = [];
    acc[dept][cat].push(item);
    return acc;
  }, {});

  const totalEstimated = items.reduce((s, i) => s + (i.quantity_ordered || 0) * (i.estimated_unit_cost || 0), 0);
  const totalActual = items.reduce((s, i) => s + (i.quantity_received || 0) * (i.estimated_unit_cost || 0), 0);
  const outstanding = items.filter(i => i.status !== 'received').length;
  const hasDiscrepancies = items.some(i => ['short_delivered', 'not_delivered'].includes(i.status));

  const depts = list.department ? list.department.split(',').map(d => d.trim()).filter(Boolean) : [];
  const createdDate = list.created_at ? new Date(list.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <>
      <Header />
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back */}
        <button onClick={() => navigate('/provisioning')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
          <Icon name="ArrowLeft" className="w-4 h-4" />
          Back to provisioning
        </button>

        {/* Header card */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{list.title}</h1>
                <StatusBadge status={list.status} size="md" />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                {tripName && <span className="flex items-center gap-1"><Icon name="Map" className="w-3 h-3" />{tripName}</span>}
                {supplier && <span className="flex items-center gap-1"><Icon name="Building2" className="w-3 h-3" />{supplier.name}</span>}
                {list.port_location && <span className="flex items-center gap-1"><Icon name="MapPin" className="w-3 h-3" />{list.port_location}</span>}
                <span>{createdDate}</span>
              </div>
              {depts.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {depts.map(d => <span key={d} className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">{d}</span>)}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {list.status === PROVISIONING_STATUS.DRAFT && isCommandChief && (
                <>
                  <button onClick={() => navigate(`/provisioning/${listId}/edit`)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors">Edit</button>
                  <button onClick={() => handleStatusChange(PROVISIONING_STATUS.PENDING_APPROVAL)} disabled={actionLoading} className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50">Submit for Approval</button>
                  <button onClick={handleDelete} className="px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">Delete</button>
                </>
              )}
              {list.status === PROVISIONING_STATUS.PENDING_APPROVAL && (
                <>
                  {isCommand && (
                    <button onClick={() => handleStatusChange(PROVISIONING_STATUS.SENT_TO_SUPPLIER)} disabled={actionLoading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">Approve & Send</button>
                  )}
                  {isCommandChief && (
                    <button onClick={() => handleStatusChange(PROVISIONING_STATUS.DRAFT)} disabled={actionLoading} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">Request Changes</button>
                  )}
                  {isCommandChief && (
                    <button onClick={() => navigate(`/provisioning/${listId}/edit`)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors">Edit</button>
                  )}
                </>
              )}
              {list.status === PROVISIONING_STATUS.SENT_TO_SUPPLIER && isCommandChief && (
                <>
                  <button onClick={() => setShowDelivery(true)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">Log Delivery</button>
                  <button onClick={() => navigate(`/provisioning/${listId}/edit`)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors">Edit</button>
                  <button onClick={() => navigate(`/provisioning/new?duplicate=${listId}`)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors">Duplicate</button>
                </>
              )}
              {[PROVISIONING_STATUS.PARTIALLY_DELIVERED, PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES].includes(list.status) && isCommandChief && (
                <>
                  <button onClick={() => setShowDelivery(true)} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">Log Another Delivery</button>
                </>
              )}
              {list.status === PROVISIONING_STATUS.DELIVERED && (
                <>
                  <button onClick={() => navigate(`/provisioning/new?duplicate=${listId}`)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors">Duplicate</button>
                </>
              )}
            </div>
          </div>

          {/* Sharing bar */}
          <div className="flex items-center gap-2 pt-4 border-t border-border">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">
              <Icon name="Download" className="w-3.5 h-3.5" />PDF Export
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">
              <Icon name="Printer" className="w-3.5 h-3.5" />Print
            </button>
            {supplier?.email && (
              <button
                onClick={() => window.location.href = `mailto:${supplier.email}?subject=Provisioning Order: ${encodeURIComponent(list.title)}&body=Please find the attached provisioning order.`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                <Icon name="Mail" className="w-3.5 h-3.5" />Email Supplier
              </button>
            )}
            {hasDiscrepancies && (
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors">
                <Icon name="AlertTriangle" className="w-3.5 h-3.5" />Email Discrepancy Report
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* Main content */}
          <div className="space-y-4">
            {items.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-sm text-muted-foreground">No items added yet.</p>
                {isCommandChief && (
                  <button onClick={() => navigate(`/provisioning/${listId}/edit`)} className="text-xs text-primary hover:underline mt-2">Edit list to add items</button>
                )}
              </div>
            ) : (
              Object.entries(groupedItems).map(([dept, categories]) => (
                <div key={dept} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 bg-muted/50 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">{dept}</h3>
                  </div>
                  {Object.entries(categories).map(([cat, catItems]) => (
                    <div key={cat}>
                      <div className="px-5 py-2 bg-muted/20 border-b border-border/50">
                        <p className="text-xs font-medium text-muted-foreground">{cat}</p>
                      </div>
                      <div className="divide-y divide-border/50">
                        {catItems.map(item => {
                          const statusCfg = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.pending;
                          return (
                            <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.dot}`} title={statusCfg.label} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground">{item.name}</p>
                                {item.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.notes}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm text-foreground">
                                  {item.quantity_received != null ? (
                                    <span>{item.quantity_received} <span className="text-muted-foreground">/ {item.quantity_ordered}</span></span>
                                  ) : (
                                    item.quantity_ordered
                                  )} {item.unit}
                                </p>
                                {item.estimated_unit_cost > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    {formatCurrency(item.quantity_ordered * item.estimated_unit_cost)}
                                  </p>
                                )}
                              </div>
                              {item.allergen_flags?.length > 0 && (
                                <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded shrink-0" title={item.allergen_flags.join(', ')}>⚠</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Summary panel */}
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Summary</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total items</span>
                  <span className="text-foreground font-medium">{items.length}</span>
                </div>
                {outstanding > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Outstanding</span>
                    <span className="text-amber-600 font-medium">{outstanding}</span>
                  </div>
                )}
                {totalEstimated > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Est. cost</span>
                    <span className="text-foreground font-medium">{formatCurrency(totalEstimated)}</span>
                  </div>
                )}
                {totalActual > 0 && (
                  <div className="flex justify-between text-sm border-t border-border pt-2 mt-2">
                    <span className="text-muted-foreground">Actual cost</span>
                    <span className="text-foreground font-medium">{formatCurrency(totalActual)}</span>
                  </div>
                )}
              </div>
            </div>

            {list.notes && (
              <div className="bg-card border border-border rounded-xl p-5">
                <h3 className="text-xs font-semibold text-foreground mb-2">Notes</h3>
                <p className="text-sm text-muted-foreground">{list.notes}</p>
              </div>
            )}

            {hasDiscrepancies && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600" />
                  <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-400">Discrepancies</h3>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {items.filter(i => ['short_delivered', 'not_delivered'].includes(i.status)).length} item(s) not fully delivered.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showDelivery && (
        <DeliveryModal
          list={list}
          items={items}
          onClose={() => setShowDelivery(false)}
          onComplete={() => { setShowDelivery(false); loadData(); }}
        />
      )}
    </>
  );
};

export default ProvisioningDetail;
