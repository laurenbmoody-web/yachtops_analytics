import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
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
  const [expanded, setExpanded] = useState(false);

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

  const count = invites?.length || 0;
  // Disappears entirely when there's nothing pending (or while loading / on error).
  if (loading || error || count === 0) return null;

  const AVPAL = ['#6B8A5E', '#7A6F8C', '#4A5A6E', '#A86F5E', '#2D5B6E', '#9C8BA8'];
  const initialsOf = (name) => {
    const src = String(name || '?').includes('@') ? String(name).split('@')[0] : String(name || '?');
    const parts = src.split(/[.\-_\s]+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
    return (s || '?').toUpperCase();
  };
  const now = new Date();

  return (
    <div className="cm-pi-wrap">
      <div className="cm-pi">
        <span className="cm-pi-env"><Icon name="Mail" size={14} /></span>
        <span className="cm-pi-cnt">{count}</span>
        <span className="cm-pi-lead">Invite{count === 1 ? '' : 's'} issued</span>
        <span className="cm-pi-avs">
          {invites.slice(0, 4).map((v, i) => <span key={v.id} className="cm-pi-av" style={{ background: AVPAL[i % AVPAL.length] }}>{initialsOf(v.email)}</span>)}
          {count > 4 && <span className="cm-pi-av cm-pi-avmore">+{count - 4}</span>}
        </span>
        <button type="button" className="cm-pi-more" onClick={() => setExpanded((x) => !x)}>{expanded ? 'Hide ▴' : 'Manage →'}</button>
      </div>
      {expanded && (
        <div className="cm-pi-detail">
          <div className="cm-pi-list">
            {invites.map((invite, idx) => {
              const nm = invite?.invitee_name || null;
              const roleName = invite?.role?.name || invite?.custom_role?.name || invite?.role_label || invite?.job_title_label;
              const deptName = invite?.department?.name || invite?.department_label;
              const sent = !!invite?.email_sent_at;
              const failed = !!invite?.email_send_error;
              const exp = invite?.expires_at ? new Date(invite.expires_at) : null;
              const days = exp ? Math.ceil((exp - now) / 86400000) : null;
              const expired = days != null && days < 0;
              // one-word status
              let st, stLabel;
              if (failed) { st = 'fail'; stLabel = 'Send failed'; }
              else if (expired) { st = 'exp'; stLabel = 'Expired'; }
              else if (!sent) { st = 'notsent'; stLabel = 'Not sent'; }
              else if (days != null && days <= 3) { st = 'soon'; stLabel = 'Expiring soon'; }
              else { st = 'await'; stLabel = 'Awaiting'; }
              // one-fact meta (expiry / failure)
              let meta = ''; let metaWarn = false;
              if (failed) { meta = 'Couldn’t send'; metaWarn = true; }
              else if (expired) { meta = 'Expired'; metaWarn = true; }
              else if (days != null) { meta = `Expires in ${days}d`; metaWarn = days <= 3; }
              // detail on hover
              const reminders = (invite?.nudge_count || 0) + (invite?.resent_count || 0);
              const tip = [
                sent ? `Sent ${formatDate(invite.email_sent_at)}` : 'Not emailed yet',
                reminders ? `reminded ${reminders}×` : null,
                invite?.start_date ? `joins ${formatDate(invite.start_date)}` : null,
              ].filter(Boolean).join(' · ');
              // adaptive primary action
              const busy = sendingInviteId === invite?.id || nudgingInviteId === invite?.id;
              const doSend = !sent || failed;
              const primaryLabel = busy ? 'Sending…' : failed ? 'Retry send' : !sent ? 'Send' : 'Remind';
              return (
                <div className="cm-pi-inv" key={invite?.id}>
                  <span className="cm-pi-av2" style={{ background: AVPAL[idx % AVPAL.length] }}>{initialsOf(nm || invite?.email)}</span>
                  <div className="cm-pi-who">
                    <div className="cm-pi-nm">{nm || invite?.email}</div>
                    {nm && <div className="cm-pi-em">{invite?.email}</div>}
                  </div>
                  <div className="cm-pi-role">
                    <div className="cm-pi-rl">{roleName || '—'}</div>
                    {deptName && <div className="cm-pi-dp">{deptName}</div>}
                  </div>
                  <div className="cm-pi-status"><span className={`cm-pi-st st-${st}`} title={tip}><span className="d" />{stLabel}</span></div>
                  <div className={`cm-pi-exp${metaWarn ? ' warn' : ''}`}>{meta}</div>
                  <div className="cm-pi-acts">
                    <button type="button" className={`cm-pi-btn${doSend ? ' primary' : ''}`} onClick={() => (doSend ? handleSendEmail(invite) : handleNudge(invite))} disabled={!isCommandUser || busy} title={isCommandUser ? '' : 'COMMAND only'}>{primaryLabel}</button>
                    <button type="button" className="cm-pi-iact" title="Copy invite link" onClick={() => handleCopyLink(invite?.token)}><Icon name="Copy" size={15} /></button>
                    <button type="button" className="cm-pi-iact danger" title="Revoke invite" onClick={() => handleRevoke(invite?.id)} disabled={!isCommandUser}><Icon name="Trash2" size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingInvitesSection;
