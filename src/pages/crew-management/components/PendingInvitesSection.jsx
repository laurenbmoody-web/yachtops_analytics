import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import { sendCrewInvite } from '../../../utils/crewInvites';

const PendingInvitesSection = ({ refreshTrigger }) => {
  const { activeTenantId } = useTenant();
  const { session } = useAuth();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState(null);

  // Per-row sending state — tracks which invite is currently being emailed
  const [sendingInviteId, setSendingInviteId] = useState(null);
  const [nudgingInviteId, setNudgingInviteId] = useState(null);

  // Fetch current user's role
  useEffect(() => {
    const fetchCurrentUserRole = async () => {
      if (!session?.user?.id || !activeTenantId) {
        setCurrentUserRole(null);
        return;
      }
      try {
        const { data, error: roleError } = await supabase
          ?.from('tenant_members')
          ?.select('role')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('user_id', session?.user?.id)
          ?.single();
        if (roleError) {
          console.error('[PENDING_INVITES] Error fetching current user role:', roleError);
          setCurrentUserRole(null);
          return;
        }
        setCurrentUserRole(data?.role);
      } catch (err) {
        console.error('[PENDING_INVITES] Failed to fetch current user role:', err);
        setCurrentUserRole(null);
      }
    };
    fetchCurrentUserRole();
  }, [session?.user?.id, activeTenantId]);

  useEffect(() => {
    if (activeTenantId) {
      loadInvites();
    }
  }, [activeTenantId, refreshTrigger]);

  const loadInvites = async () => {
    try {
      setLoading(true);
      setError('');
      if (!activeTenantId) throw new Error('No active tenant found');

      const { data, error: invitesError } = await supabase
        ?.from('crew_invites')
        ?.select(`
          *,
          role:role_id(name),
          department:departments(name)
        `)
        ?.eq('tenant_id', activeTenantId)
        ?.eq('status', 'PENDING')
        ?.order('created_at', { ascending: false });

      if (invitesError) {
        console.error('[PENDING_INVITES] Fetch error:', invitesError);
        throw new Error('Failed to load pending invites: ' + (invitesError?.message || 'Unknown error'));
      }

      setInvites(data || []);
    } catch (err) {
      console.error('[PENDING_INVITES] Error:', err);
      setError(err?.message || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = (token) => {
    const baseUrl = window?.location?.origin;
    const link = `${baseUrl}/invite-accept?token=${token}`;
    navigator?.clipboard?.writeText(link);
    showToast('Invite link copied', 'success');
  };

  // Send initial invite email
  const handleSendEmail = async (invite) => {
    setSendingInviteId(invite?.id);
    const { error: sendError } = await sendCrewInvite(invite?.id);
    if (sendError) {
      showToast(sendError?.message || 'Failed to send invite email', 'error');
    } else {
      showToast('Invite email sent', 'success');
    }
    setSendingInviteId(null);
  };

  // Send reminder email (nudge) — updates nudge tracking then sends via Resend
  const handleNudge = async (invite) => {
    setNudgingInviteId(invite?.id);
    try {
      // Update nudge tracking
      const { error: updateError } = await supabase
        ?.from('crew_invites')
        ?.update({
          last_nudged_at: new Date()?.toISOString(),
          nudge_count: (invite?.nudge_count || 0) + 1,
        })
        ?.eq('id', invite?.id);

      if (updateError) {
        console.error('[PENDING_INVITES] Nudge tracking update error:', updateError);
        showToast(updateError?.message || 'Failed to update nudge tracking', 'error');
        setNudgingInviteId(null);
        return;
      }

      // Send the reminder email via Resend
      const { error: sendError } = await sendCrewInvite(invite?.id);
      if (sendError) {
        showToast(sendError?.message || 'Failed to send reminder email', 'error');
      } else {
        showToast('Reminder sent', 'success');
        await loadInvites(); // Refresh to show updated nudge count
      }
    } catch (err) {
      console.error('[PENDING_INVITES] Nudge error:', err);
      showToast(err?.message || 'Failed to send reminder', 'error');
    } finally {
      setNudgingInviteId(null);
    }
  };

  const handleRevoke = async (inviteId) => {
    if (!window.confirm('Revoke this invite? The recipient will no longer be able to accept it.')) {
      return;
    }
    try {
      const { error: revokeError } = await supabase
        ?.from('crew_invites')
        ?.update({ status: 'REVOKED' })
        ?.eq('id', inviteId);

      if (revokeError) {
        console.error('[PENDING_INVITES] Revoke error:', revokeError);
        showToast('Failed to revoke invite: ' + (revokeError?.message || 'Unknown error'), 'error');
        return;
      }
      loadInvites();
    } catch (err) {
      console.error('[PENDING_INVITES] Error revoking:', err);
      showToast('Failed to revoke invite: ' + (err?.message || 'Unknown error'), 'error');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

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
                      {/* Send invite email */}
                      {isCommandUser ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSendEmail(invite)}
                          title="Send invite email"
                          disabled={sendingInviteId === invite?.id}
                        >
                          {sendingInviteId === invite?.id
                            ? <Icon name="Loader2" size={16} className="animate-spin" />
                            : <Icon name="Mail" size={16} />
                          }
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled title="Only COMMAND users can send emails">
                          <Icon name="Mail" size={16} className="opacity-40" />
                        </Button>
                      )}

                      {/* Copy link */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyLink(invite?.token)}
                        title="Copy invite link"
                      >
                        <Icon name="Copy" size={16} />
                      </Button>

                      {/* Nudge (reminder email) */}
                      {isCommandUser ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleNudge(invite)}
                          title="Send reminder email"
                          className="text-primary hover:text-primary/80"
                          disabled={nudgingInviteId === invite?.id}
                        >
                          {nudgingInviteId === invite?.id ? 'Sending…' : 'Nudge'}
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

                      {/* Revoke */}
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
                        <Button variant="ghost" size="sm" disabled title="Only COMMAND users can revoke invites">
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
  );
};

export default PendingInvitesSection;
