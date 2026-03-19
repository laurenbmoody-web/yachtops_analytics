import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';

const PendingInvitesSection = ({ refreshTrigger }) => {
  const { activeTenantId } = useTenant();
  const { session } = useAuth();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [nudgingInviteId, setNudgingInviteId] = useState(null);
  
  // Confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    type: null, // 'INVITE' or 'NUDGE'
    invite: null
  });
  
  // Toast state
  const [toast, setToast] = useState({
    isVisible: false,
    message: ''
  });

  // Fetch current user's role
  useEffect(() => {
    const fetchCurrentUserRole = async () => {
      if (!session?.user?.id || !activeTenantId) {
        setCurrentUserRole(null);
        return;
      }

      try {
        const { data, error } = await supabase?.from('tenant_members')?.select('role')?.eq('tenant_id', activeTenantId)?.eq('user_id', session?.user?.id)?.single();

        if (error) {
          console.error('[PENDING_INVITES] Error fetching current user role:', error);
          setCurrentUserRole(null);
          return;
        }

        console.log('[PENDING_INVITES] Current user role:', data?.role);
        setCurrentUserRole(data?.role);
      } catch (err) {
        console.error('[PENDING_INVITES] Failed to fetch current user role:', err);
        setCurrentUserRole(null);
      }
    };

    fetchCurrentUserRole();
  }, [session?.user?.id, activeTenantId]);

  // Fetch vessel name
  useEffect(() => {
    const fetchVesselName = async () => {
      if (!activeTenantId) return;

      try {
        const { data, error } = await supabase?.from('tenants')?.select('name')?.eq('id', activeTenantId)?.single();

        if (error) {
          console.error('[PENDING_INVITES] Error fetching vessel name:', error);
        } else {
          setVesselName(data?.name || '');
        }
      } catch (err) {
        console.error('[PENDING_INVITES] Failed to fetch vessel name:', err);
      }
    };

    fetchVesselName();
  }, [activeTenantId]);

  useEffect(() => {
    if (activeTenantId) {
      loadInvites();
    }
  }, [activeTenantId, refreshTrigger]);

  const loadInvites = async () => {
    try {
      setLoading(true);
      setError('');

      if (!activeTenantId) {
        throw new Error('No active tenant found');
      }

      // Fetch ONLY PENDING invites with role and department names via JOIN
      // IMPORTANT: Explicitly specify role_id foreign key to avoid ambiguity (crew_invites has both role_id and job_title_id pointing to roles)
      const { data, error: invitesError } = await supabase?.from('crew_invites')?.select(`
          *,
          role:role_id(name),
          department:departments(name)
        `)?.eq('tenant_id', activeTenantId)?.eq('status', 'PENDING')?.order('created_at', { ascending: false });

      if (invitesError) {
        console.error('[PENDING_INVITES] Fetch error:', invitesError);
        throw new Error('Failed to load pending invites: ' + (invitesError?.message || 'Unknown error'));
      }

      console.log('[PENDING_INVITES] Loaded:', data?.length || 0, 'invites');
      setInvites(data || []);
    } catch (err) {
      console.error('[PENDING_INVITES] Error:', err);
      setError(err?.message || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = (token) => {
    console.log('Copy link clicked');
    const baseUrl = window?.location?.origin;
    const link = `${baseUrl}/invite-accept?token=${token}`;
    navigator?.clipboard?.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  // Show confirmation modal for Mail icon
  const handleEmailCompose = (invite) => {
    console.log('[PENDING_INVITES] Mail icon clicked', invite?.id);
    setConfirmationModal({
      isOpen: true,
      type: 'INVITE',
      invite: invite
    });
  };

  // Show confirmation modal for Nudge button
  const handleNudge = (invite) => {
    console.log('[PENDING_INVITES] Nudge clicked', invite?.id);
    setConfirmationModal({
      isOpen: true,
      type: 'NUDGE',
      invite: invite
    });
  };
  
  // Show toast notification
  const showToast = (message) => {
    setToast({ isVisible: true, message });
    setTimeout(() => {
      setToast({ isVisible: false, message: '' });
    }, 3000);
  };
  
  // State for mailto fallback
  const [mailtoFallback, setMailtoFallback] = useState({
    isVisible: false,
    subject: '',
    body: ''
  });
  
  // Handle confirmation modal "Open Email" button
  const handleConfirmOpenEmail = async () => {
    const { type, invite } = confirmationModal;
    
    if (!invite) return;
    
    // Generate invite link
    const baseUrl = window?.location?.origin;
    const inviteLink = `${baseUrl}/invite-accept?token=${invite?.token}`;
    const vessel = vesselName?.trim() ? `M/Y ${vesselName?.trim()}` : 'the vessel';
    
    let subjectText, bodyText;
    
    if (type === 'INVITE') {
      // INVITE EMAIL TEMPLATE
      subjectText = 'You\'ve been invited to join Cargo';
      
      bodyText = `Hi,\n\n`;
      bodyText += `You've been invited to join Cargo for ${vessel}.\n\n`;
      bodyText += `Cargo is the vessel's shared operational platform used to manage inventory visibility, crew information, provisioning records, and departmental workflows across the vessel.\n\n`;
      bodyText += `Please use the link below to create your account and access the vessel workspace:\n\n`;
      bodyText += `${inviteLink}\n\n`;
      bodyText += `Once logged in, please complete your crew profile and review the relevant sections for your department.\n\n`;
      bodyText += `If you experience any access issues, please contact the vessel.\n\n`;
      bodyText += `Kind regards,\n${vessel}`;
    } else if (type === 'NUDGE') {
      // NUDGE EMAIL TEMPLATE
      subjectText = 'Reminder — Cargo invite pending';
      
      bodyText = `Hi,\n\n`;
      bodyText += `Just a quick reminder that your Cargo invite for ${vessel} is still waiting to be accepted.\n\n`;
      bodyText += `You can join using the link below:\n\n`;
      bodyText += `${inviteLink}\n\n`;
      bodyText += `If you're having trouble accessing the link, please contact the vessel.\n\n`;
      bodyText += `Kind regards,\n${vessel}`;
      
      // Update nudge tracking ONLY for NUDGE type
      try {
        setNudgingInviteId(invite?.id);
        
        const { error: updateError } = await supabase?.from('crew_invites')?.update({ 
            last_nudged_at: new Date()?.toISOString(),
            nudge_count: (invite?.nudge_count || 0) + 1
          })?.eq('id', invite?.id);

        if (updateError) {
          console.error('[PENDING_INVITES] Nudge update error:', updateError);
          alert(updateError?.message || 'Failed to update invite');
          setNudgingInviteId(null);
          return;
        }

        console.log('[PENDING_INVITES] Invite updated with nudge tracking');
        
        // Reload invites to show updated nudge count
        await loadInvites();
        
        setNudgingInviteId(null);
      } catch (err) {
        console.error('[PENDING_INVITES] Nudge error:', err);
        alert(err?.message || 'Failed to update invite');
        setNudgingInviteId(null);
        return;
      }
    }
    
    // Build mailto URL with proper encoding
    const subject = encodeURIComponent(subjectText);
    const body = encodeURIComponent(bodyText);
    const mailtoUrl = `mailto:${invite?.email}?subject=${subject}&body=${body}`;
    
    // Try to open mailto synchronously (critical for iOS)
    let mailtoBlocked = false;
    try {
      // Primary method: direct navigation
      window.location.href = mailtoUrl;
      
      // Fallback method for some browsers
      setTimeout(() => {
        try {
          window.open(mailtoUrl, '_self');
        } catch (e) {
          console.warn('[PENDING_INVITES] window.open fallback failed:', e);
        }
      }, 100);
    } catch (e) {
      console.error('[PENDING_INVITES] mailto blocked:', e);
      mailtoBlocked = true;
    }
    
    // Close modal after mailto fires (200-400ms delay)
    setTimeout(() => {
      setConfirmationModal({ isOpen: false, type: null, invite: null });
      
      // Show success toast or fallback
      if (!mailtoBlocked) {
        showToast('Draft opened in Mail');
      } else {
        // Show fallback with copyable text
        setMailtoFallback({
          isVisible: true,
          subject: subjectText,
          body: bodyText
        });
      }
    }, 300);
  };
  
  // Handle confirmation modal "Cancel" button
  const handleCancelConfirmation = () => {
    setConfirmationModal({ isOpen: false, type: null, invite: null });
  };

  const handleRevoke = async (inviteId) => {
    if (!window.confirm('Revoke this invite? The recipient will no longer be able to accept it.')) {
      return;
    }

    try {
      const { error: revokeError } = await supabase?.from('crew_invites')?.update({ status: 'REVOKED' })?.eq('id', inviteId);

      if (revokeError) {
        console.error('[PENDING_INVITES] Revoke error:', revokeError);
        alert('Failed to revoke invite: ' + (revokeError?.message || 'Unknown error'));
        return;
      }

      console.log('[PENDING_INVITES] Invite revoked:', inviteId);
      // Reload invites (revoked invite will be filtered out)
      loadInvites();
    } catch (err) {
      console.error('[PENDING_INVITES] Error revoking:', err);
      alert('Failed to revoke invite: ' + (err?.message || 'Unknown error'));
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Check if current user is COMMAND
  const isCommandUser = currentUserRole === 'COMMAND';

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pending Invites</h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pending Invites</h2>
        <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
          <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
          <p className="text-sm text-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Pending Invites</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage crew invitations that have not yet been accepted
          </p>
        </div>
        {invites?.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            <Icon name="Mail" size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No pending invites</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-medium text-foreground">Email</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground">Role</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground">Created</th>
                  <th className="text-left p-4 text-sm font-medium text-foreground">Status</th>
                  <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites?.map((invite) => (
                  <tr key={invite?.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                    <td className="p-4 text-sm text-foreground">{invite?.email}</td>
                    <td className="p-4 text-sm text-foreground">
                      {invite?.role?.name || invite?.department?.name 
                        ? `${invite?.role?.name || '—'} (${invite?.department?.name || '—'})`
                        : invite?.job_title_label || invite?.invited_role || '—'}
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {formatDate(invite?.created_at)}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/10 text-warning">
                        {invite?.status || 'Pending'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Mail icon - visible to all, functional only for COMMAND */}
                        {isCommandUser ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEmailCompose(invite)}
                            title="Send email"
                          >
                            <Icon name="Mail" size={16} />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title="Only COMMAND users can send emails"
                          >
                            <Icon name="Mail" size={16} className="opacity-40" />
                          </Button>
                        )}
                        
                        {/* Copy link - visible to all */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyLink(invite?.token)}
                          title="Copy invite link"
                        >
                          <Icon name="Copy" size={16} />
                        </Button>
                        
                        {/* Nudge button - visible to all, functional only for COMMAND */}
                        {isCommandUser ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleNudge(invite)}
                            title="Nudge (send reminder)"
                            className="text-primary hover:text-primary/80"
                            disabled={nudgingInviteId === invite?.id}
                          >
                            {nudgingInviteId === invite?.id ? 'Sending...' : 'Nudge'}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title="Only COMMAND users can nudge invites"
                            className="opacity-40"
                          >
                            Nudge
                          </Button>
                        )}
                        
                        {/* Delete/Revoke - visible to all, functional only for COMMAND */}
                        {isCommandUser ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(invite?.id)}
                            title="Revoke invite"
                          >
                            <Icon name="Trash2" size={16} />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title="Only COMMAND users can revoke invites"
                          >
                            <Icon name="Trash2" size={16} className="opacity-40" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Confirmation Modal */}
      {confirmationModal?.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {confirmationModal?.type === 'INVITE' ? 'Send invite email?' : 'Send reminder email?'}
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will open your email app with a drafted {confirmationModal?.type === 'INVITE' ? 'invite' : 'reminder'}. You'll still need to press Send.
            </p>
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                onClick={handleCancelConfirmation}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmOpenEmail}
              >
                Open Email
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Mailto Fallback Modal */}
      {mailtoFallback?.isVisible && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <Icon name="AlertCircle" size={24} className="text-warning flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Email draft blocked
                </h3>
                <p className="text-sm text-muted-foreground">
                  Your browser blocked the email draft. Tap and hold to copy the email text below.
                </p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Subject
                </label>
                <textarea
                  readOnly
                  value={mailtoFallback?.subject}
                  className="w-full px-3 py-2 bg-muted/30 border border-border rounded-lg text-sm text-foreground font-mono resize-none"
                  rows={1}
                  onClick={(e) => e?.target?.select()}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Body
                </label>
                <textarea
                  readOnly
                  value={mailtoFallback?.body}
                  className="w-full px-3 py-2 bg-muted/30 border border-border rounded-lg text-sm text-foreground font-mono resize-none"
                  rows={12}
                  onClick={(e) => e?.target?.select()}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="primary"
                onClick={() => setMailtoFallback({ isVisible: false, subject: '', body: '' })}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {toast?.isVisible && (
        <div className="fixed bottom-6 right-6 bg-card border border-border rounded-lg shadow-lg p-4 max-w-sm z-50 animate-slide-up">
          <div className="flex items-start gap-3">
            <Icon name="Mail" size={20} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">{toast?.message}</p>
          </div>
        </div>
      )}
    </>
  );
};

export default PendingInvitesSection;