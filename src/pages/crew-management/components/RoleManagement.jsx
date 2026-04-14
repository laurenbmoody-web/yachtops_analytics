import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import TransferAdminModal from './TransferAdminModal';

import { loadRoles, createRole, updateRole, Department, PermissionTier, getDepartmentDisplayName, getTierDisplayName, hasCommandAccess, getCurrentUser } from '../../../utils/authStorage';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

const RoleManagement = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [isVesselAdmin, setIsVesselAdmin] = useState(false);
  const [currentAdminProfile, setCurrentAdminProfile] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    department: '',
    permissionTier: '',
    status: 'ACTIVE'
  });
  const [formError, setFormError] = useState('');

  // Check authentication and authorization
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      // DO NOT redirect here - ProtectedRoute handles this
      return;
    }
    if (!hasCommandAccess(u)) {
      navigate('/dashboard');
      return;
    }
    setCurrentUser(u);
  }, [navigate]);

  // Load roles
  useEffect(() => {
    setRoles(loadRoles());
  }, []);

  // Determine whether the current user is the vessel admin for their active tenant.
  useEffect(() => {
    if (user?.id) {
      checkVesselAdminStatus();
    }
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

      // Source of truth: tenants.current_admin_user_id. Permission tier is
      // separate from "am I the vessel admin".
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

  const handleTransferSuccess = () => {
    // Re-check admin status — the caller just handed off the role.
    checkVesselAdminStatus();
  };

  // Handle form input changes
  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Open add modal
  const handleAddClick = () => {
    setFormData({
      title: '',
      department: '',
      permissionTier: '',
      status: 'ACTIVE'
    });
    setFormError('');
    setEditingRole(null);
    setShowAddModal(true);
  };

  // Open edit modal
  const handleEditClick = (role) => {
    setFormData({
      title: role?.title,
      department: role?.department,
      permissionTier: role?.permissionTier || role?.tier,
      status: role?.status || (role?.isActive ? 'ACTIVE' : 'INACTIVE')
    });
    setFormError('');
    setEditingRole(role);
    setShowAddModal(true);
  };

  // Submit form
  const handleSubmit = (e) => {
    e?.preventDefault();
    setFormError('');

    // Validation
    if (!formData?.title?.trim()) {
      setFormError('Role Title is required');
      return;
    }

    if (!formData?.department) {
      setFormError('Department is required');
      return;
    }

    if (!formData?.permissionTier) {
      setFormError('Permission Tier is required');
      return;
    }

    try {
      if (editingRole) {
        // Update existing role
        updateRole(editingRole?.id, formData);
      } else {
        // Create new role
        createRole(formData);
      }

      // Reload roles immediately
      setRoles(loadRoles());
      setShowAddModal(false);
    } catch (error) {
      setFormError(error?.message || 'An error occurred');
    }
  };

  // Toggle role active status
  const handleToggleActive = (role) => {
    const newStatus = role?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    updateRole(role?.id, { status: newStatus });
    setRoles(loadRoles());
  };

  // Enhanced search filter
  const filteredRoles = roles?.filter(role => {
    if (!searchQuery) return true;
    const query = searchQuery?.toLowerCase();
    const title = role?.title?.toLowerCase() || '';
    const department = getDepartmentDisplayName(role?.department)?.toLowerCase() || '';
    const tier = getTierDisplayName(role?.tier)?.toLowerCase() || '';
    const status = (role?.isActive ? 'active' : 'inactive')?.toLowerCase();
    return title?.includes(query) || department?.includes(query) || tier?.includes(query) || status?.includes(query);
  });

  // Handle column sorting
  const handleSort = (key) => {
    let direction = 'asc';
    let newKey = key;
    if (sortConfig?.key === key && sortConfig?.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig?.key === key && sortConfig?.direction === 'desc') {
      direction = null;
      newKey = null;
    }
    setSortConfig({ key: newKey, direction });
  };

  // Apply sorting
  const sortedRoles = [...filteredRoles]?.sort((a, b) => {
    if (!sortConfig?.key || !sortConfig?.direction) return 0;

    let aValue, bValue;

    if (sortConfig?.key === 'title') {
      aValue = a?.title?.toLowerCase() || '';
      bValue = b?.title?.toLowerCase() || '';
    } else if (sortConfig?.key === 'department') {
      aValue = getDepartmentDisplayName(a?.department) || '';
      bValue = getDepartmentDisplayName(b?.department) || '';
      return sortConfig?.direction === 'asc'
        ? aValue?.localeCompare(bValue)
        : bValue?.localeCompare(aValue);
    } else if (sortConfig?.key === 'tier') {
      aValue = getTierDisplayName(a?.permissionTier || a?.tier)?.toLowerCase() || '';
      bValue = getTierDisplayName(b?.permissionTier || b?.tier)?.toLowerCase() || '';
    } else if (sortConfig?.key === 'status') {
      aValue = (a?.status || (a?.isActive ? 'ACTIVE' : 'INACTIVE'));
      bValue = (b?.status || (b?.isActive ? 'ACTIVE' : 'INACTIVE'));
    }

    if (aValue < bValue) return sortConfig?.direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortConfig?.direction === 'asc' ? 1 : -1;
    return 0;
  });

  if (!currentUser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Role Management</h1>
            <p className="text-sm text-muted-foreground">Manage job titles, departments, and permission tiers</p>
          </div>
          <Button onClick={handleAddClick}>
            <Icon name="Plus" size={18} />
            Add Role
          </Button>
        </div>

        {/* Vessel Admin Transfer Section — only the current vessel admin sees the transfer button */}
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
                  <span className="text-sm font-medium text-foreground">
                    {currentAdminProfile?.full_name}
                  </span>
                  <span className="text-xs text-muted-foreground">({currentAdminProfile?.email})</span>
                  {isVesselAdmin && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">You</span>
                  )}
                </div>
              </div>
              {isVesselAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowTransferModal(true)}
                >
                  <Icon name="UserCheck" size={16} />
                  Transfer Admin
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Search Filter */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-6">
          <Input
            placeholder="Search roles by title, department, tier, or status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e?.target?.value)}
            icon="Search"
          />
        </div>

        {/* Roles by Department */}
        <div className="space-y-6">
          {sortedRoles?.length === 0 ? (
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
                        onClick={() => handleSort('title')}
                      >
                        <div className="flex items-center gap-2">
                          Role Title
                          <div className="flex flex-col">
                            <Icon
                              name="ChevronUp"
                              size={12}
                              className={sortConfig?.key === 'title' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                            <Icon
                              name="ChevronDown"
                              size={12}
                              className={sortConfig?.key === 'title' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'}
                            />
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
                            <Icon
                              name="ChevronUp"
                              size={12}
                              className={sortConfig?.key === 'department' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                            <Icon
                              name="ChevronDown"
                              size={12}
                              className={sortConfig?.key === 'department' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'}
                            />
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
                            <Icon
                              name="ChevronUp"
                              size={12}
                              className={sortConfig?.key === 'tier' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                            <Icon
                              name="ChevronDown"
                              size={12}
                              className={sortConfig?.key === 'tier' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                          </div>
                        </div>
                      </th>
                      <th
                        className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/20 transition-smooth"
                        onClick={() => handleSort('status')}
                      >
                        <div className="flex items-center gap-2">
                          Status
                          <div className="flex flex-col">
                            <Icon
                              name="ChevronUp"
                              size={12}
                              className={sortConfig?.key === 'status' && sortConfig?.direction === 'asc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                            <Icon
                              name="ChevronDown"
                              size={12}
                              className={sortConfig?.key === 'status' && sortConfig?.direction === 'desc' ? 'text-primary' : 'text-muted-foreground'}
                            />
                          </div>
                        </div>
                      </th>
                      <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRoles?.map(role => (
                      <tr key={role?.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                        <td className="p-4">
                          <span className="text-sm font-medium text-foreground">{role?.title}</span>
                        </td>
                        <td className="p-4">
                          <span className="text-sm text-foreground">{getDepartmentDisplayName(role?.department)}</span>
                        </td>
                        <td className="p-4">
                          <span className={`text-sm font-medium ${
                            (role?.permissionTier || role?.tier) === 'COMMAND' ? 'text-red-600' :
                            (role?.permissionTier || role?.tier) === 'CHIEF' ? 'text-blue-600' :
                            (role?.permissionTier || role?.tier) === 'HOD' ? 'text-amber-600' :
                            (role?.permissionTier || role?.tier) === 'CREW' ? 'text-gray-600' : 'text-gray-400'
                          }`}>
                            {getTierDisplayName(role?.permissionTier || role?.tier)}
                          </span>
                        </td>
                        <td className="p-4">
                          <button
                            onClick={() => handleToggleActive(role)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-smooth ${
                              (role?.status === 'ACTIVE' || role?.isActive)
                                ? 'bg-success/10 text-success hover:bg-success/20' :'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              (role?.status === 'ACTIVE' || role?.isActive) ? 'bg-success' : 'bg-muted-foreground'
                            }`} />
                            {(role?.status === 'ACTIVE' || role?.isActive) ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditClick(role)}
                          >
                            <Icon name="Edit2" size={16} />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Transfer Admin Modal */}
      {showTransferModal && (
        <TransferAdminModal
          onClose={() => setShowTransferModal(false)}
          onSuccess={handleTransferSuccess}
        />
      )}

      {/* Add/Edit Role Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg">
            <div className="border-b border-border p-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">
                {editingRole ? 'Edit Role' : 'Add New Role'}
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="X" size={20} className="text-muted-foreground" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Role Title */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Role Title <span className="text-error">*</span>
                </label>
                <Input
                  value={formData?.title}
                  onChange={(e) => handleFormChange('title', e?.target?.value)}
                  placeholder="e.g., Chief Stewardess"
                  required
                />
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Department <span className="text-error">*</span>
                </label>
                <Select
                  value={formData?.department}
                  onChange={(value) => handleFormChange('department', value)}
                  options={Object.values(Department)?.map(dept => ({
                    label: getDepartmentDisplayName(dept),
                    value: dept
                  }))}
                  placeholder="Select a department"
                  required
                />
              </div>

              {/* Permission Tier */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Permission Tier <span className="text-error">*</span>
                </label>
                <Select
                  value={formData?.permissionTier}
                  onChange={(value) => handleFormChange('permissionTier', value)}
                  options={Object.values(PermissionTier)?.map(tier => ({
                    label: getTierDisplayName(tier),
                    value: tier
                  }))}
                  placeholder="Select a permission tier"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Determines access level and widget visibility
                </p>
              </div>

              {/* Active Status */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData?.status === 'ACTIVE'}
                  onChange={(e) => handleFormChange('status', e?.target?.checked ? 'ACTIVE' : 'INACTIVE')}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-foreground">
                  Active (available for assignment)
                </label>
              </div>

              {/* Error Message */}
              {formError && (
                <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
                  <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-error">{formError}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingRole ? 'Save Changes' : 'Add Role'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;
