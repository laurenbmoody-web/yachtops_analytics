import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { showToast } from '../../../utils/toast';

// Helper function to build invite email with mailto: URL
function buildInviteEmail({ inviteeEmail, inviteLink, vesselName, inviteeName }) {
  const name = inviteeName?.trim() ? inviteeName?.trim() : "there";
  const vessel = vesselName?.trim() ? vesselName?.trim() : "your vessel";
  const subject = `Cargo Invite — M/Y ${vessel}`;
  const body =
`Hi ${name},

You've been invited to join Cargo for M/Y ${vessel}.

Cargo is the vessel's shared operational platform used to manage inventory visibility, crew information, provisioning records, and departmental workflows across the vessel.

Please use the link below to create your account and access the vessel workspace:

Join Cargo → ${inviteLink}

Once logged in, please complete your crew profile and review the relevant sections for your department.

If you experience any access issues, please contact the vessel.

Kind regards,

M/Y ${vessel}

`;
  const mailto = `mailto:${encodeURIComponent(inviteeEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return mailto;
}

const InviteCrewModal = ({ isOpen, onClose, onSuccess }) => {
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [existingInvite, setExistingInvite] = useState(null);
  const [createdInviteId, setCreatedInviteId] = useState(null);
  const [createdInviteToken, setCreatedInviteToken] = useState(null);
  const [createdInviteEmail, setCreatedInviteEmail] = useState('');
  const [vesselName, setVesselName] = useState('');

  // NEW STATE as per requirements
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [formData, setFormData] = useState({
    department_id: '',
    role_id: '',
    permission_tier: ''
  });

  // Fetch vessel name from tenants table
  useEffect(() => {
    if (!isOpen || !activeTenantId) return;
    (async () => {
      const { data, error } = await supabase?.from('tenants')?.select('name')?.eq('id', activeTenantId)?.single();
      if (error) {
        console.error('Error fetching vessel name:', error);
      } else {
        setVesselName(data?.name || '');
      }
    })();
  }, [isOpen, activeTenantId]);

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

  const generateToken = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte?.toString(16)?.padStart(2, '0'))?.join('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setExistingInvite(null);
    setLoading(true);

    console.log('Creating invite...');

    try {
      // Validate inputs
      if (!email || !formData?.department_id || !formData?.role_id) {
        throw new Error('Please fill in all required fields');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex?.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Get current user
      const user = session?.user;
      if (!user) {
        throw new Error('Not authenticated');
      }

      if (!activeTenantId) {
        throw new Error('No active tenant found');
      }

      // Check for existing pending invite with same email
      const { data: existingInvites, error: checkError } = await supabase
        ?.from('crew_invites')
        ?.select('*')
        ?.eq('tenant_id', activeTenantId)
        ?.eq('email', email?.toLowerCase()?.trim())
        ?.eq('status', 'PENDING');

      if (checkError) {
        console.error('Error checking existing invites:', checkError);
        throw new Error('Failed to check existing invites: ' + (checkError?.message || 'Unknown error'));
      }

      if (existingInvites && existingInvites?.length > 0) {
        setExistingInvite(existingInvites?.[0]);
        throw new Error(`An invite for ${email} is already pending.`);
      }

      // Generate secure token
      const token = generateToken();

      // Derive invited_role from permission tier for backward compatibility
      let invitedRole = 'CREW'; // Default
      if (formData?.permission_tier === 'COMMAND') {
        invitedRole = 'CHIEF'; // COMMAND can't be invited, use CHIEF
      } else if (formData?.permission_tier === 'CHIEF') {
        invitedRole = 'CHIEF';
      } else if (formData?.permission_tier === 'HOD') {
        invitedRole = 'HOD';
      } else {
        invitedRole = 'CREW';
      }

      // Find selected department and role objects to get labels
      const selectedDepartment = departments?.find(d => d?.id === formData?.department_id);
      const selectedRole = roles?.find(r => r?.id === formData?.role_id);

      if (!selectedDepartment || !selectedRole) {
        throw new Error('Selected department or role not found');
      }

      // Insert into crew_invites table with ALL required fields including labels
      const { data: inviteData, error: insertError } = await supabase
        ?.from('crew_invites')
        ?.insert({
          email: email?.toLowerCase()?.trim(),
          tenant_id: activeTenantId,
          department_id: formData?.department_id, // uuid
          role_id: formData?.role_id, // uuid
          department_label: selectedDepartment?.name, // text label
          role_label: selectedRole?.name, // text label
          permission_tier: formData?.permission_tier, // text (COMMAND/CHIEF/HOD/CREW)
          status: 'PENDING',
          invited_role: invitedRole, // For backward compatibility
          token: token,
          invited_by: user?.id,
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)?.toISOString(),
        })
        ?.select()
        ?.single();

      if (insertError) {
        console.error('Error creating invite:', insertError);
        // Display the real Supabase error message
        throw new Error(insertError?.message || 'Failed to create invite');
      }

      console.log('Invite created', inviteData?.id);

      // Store invite details for confirmation panel
      setCreatedInviteId(inviteData?.id);
      setCreatedInviteToken(inviteData?.token);
      setCreatedInviteEmail(email?.toLowerCase()?.trim());
      
      // Generate invite link
      const baseUrl = window?.location?.origin;
      const link = `${baseUrl}/invite-accept?token=${token}`;
      setInviteLink(link);

      // Show success toast
      showToast('Invite created', 'success');

      // Show success confirmation panel
      setShowSuccess(true);

      // Call onSuccess to refresh parent list (Pending Invites)
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Error in handleSubmit:', err);
      // Display the real error message inside the modal
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
    setDepartments([]);
    setRoles([]);
    onClose();
  };

  const handleDone = () => {
    handleCloseModal();
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
    // Build mailto URL for the anchor link
    const name = undefined; // Not collected, will use "there" as fallback
    const vessel = vesselName?.trim() ? vesselName?.trim() : "your vessel";
    const subject = `Cargo Invite — M/Y ${vessel}`;
    const body =
`Hi ${name?.trim() ? name?.trim() : "there"},

You've been invited to join Cargo for M/Y ${vessel}.

Cargo is the vessel's shared operational platform used to manage inventory visibility, crew information, provisioning records, and departmental workflows across the vessel.

Please use the link below to create your account and access the vessel workspace:

Join Cargo → ${inviteLink}

Once logged in, please complete your crew profile and review the relevant sections for your department.

If you experience any access issues, please contact the vessel.

Kind regards,

M/Y ${vessel}

`;
    const mailtoUrl = `mailto:${encodeURIComponent(createdInviteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

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
              {inviteLink ? (
                <a
                  href={mailtoUrl}
                  target="_self"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-smooth border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground w-full"
                  style={{ pointerEvents: 'auto', zIndex: 70 }}
                >
                  <Icon name="Mail" size={16} className="mr-2" />
                  Compose Email
                </a>
              ) : (
                <button
                  disabled
                  className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-smooth border border-border bg-background text-foreground opacity-50 cursor-not-allowed w-full"
                  onClick={() => alert('Invite link not available yet.')}
                >
                  <Icon name="Mail" size={16} className="mr-2" />
                  Compose Email
                </button>
              )}
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
              disabled={loading || !email || !formData?.department_id || !formData?.role_id}
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