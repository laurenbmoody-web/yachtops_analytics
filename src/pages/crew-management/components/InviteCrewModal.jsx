import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { showToast } from '../../../utils/toast';
import { createCrewInvite, sendCrewInvite } from '../../../utils/crewInvites';

const InviteCrewModal = ({ isOpen, onClose, onSuccess }) => {
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [inviteeName, setInviteeName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [existingInvite, setExistingInvite] = useState(null);
  const [createdInviteId, setCreatedInviteId] = useState(null);
  const [createdInviteToken, setCreatedInviteToken] = useState(null);
  const [createdInviteEmail, setCreatedInviteEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [customRoleName, setCustomRoleName] = useState('');
  const [formData, setFormData] = useState({
    department_id: '',
    role_id: '',
    permission_tier: ''
  });

  // A) Fetch departments catalog on modal open
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const { data, error } = await supabase?.from('departments')?.select('id,name')?.order('name', { ascending: true });

      console.log('departments query returned', data?.length || 0, 'results');
      if (error) {
        console.error('departments query error:', error);
        setError(`Unable to load departments. Error: ${error?.message}`);
      }
      setDepartments(data || []);
    })();
  }, [isOpen]);

  // C) Fetch roles when department selected — UNION of global roles and
  //    this tenant's custom roles. Each entry is tagged with source so the
  //    submit handler knows which column (role_id vs custom_role_id) to write.
  useEffect(() => {
    if (!isOpen || !formData?.department_id || !activeTenantId) {
      setRoles([]);
      return;
    }
    (async () => {
      const [{ data: globalRoles, error: globalErr }, { data: customRoles, error: customErr }] =
        await Promise.all([
          supabase
            .from('roles')
            .select('id,name,default_permission_tier')
            .eq('department_id', formData?.department_id)
            .order('name', { ascending: true }),
          supabase
            .from('tenant_custom_roles')
            .select('id,name,default_permission_tier')
            .eq('tenant_id', activeTenantId)
            .eq('department_id', formData?.department_id)
            .order('name', { ascending: true }),
        ]);

      if (globalErr || customErr) {
        console.error('roles query error:', globalErr || customErr);
        setError(`Unable to load roles. Error: ${(globalErr || customErr)?.message}`);
        setRoles([]);
        return;
      }
      const merged = [
        ...(globalRoles || []).map(r => ({ ...r, source: 'global' })),
        ...(customRoles || []).map(r => ({ ...r, source: 'custom' })),
      ];
      setRoles(merged);
    })();
  }, [isOpen, formData?.department_id, activeTenantId]);

  // Update permission tier when role changes - auto-populate from role's
  // default_permission_tier. "Other" free-text roles default to CREW.
  useEffect(() => {
    if (formData?.role_id === '__other__') {
      setFormData(prev => ({ ...prev, permission_tier: 'CREW' }));
      return;
    }
    if (formData?.role_id) {
      const selectedRole = roles?.find(r => r?.id === formData?.role_id);
      if (selectedRole) {
        const tier = selectedRole?.default_permission_tier || 'CREW';
        setFormData(prev => ({ ...prev, permission_tier: tier }));
      }
    } else {
      setFormData(prev => ({ ...prev, permission_tier: '' }));
    }
  }, [formData?.role_id, roles]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setExistingInvite(null);
    setLoading(true);

    try {
      if (!inviteeName || !email || !formData?.department_id || !formData?.role_id) {
        throw new Error('Please fill in all required fields');
      }
      if (formData?.role_id === '__other__' && !customRoleName.trim()) {
        throw new Error('Please enter a role name');
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex?.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!activeTenantId) throw new Error('No active tenant found');

      const selectedDepartment = departments?.find(d => d?.id === formData?.department_id);
      if (!selectedDepartment) {
        throw new Error('Selected department not found');
      }

      // Resolve role: existing global, existing custom, or new "Other" → upsert into tenant_custom_roles
      let resolvedRoleId = null;
      let resolvedCustomRoleId = null;
      let resolvedRoleLabel = '';
      let resolvedTier = formData?.permission_tier || 'CREW';

      if (formData?.role_id === '__other__') {
        const trimmedName = customRoleName.trim();
        const { data: upsertedRole, error: upsertErr } = await supabase
          .from('tenant_custom_roles')
          .upsert(
            {
              tenant_id: activeTenantId,
              department_id: formData?.department_id,
              name: trimmedName,
              default_permission_tier: 'CREW',
              created_by: user?.id,
            },
            { onConflict: 'tenant_id,department_id,name' }
          )
          .select('id, name, default_permission_tier')
          .single();
        if (upsertErr) throw new Error(upsertErr?.message || 'Failed to create custom role');
        resolvedCustomRoleId = upsertedRole?.id;
        resolvedRoleLabel = upsertedRole?.name;
        resolvedTier = upsertedRole?.default_permission_tier || 'CREW';
      } else {
        const selectedRole = roles?.find(r => r?.id === formData?.role_id);
        if (!selectedRole) throw new Error('Selected role not found');
        resolvedRoleLabel = selectedRole?.name;
        if (selectedRole?.source === 'custom') {
          resolvedCustomRoleId = selectedRole?.id;
        } else {
          resolvedRoleId = selectedRole?.id;
        }
      }

      const { data: inviteData, inviteLink: link, error: inviteError, existingInvite: dup } =
        await createCrewInvite({
          email,
          tenantId: activeTenantId,
          invitedBy: user?.id,
          departmentId: formData?.department_id,
          departmentLabel: selectedDepartment?.name,
          roleId: resolvedRoleId,
          customRoleId: resolvedCustomRoleId,
          roleLabel: resolvedRoleLabel,
          permissionTier: resolvedTier,
          firstName: inviteeName.trim() || null,
          startDate: startDate || null,
        });

      if (dup) setExistingInvite(dup);
      if (inviteError) throw new Error(inviteError?.message || 'Failed to create invite');

      console.log('Invite created', inviteData?.id);
      setCreatedInviteId(inviteData?.id);
      setCreatedInviteToken(inviteData?.token);
      setCreatedInviteEmail(email?.toLowerCase()?.trim());
      setInviteLink(link);

      showToast('Invite created', 'success');
      setShowSuccess(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Error in handleSubmit:', err);
      setError(err?.message || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    console.log('Copy link clicked');
    navigator.clipboard?.writeText(inviteLink);
    alert('Invite link copied to clipboard!');
  };

  const handleCloseModal = () => {
    // Reset all state
    setInviteeName('');
    setEmail('');
    setCustomRoleName('');
    setStartDate('');
    setFormData({
      department_id: '',
      role_id: '',
      permission_tier: ''
    });
    setError('');
    setInviteLink('');
    setShowSuccess(false);
    setExistingInvite(null);
    setCreatedInviteId(null);
    setCreatedInviteToken(null);
    setCreatedInviteEmail('');
    setSendingEmail(false);
    setDepartments([]);
    setRoles([]);
    onClose();
  };

  const handleDone = () => {
    handleCloseModal();
  };

  const handleSendEmail = async () => {
    if (!createdInviteId) return;
    setSendingEmail(true);
    const { error: sendError } = await sendCrewInvite(createdInviteId);
    if (sendError) {
      showToast(sendError?.message || 'Failed to send invite email', 'error');
    } else {
      showToast('Invite email sent', 'success');
    }
    setSendingEmail(false);
  };

  // B) Build Select options in correct shape
  const departmentOptions = (departments || [])?.map(d => ({
    label: d?.name,
    value: d?.id
  }));

  // C) Role dropdown options — global + custom + "Other…" sentinel.
  //    Custom roles get a "(Custom)" suffix so the user can tell them apart.
  const roleOptions = [
    ...((roles || []).map(r => ({
      label: r?.source === 'custom' ? `${r?.name} (Custom)` : r?.name,
      value: r?.id,
    }))),
    { label: 'Other…', value: '__other__' },
  ];

  // If showing success confirmation panel
  if (showSuccess) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" style={{ pointerEvents: 'auto' }}>
        <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6" style={{ zIndex: 60 }}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                <Icon name="Check" size={20} className="text-success" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Invite Ready</h2>
                <p className="text-sm text-muted-foreground">Invitation created successfully</p>
              </div>
            </div>
            <button
              onClick={handleDone}
              className="text-muted-foreground hover:text-foreground transition-smooth"
            >
              <Icon name="X" size={20} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Invitee Email</label>
              <p className="text-sm text-muted-foreground">{createdInviteEmail}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Invite Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inviteLink}
                  readOnly
                  className="flex-1 px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2" style={{ pointerEvents: 'auto' }}>
              <Button
                onClick={handleCopyLink}
                variant="outline"
                className="w-full"
              >
                <Icon name="Copy" size={16} className="mr-2" />
                Copy Link
              </Button>
              <Button
                onClick={handleSendEmail}
                disabled={!createdInviteId || sendingEmail}
                variant="outline"
                className="w-full"
              >
                {sendingEmail ? <LogoSpinner size={16} className="mr-2" /> : <Icon name="Mail" size={16} className="mr-2" />}
                {sendingEmail ? 'Sending…' : 'Send invite'}
              </Button>
              <Button
                onClick={handleDone}
                className="w-full"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main invite form modal
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Invite Crew Member</h2>
          <button
            onClick={handleCloseModal}
            className="text-muted-foreground hover:text-foreground transition-smooth"
          >
            <Icon name="X" size={20} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg flex items-start gap-2">
            <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Invitee name */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">
              Invitee name <span className="text-error">*</span>
            </label>
            <Input
              type="text"
              value={inviteeName}
              onChange={(e) => setInviteeName(e?.target?.value)}
              placeholder="Jane Smith"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">
              Email <span className="text-error">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e?.target?.value)}
              placeholder="crew@example.com"
              required
            />
          </div>

          {/* Department */}
          <div>
            <Select
              label="Department"
              options={departmentOptions}
              value={formData?.department_id}
              onChange={(value) => {
                setFormData(prev => ({ 
                  ...prev, 
                  department_id: value,
                  role_id: '' // Reset role when department changes
                }));
              }}
              searchable
              placeholder="Select department"
              required
            />
            {departments?.length === 0 && (
              <div className="mt-2 p-2 bg-warning/10 border border-warning/20 rounded text-xs text-warning">
                ⚠️ No departments loaded. Check console for errors.
              </div>
            )}
          </div>

          {/* Role */}
          <div>
            <Select
              label="Role"
              options={roleOptions}
              value={formData?.role_id}
              onChange={(value) => {
                setFormData(prev => ({ ...prev, role_id: value }));
                if (value !== '__other__') setCustomRoleName('');
              }}
              searchable
              placeholder="Select role"
              required
              disabled={!formData?.department_id}
            />
            {formData?.role_id === '__other__' && (
              <div className="mt-2">
                <Input
                  type="text"
                  value={customRoleName}
                  onChange={(e) => setCustomRoleName(e?.target?.value)}
                  placeholder="Custom role name"
                  required
                />
              </div>
            )}
          </div>

          {/* Permission Tier (Read-only, auto-populated from roles.default_permission_tier) */}
          {formData?.permission_tier && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">
                Permission Tier
              </label>
              <div className="px-3 py-2 bg-muted border border-border rounded-lg text-sm text-muted-foreground">
                {formData?.permission_tier}
              </div>
            </div>
          )}

          {/* Start Date */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">
              Start Date <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e?.target?.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              If set to a future date, the crew member will show as &quot;Invited&quot; until that date.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCloseModal}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !inviteeName || !email || !formData?.department_id || !formData?.role_id || (formData?.role_id === '__other__' && !customRoleName.trim())}
              className="flex-1"
            >
              {loading ? 'Creating...' : 'Create Invite'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InviteCrewModal;