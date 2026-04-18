import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';


const EditAssignmentModal = ({ isOpen, onClose, member, onSuccess }) => {
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [permissionRole, setPermissionRole] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingJobTitles, setLoadingJobTitles] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [currentTenantId, setCurrentTenantId] = useState(null);

  useEffect(() => {
    if (isOpen && member) {
      loadCurrentTenant();
      loadDepartments();
      // Initialize form with member data
      setDepartmentId(member?.department_id || '');
      setRoleId(member?.role_id || '');
      setPermissionRole(member?.roleId || member?.tier || member?.role || '');
      setStatus(member?.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');
    }
  }, [isOpen, member]);

  // Load roles when department changes
  useEffect(() => {
    if (departmentId && currentTenantId) {
      loadRoles(departmentId);
    } else {
      setRoles([]);
      // Clear role selection when department changes
      if (departmentId !== member?.department_id) {
        setRoleId('');
      }
    }
  }, [departmentId, currentTenantId]);

  const loadCurrentTenant = async () => {
    try {
      // Get current user's profile to access last_active_tenant_id
      const { data: { user } } = await supabase?.auth?.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('last_active_tenant_id')
        ?.eq('id', user?.id)
        ?.single();

      if (profileError) throw profileError;

      const tenantId = profile?.last_active_tenant_id;
      if (!tenantId) {
        throw new Error('No active tenant found');
      }

      setCurrentTenantId(tenantId);
    } catch (err) {
      console.error('Failed to load current tenant:', err);
    }
  };

  const loadDepartments = async () => {
    setLoadingDepartments(true);
    try {
      // Load departments from departments_catalog (GLOBAL - no tenant filter)
      const { data, error } = await supabase
        ?.from('departments_catalog')
        ?.select('id, name, sort_order')
        ?.order('sort_order', { ascending: true })
        ?.order('name', { ascending: true });

      if (error) throw error;

      setDepartments(data || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
      setDepartments([]);
    } finally {
      setLoadingDepartments(false);
    }
  };

  const loadRoles = async (selectedDepartmentId) => {
    if (!selectedDepartmentId) return;

    setLoadingJobTitles(true);
    try {
      // Load roles from public.roles filtered by department_id
      const { data, error } = await supabase?.from('roles')?.select('id, name, department_id, default_permission_tier')?.eq('department_id', selectedDepartmentId)?.order('name', { ascending: true });

      if (error) throw error;

      setRoles(data || []);
    } catch (err) {
      console.error('Failed to load roles:', err);
      setRoles([]);
    } finally {
      setLoadingJobTitles(false);
    }
  };

  const handleDepartmentChange = (e) => {
    const newDepartmentId = e?.target?.value;
    setDepartmentId(newDepartmentId);
    // Clear role when department changes
    setRoleId('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Get current user
      const { data: { user } } = await supabase?.auth?.getUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Get tenant_id from RPC
      const { data: contextData, error: contextError } = await supabase?.rpc('get_my_context');
      if (contextError) throw contextError;
      if (!contextData || contextData?.length === 0) {
        throw new Error('No active tenant found');
      }

      const tenantId = contextData?.[0]?.tenant_id;
      const userId = member?.id || member?.user_id;

      // Prepare update payload with NULL-safe values
      const payload = {
        role: permissionRole,
        permission_tier: permissionRole,
        status: status,
        active: status === 'ACTIVE',
        department_id: departmentId || null,
        role_id: roleId || null,
        tenant_id: tenantId
      };

      console.log('EDIT ASSIGNMENT payload:', payload);
      console.log('EDIT ASSIGNMENT tenant_id:', tenantId, 'user_id:', userId);

      // Update tenant_members record
      const { error: updateError } = await supabase
        ?.from('tenant_members')
        ?.update(payload)
        ?.eq('tenant_id', tenantId)
        ?.eq('user_id', userId);

      if (updateError) {
        console.error('EDIT ASSIGNMENT error:', updateError);
        // Show actual Supabase error message
        const errorMessage = updateError?.message || 'Failed to update assignment';
        showToast(errorMessage, 'error');
        setError(errorMessage);
        throw updateError;
      }

      console.log('EDIT ASSIGNMENT success');
      showToast('Assignment updated', 'success');

      // Call success callback to refresh crew list
      if (onSuccess) {
        onSuccess();
      }

      handleClose();
    } catch (err) {
      console.error('Failed to update assignment:', err);
      const errorMessage = err?.message || 'Failed to update assignment';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDepartmentId('');
    setRoleId('');
    setPermissionRole('');
    setStatus('ACTIVE');
    setError('');
    setDepartments([]);
    setRoles([]);
    setCurrentTenantId(null);
    onClose();
  };

  if (!isOpen || !member) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        {/* Header */}
        <div className="bg-card border-b border-border p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="Edit" size={20} className="text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Edit Assignment
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Member Info (Read-only) */}
          <div className="bg-muted/20 border border-border rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon name="User" size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{member?.fullName}</p>
                <p className="text-xs text-muted-foreground">{member?.email}</p>
              </div>
            </div>
          </div>

          {/* Department */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Department
            </label>
            <select
              value={departmentId}
              onChange={handleDepartmentChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading || loadingDepartments}
            >
              <option value="">Select Department</option>
              {departments?.map(dept => (
                <option key={dept?.id} value={dept?.id}>{dept?.name}</option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role {departmentId && <span className="text-red-500">*</span>}
            </label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e?.target?.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading || loadingJobTitles || !departmentId}
            >
              <option value="">Select Role</option>
              {roles?.map(role => (
                <option key={role?.id} value={role?.id}>{role?.name}</option>
              ))}
            </select>
            {loadingJobTitles && (
              <p className="text-xs text-gray-500 mt-1">Loading roles...</p>
            )}
          </div>

          {/* Permission Role */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Permission Role <span className="text-error">*</span>
            </label>
            <select
              value={permissionRole}
              onChange={(e) => setPermissionRole(e?.target?.value)}
              required
              disabled={loading}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Select a role</option>
              <option value="COMMAND">Command</option>
              <option value="CHIEF">Chief</option>
              <option value="HOD">Head of Department</option>
              <option value="CREW">Crew</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Status <span className="text-error">*</span>
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e?.target?.value)}
              required
              disabled={loading}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Archived</option>
            </select>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
              <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditAssignmentModal;