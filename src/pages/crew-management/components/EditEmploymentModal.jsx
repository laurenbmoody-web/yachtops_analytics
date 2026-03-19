import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';

const showToast = (message, type = 'info') => {
  console.log(`[${type?.toUpperCase()}] ${message}`);
};

const EditEmploymentModal = ({ isOpen, onClose, member, onSuccess }) => {
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(null);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [defaultPermissionTier, setDefaultPermissionTier] = useState(''); // From roles.default_permission_tier (read-only)
  const [overridePermissionTier, setOverridePermissionTier] = useState('DEFAULT'); // User's override choice
  const [selectedStatus, setSelectedStatus] = useState('');
  const [tenantMemberId, setTenantMemberId] = useState(null); // Store tenant_member.id for updates
  
  // Track if form has changes
  const [hasChanges, setHasChanges] = useState(false);
  const [initialValues, setInitialValues] = useState({});

  // Override Permission Tier options
  const overridePermissionOptions = [
    { value: 'DEFAULT', label: 'Use Role Default' },
    { value: 'COMMAND', label: 'Command' },
    { value: 'CHIEF', label: 'Chief' },
    { value: 'HOD', label: 'Head of Department' },
    { value: 'CREW', label: 'Crew' },
    { value: 'VIEW_ONLY', label: 'View Only' }
  ];

  // Status options (from tenant_members.status constraint)
  const statusOptions = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'INVITED', label: 'Invited' }
  ];

  // Fetch departments from public.departments table
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      console.log('[EditEmploymentModal] Fetching departments from departments table...');
      const { data, error } = await supabase
        ?.from('departments')
        ?.select('id,name')
        ?.order('name', { ascending: true });

      if (error) {
        console.error('[EditEmploymentModal] Error fetching departments:', error);
        setError(error?.message);
      } else {
        console.log(`[EditEmploymentModal] Departments fetched: ${data?.length || 0} results`, data);
        if (!data || data?.length === 0) {
          showToast('Lookup list returned 0 results for departments', 'warning');
        }
        setDepartments(data || []);
      }
    })();
  }, [isOpen]);

  // Fetch roles from public.roles table (all roles, will filter by department in UI)
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      console.log('[EditEmploymentModal] Fetching roles from roles table...');
      const { data, error } = await supabase?.from('roles')?.select('id,name,department_id,default_permission_tier')?.order('name', { ascending: true });

      if (error) {
        console.error('[EditEmploymentModal] Error fetching roles:', error);
        setError(error?.message);
      } else {
        console.log(`[EditEmploymentModal] Roles fetched: ${data?.length || 0} results`, data);
        if (!data || data?.length === 0) {
          showToast('Lookup list returned 0 results for roles', 'warning');
        }
        // De-duplicate roles by id before setting state
        const deduped = Array.from(new Map((data || []).map(r => [r?.id, r]))?.values());
        setRoles(deduped);
      }
    })();
  }, [isOpen]);

  // Update default permission tier when role changes (restore logic)
  useEffect(() => {
    if (!selectedRoleId || roles?.length === 0) {
      setDefaultPermissionTier('');
      return;
    }
    
    const selectedRole = roles?.find(r => r?.id === selectedRoleId);
    if (selectedRole) {
      // Auto-set permission tier from roles.default_permission_tier
      setDefaultPermissionTier(selectedRole?.default_permission_tier || '');
      console.log(`[EditEmploymentModal] Role selected: ${selectedRole?.name}, default_permission_tier: ${selectedRole?.default_permission_tier}`);
    }
  }, [selectedRoleId, roles]);

  // Filter roles by selected department_id
  const filteredRoles = selectedDepartmentId 
    ? roles?.filter(r => r?.department_id === selectedDepartmentId)
    : [];

  // De-duplicate filtered roles by id and create options array
  const uniqueRoles = Array.from(new Map((filteredRoles || []).map(r => [r?.id, r]))?.values());
  const roleOptions = uniqueRoles?.map(r => ({
    label: r?.name,
    value: r?.id
  }));

  // Create department options array
  const departmentOptions = (departments || [])?.map(d => ({
    label: d?.name,
    value: d?.id
  }));

  // Initialize form with member data from tenant_members
  useEffect(() => {
    if (!isOpen || !member || !activeTenantId) return;

    (async () => {
      console.log(`[EditEmploymentModal] Loading member data for user_id: ${member?.user_id}, tenant_id: ${activeTenantId}`);
      
      // Fetch tenant_members data (department_id, role_id, status, permission_tier_override)
      const { data: tenantMemberData, error: tenantMemberError } = await supabase
        ?.from('tenant_members')
        ?.select('id, department_id, role_id, status, permission_tier_override')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('user_id', member?.user_id)
        ?.maybeSingle();

      if (tenantMemberError) {
        console.error('[EditEmploymentModal] Error fetching tenant member data:', tenantMemberError);
        setError(tenantMemberError?.message);
        return;
      }

      console.log('[EditEmploymentModal] Tenant member data loaded:', tenantMemberData);

      const initial = {
        departmentId: tenantMemberData?.department_id || null,
        roleId: tenantMemberData?.role_id || null, // role_id from tenant_members
        overridePermissionTier: tenantMemberData?.permission_tier_override || 'DEFAULT',
        status: tenantMemberData?.status || 'ACTIVE'
      };

      setInitialValues(initial);
      setTenantMemberId(tenantMemberData?.id); // Store tenant_member.id for updates
      setSelectedDepartmentId(initial?.departmentId);
      setSelectedRoleId(initial?.roleId);
      setOverridePermissionTier(initial?.overridePermissionTier);
      setSelectedStatus(initial?.status);
      setHasChanges(false);
    })();
  }, [isOpen, member, activeTenantId]);

  // Check for changes
  useEffect(() => {
    if (!initialValues?.departmentId && !initialValues?.roleId) return;

    const changed = 
      selectedDepartmentId !== initialValues?.departmentId ||
      selectedRoleId !== initialValues?.roleId ||
      overridePermissionTier !== initialValues?.overridePermissionTier ||
      selectedStatus !== initialValues?.status;

    setHasChanges(changed);
  }, [selectedDepartmentId, selectedRoleId, overridePermissionTier, selectedStatus, initialValues]);

  // Reset role when department changes
  const handleDepartmentChange = (value) => {
    setSelectedDepartmentId(value);
    // Clear role selection when department changes
    if (value !== initialValues?.departmentId) {
      setSelectedRoleId(null);
      setDefaultPermissionTier('');
    }
  };

  const handleClose = () => {
    setError('');
    setSelectedDepartmentId(null);
    setSelectedRoleId(null);
    setDefaultPermissionTier('');
    setOverridePermissionTier('DEFAULT');
    setSelectedStatus('');
    setTenantMemberId(null);
    setHasChanges(false);
    setInitialValues({});
    onClose();
  };

  const handleSave = async () => {
    setError('');
    setLoading(true);

    try {
      // Validate required fields
      if (!selectedDepartmentId || !selectedRoleId || !selectedStatus) {
        throw new Error('Please fill in all required fields');
      }

      // Check if default permission tier is NULL
      if (!defaultPermissionTier) {
        throw new Error('Cannot save: Default permission tier not set for this role');
      }

      // Validate tenant_member.id exists
      if (!tenantMemberId) {
        throw new Error('Tenant member ID not found');
      }

      // Verify current user has Command or Management role
      const user = session?.user;
      if (!user) {
        throw new Error('Not authenticated');
      }

      // Get current user's role
      const { data: currentUserData, error: userError } = await supabase
        ?.from('tenant_members')
        ?.select('role, permission_tier, permission_tier_override')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('user_id', user?.id)
        ?.maybeSingle();

      if (userError) {
        throw new Error('Failed to verify permissions');
      }

      // Check permission_tier first (used by RLS), then permission_tier_override, then legacy role column
      const effectiveTier = currentUserData?.permission_tier || currentUserData?.permission_tier_override || currentUserData?.role;
      if (effectiveTier !== 'COMMAND' && effectiveTier !== 'MANAGEMENT') {
        throw new Error('Only Command or Management users can edit employment details');
      }

      console.log('[EditEmploymentModal] Saving employment details:', {
        tenant_member_id: tenantMemberId,
        department_id: selectedDepartmentId,
        role_id: selectedRoleId,
        status: selectedStatus,
        permission_tier_override: overridePermissionTier === 'DEFAULT' ? null : overridePermissionTier
      });

      // Update tenant_members using tenant_member.id (NOT user_id)
      const { data: updatedRow, error: updateError } = await supabase
        ?.from('tenant_members')
        ?.update({
          department_id: selectedDepartmentId,
          role_id: selectedRoleId, // This is the role_id from roles table
          status: selectedStatus,
          permission_tier_override: overridePermissionTier === 'DEFAULT' ? null : overridePermissionTier
        })
        ?.eq('id', tenantMemberId)
        ?.select()
        ?.maybeSingle(); // Use maybeSingle to avoid PGRST116 when 0 rows matched

      if (updateError) {
        console.error('[EditEmploymentModal] Error updating tenant_members:', updateError);
        throw new Error(updateError?.message || 'Failed to update employment details');
      }

      if (!updatedRow) {
        console.warn('[EditEmploymentModal] Update matched 0 rows for tenant_member id:', tenantMemberId);
        throw new Error('No matching record found to update. The member may have been removed.');
      }

      console.log('[EditEmploymentModal] Employment details updated successfully:', updatedRow);
      
      // Update local state so modal reflects saved values
      setInitialValues({
        departmentId: selectedDepartmentId,
        roleId: selectedRoleId,
        overridePermissionTier: overridePermissionTier,
        status: selectedStatus
      });
      setHasChanges(false);
      
      showToast('Employment details updated', 'success');
      
      // CRITICAL: Trigger refetch of crew list and wait for it to complete
      if (onSuccess) {
        console.log('[EditEmploymentModal] Calling onSuccess callback to refetch crew list...');
        await onSuccess();
        console.log('[EditEmploymentModal] Crew list refetch completed');
      }
      
      // Close modal AFTER state/list is updated
      handleClose();
    } catch (err) {
      console.error('[EditEmploymentModal] Error updating employment details:', err);
      setError(err?.message || 'Failed to update employment details');
      showToast(err?.message || 'Failed to update employment details', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Calculate if Save button should be disabled
  const isSaveDisabled = loading || !hasChanges || !selectedDepartmentId || !selectedRoleId || !defaultPermissionTier;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Edit Employment Details</h2>
            <p className="text-sm text-muted-foreground mt-1">{member?.fullName || member?.email}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={loading}
          >
            <Icon name="X" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
              <Icon name="AlertCircle" size={18} className="text-destructive mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Department - Controlled with value prop */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Department <span className="text-destructive">*</span>
            </label>
            <Select
              options={departmentOptions}
              value={selectedDepartmentId}
              onChange={handleDepartmentChange}
              disabled={loading}
              searchable
              placeholder="Select department"
            />
            {departments?.length === 0 && (
              <p className="text-xs text-amber-500 mt-1">No departments available</p>
            )}
          </div>

          {/* Job Role - Controlled with value prop */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Role <span className="text-destructive">*</span>
            </label>
            <Select
              options={roleOptions}
              value={selectedRoleId}
              onChange={(value) => setSelectedRoleId(value)}
              disabled={loading || !selectedDepartmentId}
              searchable
              placeholder="Select role"
            />
            {!selectedDepartmentId && (
              <p className="text-xs text-muted-foreground mt-1">Select a department first</p>
            )}
            {selectedDepartmentId && filteredRoles?.length === 0 && (
              <p className="text-xs text-amber-500 mt-1">No roles available for this department</p>
            )}
          </div>

          {/* Default Permission Tier (read-only) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Default Permission Tier
            </label>
            <input
              type="text"
              value={defaultPermissionTier || ''}
              disabled
              placeholder="Select a role to see default permission"
              className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
            />
            {selectedRoleId && !defaultPermissionTier && (
              <div className="flex items-start gap-2 mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <Icon name="AlertTriangle" size={16} className="text-amber-500 mt-0.5" />
                <p className="text-xs text-amber-500">Default permission tier not set for this role. Cannot save until role has a default permission tier.</p>
              </div>
            )}
          </div>

          {/* Override Permission Tier (optional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Override Permission Tier (Optional)
            </label>
            <Select
              options={overridePermissionOptions}
              value={overridePermissionTier}
              onChange={(value) => setOverridePermissionTier(value)}
              disabled={loading || !selectedRoleId}
              placeholder="Use role default"
            />
            {!selectedRoleId && (
              <p className="text-xs text-muted-foreground mt-1">Select a role first</p>
            )}
            {overridePermissionTier && overridePermissionTier !== 'DEFAULT' && (
              <p className="text-xs text-blue-500 mt-1">
                Override active: Using {overridePermissionTier} instead of role default
              </p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Status <span className="text-destructive">*</span>
            </label>
            <Select
              options={statusOptions}
              value={selectedStatus}
              onChange={(value) => setSelectedStatus(value)}
              disabled={loading}
              placeholder="Select status"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaveDisabled}
          >
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EditEmploymentModal;