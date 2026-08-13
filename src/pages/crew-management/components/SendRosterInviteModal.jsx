import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { inviteRosterCrewMember } from '../../../utils/crewInvites';
import './send-roster-invite-modal.css';

/**
 * Give a crew member who was added without an email their login.
 *
 * The invite is created against their existing record, so everything already
 * logged against them — rota, jobs, hours of rest, documents — is waiting for
 * them when they accept, rather than starting a second, empty account.
 *
 * @param {object} member - a crew row from the crew-management list
 */
const SendRosterInviteModal = ({ member, onClose, onSent }) => {
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null); // { link, emailFailed }
  const [copied, setCopied] = useState(false);

  if (!member) return null;

  const firstName = String(member.fullName || '').trim().split(/\s+/)[0] || 'They';

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const { inviteLink, error: inviteError, emailError } = await inviteRosterCrewMember({
        userId: member.user_id,
        email: email.trim(),
        tenantId: activeTenantId,
        invitedBy: session?.user?.id,
        departmentId: member.departmentId || null,
        departmentLabel: member.department === '—' ? '' : member.department,
        roleId: member.roleId || null,
        customRoleId: member.customRoleId || null,
        roleLabel: member.roleTitle === 'No role' ? '' : member.roleTitle,
        permissionTier: member.tier || 'CREW',
        firstName: member.fullName || null,
        startDate: member.start_date || null,
      });
      if (inviteError) throw new Error(inviteError?.message || 'Failed to create the invite.');

      showToast(emailError ? 'Invite created — email didn’t send' : 'Invite sent', emailError ? 'error' : 'success');
      setSent({ link: inviteLink, emailFailed: !!emailError });
      if (onSent) onSent();
    } catch (err) {
      console.error('[SEND_ROSTER_INVITE] failed:', err);
      setError(err?.message || 'Failed to send the invite.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(sent?.link);
      setCopied(true);
      showToast('Invite link copied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Couldn’t copy — select and copy the link manually', 'error');
    }
  };

  if (sent) {
    return (
      <ModalShell onClose={onClose} panelClassName="sri-panel">
        <div className="sri-success">
          <div className={`sri-tick ${sent.emailFailed ? 'warn' : 'ok'}`}>
            <Icon name={sent.emailFailed ? 'AlertTriangle' : 'MailCheck'} size={24} />
          </div>
          <h2>{sent.emailFailed ? 'Invite created' : 'Invite sent'}</h2>
          <p className="sri-lead">
            {sent.emailFailed
              ? <>The invite is ready but the email didn’t send. Share the link below with {firstName} instead.</>
              : <>We’ve emailed <b>{email.trim().toLowerCase()}</b>. Once {firstName} sets a password, their existing crew record becomes their account — nothing is lost.</>}
          </p>

          <div className="sri-linklabel">Invite link</div>
          <div className="sri-linkrow">
            <input type="text" value={sent.link || ''} readOnly onFocus={(e) => e.target.select()} />
            <button type="button" className={`sri-copy${copied ? ' done' : ''}`} onClick={handleCopy}>
              <Icon name={copied ? 'Check' : 'Copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button type="button" className="sri-btn primary" onClick={onClose}>Done</button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} isDirty={!!email.trim()} isBusy={loading} panelClassName="sri-panel">
      <div className="sri-head">
        <div>
          <div className="sri-eyebrow">Crew</div>
          <h2>Invite {member.fullName}</h2>
        </div>
        <button type="button" className="sri-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      </div>

      <form onSubmit={handleSubmit} className="sri-body">
        {error && <div className="sri-err"><Icon name="AlertCircle" size={16} /> <span>{error}</span></div>}

        <div className="sri-who">
          <span className="sri-role">{member.roleTitle}</span>
          <span className="sri-sep">·</span>
          <span>{member.department === '—' ? 'Unassigned' : member.department}</span>
        </div>

        <label className="sri-field">
          <span className="sri-label">Email <span className="req">*</span></span>
          <input
            className="sri-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="crew@example.com"
            autoFocus
          />
          <span className="sri-hint">
            {firstName} keeps the record they already have — rota, jobs, hours of rest and documents
            all carry over into the account.
          </span>
        </label>

        <div className="sri-foot">
          <button type="button" className="sri-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="sri-btn primary" disabled={loading || !email.trim()}>
            {loading ? <><LogoSpinner size={15} /> Sending…</> : <><Icon name="Send" size={15} /> Send invite</>}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default SendRosterInviteModal;
