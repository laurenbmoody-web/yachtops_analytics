import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import TransferAdminModal from './TransferAdminModal';

import { PermissionTier, getTierDisplayName, hasCommandAccess, getCurrentUser } from '../../../utils/authStorage';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';

// Roles live in two tables:
//   public.roles               — app-wide catalog, read-only here, source='global'
//   public.tenant_custom_roles — this tenant's custom roles, CRUD here, source='custom'
// Both are keyed by department_id → public.departments(id).
// This component is embedded inside vessel-settings (which owns the page chrome
// — Header, min-h-screen wrapper, etc.). It deliberately renders no layout of
// its own so vessel-settings doesn't get a duplicate navbar.

const RoleManagement = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const [currentUser, setCurrentUser] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [isVesselAdmin, setIsVesselAdmin] = useState(false);
  const [currentAdminProfile, setCurrentAdminProfile] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    department_id: '',
    default_permission_tier: '',
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Auth / authz — ProtectedRoute handles redirect; this is just belt-and-braces.
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) return;
    if (!hasCommandAccess(u)) {
      navigate('/dashboard');
      return;
    }
    setCurrentUser(u);
  }, [navigate]);

  // Load departments + roles (global + this tenant's custom) from the DB.
  const loadData = async () => {
    if (!activeTenantId) return;
    setLoadingRoles(true);
    try {
      const [{ data: deptsData }, { data: globalData }, { data: customData }] = await Promise.all([
        supabase.from('departments').select('id, name').order('name', { ascending: true }),
        supabase.from('roles').select('id, name, department_id, default_permission_tier').order('name', { ascending: true }),
        supabase
          .from('tenant_custom_roles')
          .select('id, name, department_id, default_permission_tier, created_by')
          .eq('tenant_id', activeTenantId)
          .order('name', { ascending: true }),
      ]);
      setDepartments(deptsData || []);
      setRoles([
        ...((globalData || []).map(r => ({ ...r, source: 'global' }))),
        ...((customData || []).map(r => ({ ...r, source: 'custom' }))),
      ]);
    } catch (err) {
      console.error('[RoleManagement] loadData failed', err);
    } finally {
      setLoadingRoles(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId]);

  // Vessel admin lookup (unchanged from prior version).
  useEffect(() => {
    if (user?.id) checkVesselAdminStatus();
  }, [user]);

  const checkVesselAdminStatus = async () => {
    try {
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('last_active_tenant_id')
        ?.eq('id', user?.id)
        ?.single();
      if (profileError) throw profileError;
      const tenantId = profile?.last_active_tenant_id;
      if (!tenantId) return;
      const { data: tenant, error: tenantError } = await supabase
        ?.from('tenants')
        ?.select(`
          current_admin_user_id,
          current_admin:current_admin_user_id (
            id,
            full_name,
            email
          )
        `)
        ?.eq('id', tenantId)
        ?.single();
      if (tenantError) throw tenantError;
      setIsVesselAdmin(tenant?.current_admin_user_id === user?.id);
      setCurrentAdminProfile(tenant?.current_admin || null);
    } catch (err) {
      console.error('Error checking vessel admin status:', err);
    }
  };

  const handleTransferSuccess = () => checkVesselAdminStatus();

  const departmentLookup = useMemo(
    () => Object.fromEntries((departments || []).map(d => [d?.id, d?.name])),
    [departments]
  );

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddClick = () => {
    setFormData({ name: '', department_id: '', default_permission_tier: '' });
    setFormError('');
    setEditingRole(null);
    setShowAddModal(true);
  };

  const handleEditClick = (role) => {
    if (role?.source !== 'custom') return; // global roles are read-only here
    setFormData({
      name: role?.name || '',
      department_id: role?.department_id || '',
      default_permission_tier: role?.default_permission_tier || '',
    });
    setFormError('');
    setEditingRole(role);
    setShowAddModal(true);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setFormError('');

    if (!formData?.name?.trim()) return setFormError('Role name is required');
    if (!formData?.department_id) return setFormError('Department is required');
    if (!formData?.default_permission_tier) return setFormError('Permission tier is required');
    if (!activeTenantId) return setFormError('No active tenant');

    setSaving(true);
    try {
      if (editingRole) {
        const { error } = await supabase
          .from('tenant_custom_roles')
          .update({
            name: formData.name.trim(),
            department_id: formData.department_id,
            default_permission_tier: formData.default_permission_tier,
          })
          .eq('id', editingRole.id)
          .eq('tenant_id', activeTenantId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tenant_custom_roles')
          .insert({
            tenant_id: activeTenantId,
            department_id: formData.department_id,
            name: formData.name.trim(),
            default_permission_tier: formData.default_permission_tier,
            created_by: user?.id,
          });
        if (error) {
          if (error.code === '23505') {
            throw new Error('A role with this name already exists in this department');
          }
          throw error;
        }
      }
      await loadData();
      setShowAddModal(false);
    } catch (err) {
      setFormError(err?.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  // Filter + sort
  const filteredRoles = (roles || []).filter(role => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = role?.name?.toLowerCase() || '';
    const dept = (departmentLookup[role?.department_id] || '').toLowerCase();
    const tier = (getTierDisplayName(role?.default_permission_tier) || '').toLowerCase();
    return name.includes(q) || dept.includes(q) || tier.includes(q);
  });

  const handleSort = (key) => {
    let direction = 'asc';
    let newKey = key;
    if (sortConfig?.key === key && sortConfig?.direction === 'asc') direction = 'desc';
    else if (sortConfig?.key === key && sortConfig?.direction === 'desc') { direction = null; newKey = null; }
    setSortConfig({ key: newKey, direction });
  };

  const sortedRoles = [...filteredRoles].sort((a, b) => {
    // Default sort: department, then name
    if (!sortConfig?.key || !sortConfig?.direction) {
      const deptA = (departmentLookup[a?.department_id] || '').toLowerCase();
      const deptB = (departmentLookup[b?.department_id] || '').toLowerCase();
      if (deptA !== deptB) return deptA.localeCompare(deptB);
      return (a?.name || '').localeCompare(b?.name || '');
    }
    let aValue, bValue;
    if (sortConfig?.key === 'name') {
      aValue = a?.name?.toLowerCase() || '';
      bValue = b?.name?.toLowerCase() || '';
    } else if (sortConfig?.key === 'department') {
      aValue = (departmentLookup[a?.department_id] || '').toLowerCase();
      bValue = (departmentLookup[b?.department_id] || '').toLowerCase();
    } else if (sortConfig?.key === 'tier') {
      aValue = (getTierDisplayName(a?.default_permission_tier) || '').toLowerCase();
      bValue = (getTierDisplayName(b?.default_permission_tier) || '').toLowerCase();
    }
    if (aValue < bValue) return sortConfig?.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig?.direction === 'asc' ? 1 : -1;
    return 0;
  });

  if (!currentUser) return null;

  const departmentOptions = (departments || []).map(d => ({ label: d?.name, value: d?.id }));
  const tierOptions = Object.values(PermissionTier).map(t => ({ label: getTierDisplayName(t), value: t }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground mb-1">Role Management</h1>
          <p className="text-sm text-muted-foreground">Global roles plus any custom roles created for this vessel</p>
        </div>
        <Button onClick={handleAddClick} disabled={!activeTenantId}>
          <Icon name="Plus" size={18} />
          Add Role
        </Button>
      </div>

        {currentAdminProfile && (
          <div className="bg-card border border-border rounded-2xl p-6 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-foreground mb-2">Vessel Admin</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  The vessel admin is responsible for invites, billing, and vessel-level settings. Permission tier (COMMAND, CHIEF, HOD, CREW) is separate from admin status.
                </p>
                <div className="flex items-center gap-3">
                  <Icon name="Shield" size={16} className="text-red-600" />
                  <span className="text-sm font-medium text-foreground">{currentAdminProfile?.full_name}</span>
                  <span className="text-xs text-muted-foreground">({currentAdminProfile?.email})</span>
                  {isVesselAdmin && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">You</span>
                  )}
                </div>
              </div>
              {isVesselAdmin && (
                <Button size="sm" variant="outline" onClick={() => setShowTransferModal(true)}>
                  <Icon name="UserCheck" size={16} />
                  Transfer Admin
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-4 mb-6">
          <Input
            placeholder="Search roles by name, department, or tier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e?.target?.value)}
            icon="Search"
          />
        </div>

        <div className="space-y-6">
          {loadingRoles ? (
            <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground">
              Loading roles…
            </div>
          ) : sortedRoles?.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-8 text-center">
              <Icon name="Users" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No roles found</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/10 border-b border-border">
                    <tr>
                      <th
                        className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/20 transition-smooth"
                        onClick={() => handleSort('name')}
                      >
                        <div className="flex items-center gap-2">
                          Role Name
                          <div className="flex flex-col">
                            <Icon name="ChevronUp" size={12} className={sortConfig?.key === 'name' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'} />
                            <Icon name="ChevronDown" size={12} className={sortConfig?.key === 'name' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/20 transition-smooth"
                        onClick={() => handleSort('department')}
                      >
                        <div className="flex items-center gap-2">
                          Department
                          <div className="flex flex-col">
                            <Icon name="ChevronUp" size={12} className={sortConfig?.key === 'department' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'} />
                            <Icon name="ChevronDown" size={12} className={sortConfig?.key === 'department' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'} />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/20 transition-smooth"
                        onClick={() => handleSort('tier')}
                      >
                        <div className="flex items-center gap-2">
                          Permission Tier
                          <div className="flex flex-col">
                            <Icon name="ChevronUp" size={12} className={sortConfig?.key === 'tier' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'} />
                            <Icon name="ChevronDown" size={12} className={sortConfig?.key === 'tier' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'} />
                          </div>
                        </div>
                      </th>
                      <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRoles.map(role => {
                      const isCustom = role?.source === 'custom';
                      return (
                        <tr key={role?.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                          <td className="p-4">
                            <span className="text-sm font-medium text-foreground">{role?.name}</span>
                          </td>
                          <td className="p-4">
                            <span className="text-sm text-foreground">{departmentLookup[role?.department_id] || '—'}</span>
                          </td>
                          <td className="p-4">
                            <span className={`text-sm font-medium ${
                              role?.default_permission_tier === 'COMMAND' ? 'text-red-600' :
                              role?.default_permission_tier === 'CHIEF' ? 'text-blue-600' :
                              role?.default_permission_tier === 'HOD' ? 'text-amber-600' :
                              role?.default_permission_tier === 'CREW' ? 'text-gray-600' : 'text-gray-400'
                            }`}>
                              {getTierDisplayName(role?.default_permission_tier)}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(role)}
                              disabled={!isCustom}
                              title={isCustom ? 'Edit custom role' : 'Global roles are read-only'}
                            >
                              <Icon name="Edit2" size={16} />
                              Edit
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      {showTransferModal && (
        <TransferAdminModal
          onClose={() => setShowTransferModal(false)}
          onSuccess={handleTransferSuccess}
        />
      )}

      {/* Render the add/edit modal into document.body so the viewport-centered
           "fixed inset-0" layout isn't hijacked by any transformed ancestor in
           vessel-settings or its sidebar. Matches the standalone modals used
           elsewhere in the app (e.g. InviteCrewModal). */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg">
            <div className="border-b border-border p-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">
                {editingRole ? 'Edit Custom Role' : 'Add Custom Role'}
              </h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-muted rounded-lg transition-smooth">
                <Icon name="X" size={20} className="text-muted-foreground" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Role Name <span className="text-error">*</span>
                </label>
                <Input
                  value={formData?.name}
                  onChange={(e) => handleFormChange('name', e?.target?.value)}
                  placeholder="e.g., Second Stewardess"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Department <span className="text-error">*</span>
                </label>
                <Select
                  value={formData?.department_id}
                  onChange={(value) => handleFormChange('department_id', value)}
                  options={departmentOptions}
                  placeholder="Select a department"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Permission Tier <span className="text-error">*</span>
                </label>
                <Select
                  value={formData?.default_permission_tier}
                  onChange={(value) => handleFormChange('default_permission_tier', value)}
                  options={tierOptions}
                  placeholder="Select a permission tier"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Default access level for anyone assigned this role
                </p>
              </div>

              {formError && (
                <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
                  <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-error">{formError}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : (editingRole ? 'Save Changes' : 'Add Role')}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default RoleManagement;
