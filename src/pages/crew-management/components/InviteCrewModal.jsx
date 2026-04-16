import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
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

  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
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

  // C) Fetch roles when department selected
  useEffect(() => {
    if (!isOpen || !formData?.department_id) {
      setRoles([]);
      return;
    }
    (async () => {
      const { data: rolesData, error } = await supabase?.from('roles')?.select('id,name,department_id,default_permission_tier')?.eq('department_id', formData?.department_id)?.order('name', { ascending: true });

      console.log('roles query returned', rolesData?.length || 0, 'results for department_id:', formData?.department_id);
      if (error) {
        console.error('roles query error:', error);
        setError(`Unable to load roles. Check roles table schema. Error: ${error?.message}`);
        setRoles([]);
        return;
      }
      setRoles(rolesData || []);
    })();
  }, [isOpen, formData?.department_id]);

  // Update permission tier when role changes - auto-populate from roles.default_permission_tier
  useEffect(() => {
    if (formData?.role_id) {
      const selectedRole = roles?.find(r => r?.id === formData?.role_id);
      if (selectedRole) {
        // Use default_permission_tier from role
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

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex?.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!activeTenantId) throw new Error('No active tenant found');

      const selectedDepartment = departments?.find(d => d?.id === formData?.department_id);
      const selectedRole = roles?.find(r => r?.id === formData?.role_id);
      if (!selectedDepartment || !selectedRole) {
        throw new Error('Selected department or role not found');
      }

      const { data: inviteData, inviteLink: link, error: inviteError, existingInvite: dup } =
        await createCrewInvite({
          email,
          tenantId: activeTenantId,
          invitedBy: user?.id,
          departmentId: formData?.department_id,
          departmentLabel: selectedDepartment?.name,
          roleId: formData?.role_id,
          roleLabel: selectedRole?.name,
          permissionTier: formData?.permission_tier || 'CREW',
          firstName: inviteeName.trim() || null,
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

  // C) Role dropdown options - stores role.id (uuid), not role name text
  const roleOptions = (roles || [])?.map(r => ({
    label: r?.name,
    value: r?.id // uuid value
  }));

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
                <Icon name={sendingEmail ? 'Loader2' : 'Mail'} size={16} className={`mr-2${sendingEmail ? ' animate-spin' : ''}`} />
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
              onChange={(value) =>
                setFormData(prev => ({ ...prev, role_id: value }))
              }
              searchable
              placeholder="Select role"
              required
              disabled={!formData?.department_id}
            />
            {formData?.department_id && roles?.length === 0 && (
              <div className="mt-2 p-2 bg-warning/10 border border-warning/20 rounded text-xs text-warning">
                ⚠️ No roles found for selected department. Check console for errors.
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
              disabled={loading || !inviteeName || !email || !formData?.department_id || !formData?.role_id}
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