import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  PROVISION_DEPARTMENTS,
} from './utils/provisioningStorage';

const EMPTY_FORM = { name: '', email: '', phone: '', port_location: '', department: '', notes: '' };

const ProvisioningSuppliers = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const canEdit = ['COMMAND', 'CHIEF'].includes(userTier);

  useEffect(() => {
    if (!activeTenantId) return;
    load();
  }, [activeTenantId]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchSuppliers(activeTenantId);
      setSuppliers(data);
    } catch (err) {
      setError('Could not load suppliers.');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (s) => { setEditingId(s.id); setForm({ name: s.name || '', email: s.email || '', phone: s.phone || '', port_location: s.port_location || '', department: s.department || '', notes: s.notes || '' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateSupplier(editingId, form);
        setSuppliers(prev => prev.map(s => s.id === editingId ? updated : s));
      } else {
        const created = await createSupplier({ ...form, tenant_id: activeTenantId });
        setSuppliers(prev => [...prev, created]);
      }
      setShowModal(false);
    } catch (err) {
      alert(`Failed to save supplier: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setDeletingId(id);
    try {
      await deleteSupplier(id);
      setSuppliers(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert('Failed to delete supplier.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/provisioning')} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <Icon name="ArrowLeft" className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Supplier Directory</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage provisioning suppliers for this vessel</p>
          </div>
          {canEdit && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Icon name="Plus" className="w-4 h-4" />
              Add Supplier
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : suppliers.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="Building2" className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No suppliers yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Add your first supplier to get started.</p>
            {canEdit && (
              <button onClick={openAdd} className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
                <Icon name="Plus" className="w-4 h-4" />Add Supplier
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suppliers.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{s.name}</h3>
                    {s.department && <span className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">{s.department}</span>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-muted rounded transition-colors">
                        <Icon name="Pencil" className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDelete(s.id, s.name)} disabled={deletingId === s.id} className="p-1.5 hover:bg-red-50 rounded transition-colors">
                        <Icon name="Trash2" className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  {s.email && (
                    <a href={`mailto:${s.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                      <Icon name="Mail" className="w-3.5 h-3.5" />{s.email}
                    </a>
                  )}
                  {s.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon name="Phone" className="w-3.5 h-3.5" />{s.phone}
                    </div>
                  )}
                  {s.port_location && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon name="MapPin" className="w-3.5 h-3.5" />{s.port_location}
                    </div>
                  )}
                  {s.notes && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{s.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">{editingId ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-muted rounded-lg"><Icon name="X" className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Name <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Phone</label>
                  <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Port / Location</label>
                  <input value={form.port_location} onChange={e => setForm(p => ({ ...p, port_location: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Department</label>
                  <select value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="">All departments</option>
                    {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={!form.name.trim() || saving} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editingId ? 'Update' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProvisioningSuppliers;
