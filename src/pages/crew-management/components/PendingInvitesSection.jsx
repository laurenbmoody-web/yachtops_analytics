import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
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
          custom_role:custom_role_id(name),
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
    return date?.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isCommandUser = currentUserRole === 'COMMAND';

  if (loading) {
    return (
      <div className="cm-section">
        <div className="cm-sec-head">
          <span className="cm-sec-name">Pending invites</span>
          <span className="cm-sec-rule" />
        </div>
        <p className="cm-sec-sub">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cm-section">
        <div className="cm-sec-head">
          <span className="cm-sec-name">Pending invites</span>
          <span className="cm-sec-rule" />
        </div>
        <div className="cm-empty"><Icon name="AlertCircle" size={26} /><p>{error}</p></div>
      </div>
    );
  }

  const count = invites?.length || 0;

  return (
    <div className="cm-section">
      <div className="cm-sec-head">
        <span className="cm-sec-name">Pending invites</span>
        <span className="cm-sec-rule" />
        <span className="cm-sec-meta">{count} awaiting</span>
      </div>
      {count > 0 && (
        <>
          <p className="cm-sec-sub">Crew invitations that haven't been accepted yet.</p>
          <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>Status</th>
                <th className="cm-th-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites?.map((invite) => (
                <tr key={invite?.id}>
                  <td className="cm-cell-ink">{invite?.email}</td>
                  <td className="cm-cell-ink">
                    {(() => {
                      const roleName = invite?.role?.name || invite?.custom_role?.name || invite?.role_label;
                      const deptName = invite?.department?.name || invite?.department_label;
                      if (roleName || deptName) {
                        return `${roleName || '—'} (${deptName || '—'})`;
                      }
                      return invite?.job_title_label || invite?.invited_role || '—';
                    })()}
                  </td>
                  <td className="cm-cell-mut">{formatDate(invite?.created_at)}</td>
                  <td>
                    <span className="cm-pill cm-pill-status">
                      <span className="cm-dot s-invited" />
                      {invite?.status || 'Pending'}
                    </span>
                  </td>
                  <td>
                    <div className="cm-acts">
                      {/* Send invite email */}
                      {isCommandUser ? (
                        <button className="cm-iconbtn" onClick={() => handleSendEmail(invite)} title="Send invite email" disabled={sendingInviteId === invite?.id}>
                          {sendingInviteId === invite?.id ? <LogoSpinner size={16} /> : <Icon name="Mail" size={16} />}
                        </button>
                      ) : (
                        <button className="cm-iconbtn" disabled title="Only COMMAND users can send emails" style={{ opacity: 0.4 }}>
                          <Icon name="Mail" size={16} />
                        </button>
                      )}

                      {/* Copy link */}
                      <button className="cm-iconbtn" onClick={() => handleCopyLink(invite?.token)} title="Copy invite link">
                        <Icon name="Copy" size={16} />
                      </button>

                      {/* Nudge (reminder email) */}
                      {isCommandUser ? (
                        <button
                          className="cm-iconbtn"
                          onClick={() => handleNudge(invite)}
                          title="Send reminder email"
                          disabled={nudgingInviteId === invite?.id}
                          style={{ width: 'auto', padding: '0 10px', fontWeight: 600, fontSize: '12px' }}
                        >
                          {nudgingInviteId === invite?.id ? 'Sending…' : 'Nudge'}
                        </button>
                      ) : (
                        <button className="cm-iconbtn" disabled title="Only COMMAND users can nudge invites" style={{ width: 'auto', padding: '0 10px', fontWeight: 600, fontSize: '12px', opacity: 0.4 }}>
                          Nudge
                        </button>
                      )}

                      {/* Revoke */}
                      {isCommandUser ? (
                        <button className="cm-iconbtn" onClick={() => handleRevoke(invite?.id)} title="Revoke invite">
                          <Icon name="Trash2" size={16} />
                        </button>
                      ) : (
                        <button className="cm-iconbtn" disabled title="Only COMMAND users can revoke invites" style={{ opacity: 0.4 }}>
                          <Icon name="Trash2" size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
};

export default PendingInvitesSection;
