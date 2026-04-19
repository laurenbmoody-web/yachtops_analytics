import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import { getTierDisplayName } from '../../../utils/authStorage';

const EditCrewModal = ({ isOpen, onClose, member, onSuccess }) => {
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideRole, setOverrideRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filteredRoles, setFilteredRoles] = useState([]);
  const [defaultRole, setDefaultRole] = useState('');

  useEffect(() => {
    if (isOpen && member) {
      loadDepartments();
      loadRoles();
      // Initialize form with member data
      setDepartmentId(member?.departmentId || '');
      setRoleId(member?.roleId || '');
      setOverrideEnabled(member?.permissionOverrideEnabled || false);
      setOverrideRole(member?.permissionTierOverride || '');
    }
  }, [isOpen, member]);

  // Filter roles by department
  useEffect(() => {
    if (departmentId && roles?.length > 0) {
      const filtered = roles?.filter(r => r?.department_id === departmentId);
      setFilteredRoles(filtered);
      console.log('Filtered roles by department_id:', departmentId, 'Count:', filtered?.length);
    } else {
      setFilteredRoles(roles);
    }
  }, [departmentId, roles]);

  // Update default role when role changes (derive from role's default tier)
  useEffect(() => {
    if (roleId) {
      const selectedRole = roles?.find(r => r?.id === roleId);
      if (selectedRole) {
        // For now, we'll use a simple mapping since roles table doesn't have tier field
        // In production, you'd have a tier field in roles table or a separate mapping
        setDefaultRole(member?.role || 'CREW');
      }
    } else {
      setDefaultRole('');
    }
  }, [roleId, roles, member]);

  const loadDepartments = async () => {
    setLoadingDepartments(true);
    try {
      console.log('Loading departments from public.departments...');
      const { data, error } = await supabase
        ?.from('departments')
        ?.select('id, name')
        ?.order('name', { ascending: true });

      if (error) {
        console.error('Error loading departments:', error);
        throw error;
      }

      console.log('Departments loaded:', data?.length || 0);
      setDepartments(data || []);
    } catch (err) {
      console.error('Failed to load departments:', err);
      setError('Failed to load departments');
    } finally {
      setLoadingDepartments(false);
    }
  };

  const loadRoles = async () => {
    setLoadingRoles(true);
    try {
      console.log('Loading roles from public.roles...');
      const { data, error } = await supabase?.from('roles')?.select('id, name, department_id, default_permission_tier')?.order('name', { ascending: true });

      if (error) {
        console.error('Error loading roles:', error);
        throw error;
      }

      console.log('Roles loaded:', data?.length || 0);
      setRoles(data || []);
    } catch (err) {
      console.error('Failed to load roles:', err);
      setError('Failed to load roles');
    } finally {
      setLoadingRoles(false);
    }
  };

  if (!isOpen || !member) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!departmentId || !roleId) {
        throw new Error('Please fill in all required fields');
      }

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
      const userId = member?.id;

      // Resolve the permission tier from the selected role
      const selectedRole = roles?.find(r => r?.id === roleId);
      const newTier = (selectedRole?.default_permission_tier || 'CREW').toUpperCase().trim();

      // Prepare update data — always sync permission_tier so auth bootstrap reads correctly
      const payload = {
        department_id: departmentId,
        role_id: roleId,
        permission_tier: newTier,
      };

      // Only add legacy role if override is enabled
      if (overrideEnabled && overrideRole) {
        payload.role = overrideRole;
      }

      console.log('EDIT SAVE payload', payload);
      console.log('EDIT SAVE tenant_id', tenantId, 'user_id', userId);

      // Update tenant_members record by BOTH keys: tenant_id and user_id
      const { error: updateError } = await supabase
        ?.from('tenant_members')
        ?.update(payload)
        ?.eq('tenant_id', tenantId)
        ?.eq('user_id', userId);

      if (updateError) {
        console.error('EDIT SAVE Supabase error:', updateError);
        console.error('Full error object:', JSON.stringify(updateError, null, 2));
        throw updateError;
      }

      console.log('EDIT SAVE success - Crew member updated');

      // Call success callback
      if (onSuccess) {
        onSuccess();
      }

      handleClose();
    } catch (err) {
      console.error('EDIT SAVE error:', err);
      console.error('Full error object:', JSON.stringify(err, null, 2));
      setError(err?.message || 'Failed to update crew member');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDepartmentId('');
    setRoleId('');
    setOverrideEnabled(false);
    setOverrideRole('');
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md">
        <div className="bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">
            Edit Crew Member
          </h2>
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

          {/* Department (Dropdown from public.departments) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Department <span className="text-error">*</span>
            </label>
            {loadingDepartments ? (
              <select
                disabled
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option>Loading departments...</option>
              </select>
            ) : departments?.length === 0 ? (
              <select
                disabled
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option>No departments available</option>
              </select>
            ) : (
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e?.target?.value)}
                disabled={loading}
                required
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select a department</option>
                {departments?.map(dept => (
                  <option key={dept?.id} value={dept?.id}>{dept?.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Job Title (Dropdown from public.roles filtered by department_id) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Role <span className="text-error">*</span>
            </label>
            {loadingRoles ? (
              <select
                disabled
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option>Loading roles...</option>
              </select>
            ) : filteredRoles?.length === 0 ? (
              <select
                disabled
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option>No roles available for this department</option>
              </select>
            ) : (
              <select
                value={roleId}
                onChange={(e) => setRoleId(e?.target?.value)}
                required
                disabled={loading}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white text-black px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select a role</option>
                {filteredRoles?.map(r => (
                  <option key={r?.id} value={r?.id}>
                    {r?.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Permission Role Section */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Permission Role</h3>
            
            {/* Override Toggle */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="overrideToggle"
                checked={overrideEnabled}
                onChange={(e) => setOverrideEnabled(e?.target?.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="overrideToggle" className="text-sm font-medium text-foreground">
                Override default permissions
              </label>
            </div>

            {/* Default Role Display (when override OFF) */}
            {!overrideEnabled && defaultRole && (
              <div className="bg-muted/20 border border-border rounded-lg p-3">
                <p className="text-sm text-muted-foreground">
                  Using default: <span className="font-medium text-foreground">{getTierDisplayName(defaultRole)}</span> (from Role Management)
                </p>
              </div>
            )}

            {/* Override Role Dropdown (when override ON) */}
            {overrideEnabled && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Select Permission Role <span className="text-error">*</span>
                </label>
                <select
                  value={overrideRole}
                  onChange={(e) => setOverrideRole(e?.target?.value)}
                  required={overrideEnabled}
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
            )}
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

export default EditCrewModal;