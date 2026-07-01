import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { showToast } from '../../../utils/toast';
import { createCrewInvite, sendCrewInvite } from '../../../utils/crewInvites';
import ModalShell from '../../../components/ui/ModalShell';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import './invite-crew-modal.css';

const InviteCrewModal = ({ isOpen, onClose, onSuccess }) => {
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [inviteeName, setInviteeName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [emailStatus, setEmailStatus] = useState('sent'); // 'sent' | 'failed'
  const [copied, setCopied] = useState(false);
  const [createdInviteId, setCreatedInviteId] = useState(null);
  const [createdInviteEmail, setCreatedInviteEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [customRoleName, setCustomRoleName] = useState('');
  const [formData, setFormData] = useState({ department_id: '', role_id: '', permission_tier: '' });

  // Departments catalog on open.
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const { data, error: deptErr } = await supabase?.from('departments')?.select('id,name')?.order('name', { ascending: true });
      if (deptErr) { console.error('departments query error:', deptErr); setError(`Unable to load departments. ${deptErr?.message}`); }
      setDepartments(data || []);
    })();
  }, [isOpen]);

  // Roles when a department is chosen — global roles ∪ this tenant's custom roles.
  useEffect(() => {
    if (!isOpen || !formData?.department_id || !activeTenantId) { setRoles([]); return; }
    (async () => {
      const [{ data: globalRoles, error: gErr }, { data: customRoles, error: cErr }] = await Promise.all([
        supabase.from('roles').select('id,name,default_permission_tier').eq('department_id', formData.department_id).order('name', { ascending: true }),
        supabase.from('tenant_custom_roles').select('id,name,default_permission_tier').eq('tenant_id', activeTenantId).eq('department_id', formData.department_id).order('name', { ascending: true }),
      ]);
      if (gErr || cErr) { console.error('roles query error:', gErr || cErr); setError(`Unable to load roles. ${(gErr || cErr)?.message}`); setRoles([]); return; }
      setRoles([
        ...(globalRoles || []).map((r) => ({ ...r, source: 'global' })),
        ...(customRoles || []).map((r) => ({ ...r, source: 'custom' })),
      ]);
    })();
  }, [isOpen, formData?.department_id, activeTenantId]);

  // Auto-fill the permission tier from the chosen role ("Other" defaults to CREW).
  useEffect(() => {
    if (formData?.role_id === '__other__') { setFormData((p) => ({ ...p, permission_tier: 'CREW' })); return; }
    if (formData?.role_id) {
      const sel = roles?.find((r) => r?.id === formData?.role_id);
      setFormData((p) => ({ ...p, permission_tier: sel?.default_permission_tier || 'CREW' }));
    } else {
      setFormData((p) => ({ ...p, permission_tier: '' }));
    }
  }, [formData?.role_id, roles]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!inviteeName || !email || !formData?.department_id || !formData?.role_id) throw new Error('Please fill in all required fields.');
      if (formData?.role_id === '__other__' && !customRoleName.trim()) throw new Error('Please enter a role name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');

      const user = session?.user;
      if (!user) throw new Error('Not authenticated.');
      if (!activeTenantId) throw new Error('No active tenant found.');

      const selectedDepartment = departments?.find((d) => d?.id === formData?.department_id);
      if (!selectedDepartment) throw new Error('Selected department not found.');

      // Resolve role → global id, custom id, or upsert a new "Other" custom role.
      let resolvedRoleId = null, resolvedCustomRoleId = null, resolvedRoleLabel = '', resolvedTier = formData?.permission_tier || 'CREW';
      if (formData?.role_id === '__other__') {
        const { data: upserted, error: upErr } = await supabase
          .from('tenant_custom_roles')
          .upsert({ tenant_id: activeTenantId, department_id: formData.department_id, name: customRoleName.trim(), default_permission_tier: 'CREW', created_by: user.id }, { onConflict: 'tenant_id,department_id,name' })
          .select('id, name, default_permission_tier').single();
        if (upErr) throw new Error(upErr?.message || 'Failed to create custom role.');
        resolvedCustomRoleId = upserted?.id; resolvedRoleLabel = upserted?.name; resolvedTier = upserted?.default_permission_tier || 'CREW';
      } else {
        const sel = roles?.find((r) => r?.id === formData?.role_id);
        if (!sel) throw new Error('Selected role not found.');
        resolvedRoleLabel = sel?.name;
        if (sel?.source === 'custom') resolvedCustomRoleId = sel.id; else resolvedRoleId = sel.id;
      }

      const { data: inviteData, inviteLink: link, error: inviteError } = await createCrewInvite({
        email, tenantId: activeTenantId, invitedBy: user.id,
        departmentId: formData.department_id, departmentLabel: selectedDepartment.name,
        roleId: resolvedRoleId, customRoleId: resolvedCustomRoleId, roleLabel: resolvedRoleLabel,
        permissionTier: resolvedTier, firstName: inviteeName.trim() || null, startDate: startDate || null,
      });
      if (inviteError) throw new Error(inviteError?.message || 'Failed to create invite.');

      setCreatedInviteId(inviteData?.id);
      setCreatedInviteEmail(email.toLowerCase().trim());
      setInviteLink(link);

      // Send the email right away — invite + notify in one action.
      const { error: sendError } = await sendCrewInvite(inviteData?.id);
      setEmailStatus(sendError ? 'failed' : 'sent');
      showToast(sendError ? 'Invite created — email didn’t send' : 'Invite sent', sendError ? 'error' : 'success');

      setShowSuccess(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Invite submit failed:', err);
      setError(err?.message || 'Failed to send invite.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try { await navigator.clipboard?.writeText(inviteLink); setCopied(true); showToast('Invite link copied', 'success'); setTimeout(() => setCopied(false), 2000); }
    catch { showToast('Couldn’t copy — select and copy the link manually', 'error'); }
  };

  const handleResend = async () => {
    if (!createdInviteId) return;
    setSendingEmail(true);
    const { error: sendError } = await sendCrewInvite(createdInviteId);
    setEmailStatus(sendError ? 'failed' : 'sent');
    showToast(sendError ? (sendError.message || 'Failed to send invite email') : 'Invite email sent', sendError ? 'error' : 'success');
    setSendingEmail(false);
  };

  const reset = () => {
    setInviteeName(''); setEmail(''); setCustomRoleName(''); setStartDate('');
    setFormData({ department_id: '', role_id: '', permission_tier: '' });
    setError(''); setInviteLink(''); setShowSuccess(false); setEmailStatus('sent'); setCopied(false);
    setCreatedInviteId(null); setCreatedInviteEmail(''); setSendingEmail(false);
    setDepartments([]); setRoles([]);
    onClose();
  };

  const firstName = (inviteeName || '').trim().split(/\s+/)[0] || 'them';
  const isDirty = !showSuccess && (inviteeName.trim() || email.trim() || startDate || customRoleName.trim() || formData.department_id || formData.role_id);
  const canSubmit = inviteeName && email && formData.department_id && formData.role_id && !(formData.role_id === '__other__' && !customRoleName.trim());

  // ---- success / result ----
  if (showSuccess) {
    const ok = emailStatus === 'sent';
    return (
      <ModalShell onClose={reset} isBusy={sendingEmail} panelClassName="ic-panel">
        <div className="ic-success">
          <div className={`ic-tick ${ok ? 'ok' : 'warn'}`}>
            <Icon name={ok ? 'MailCheck' : 'AlertTriangle'} size={24} />
          </div>
          <h2>{ok ? 'Invite sent' : 'Invite created'}</h2>
          <p className="lead">
            {ok
              ? <>We’ve emailed <b>{createdInviteEmail}</b> an invite to join. The link stays valid for 14 days.</>
              : <>The invite is ready, but the email didn’t send. Copy the link below to share it, or try resending.</>}
          </p>

          <div className="ic-linklabel">Invite link</div>
          <div className="ic-linkrow">
            <input type="text" value={inviteLink} readOnly onFocus={(e) => e.target.select()} />
            <button type="button" className={`ic-copy${copied ? ' done' : ''}`} onClick={handleCopyLink}>
              <Icon name={copied ? 'Check' : 'Copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="ic-success-acts">
            <button type="button" className="ic-btn ghost" onClick={handleResend} disabled={sendingEmail}>
              {sendingEmail ? 'Sending…' : (ok ? 'Resend email' : 'Try again')}
            </button>
            <button type="button" className="ic-btn primary" onClick={reset}>Done</button>
          </div>
        </div>
      </ModalShell>
    );
  }

  // ---- form ----
  const departmentPicked = !!formData.department_id;
  return (
    <ModalShell onClose={reset} isDirty={isDirty} isBusy={loading} panelClassName="ic-panel">
      <div className="ic-head">
        <div>
          <div className="ic-eyebrow">Crew</div>
          <h2>Invite a crew member</h2>
        </div>
        <button type="button" className="ic-x" onClick={reset} aria-label="Close"><Icon name="X" size={16} /></button>
      </div>

      <form onSubmit={handleSubmit} className="ic-body">
        {error && (
          <div className="ic-err"><Icon name="AlertCircle" size={16} /> <span>{error}</span></div>
        )}

        <label className="ic-field">
          <span className="ic-label">Name <span className="req">*</span></span>
          <input className="ic-input" type="text" value={inviteeName} onChange={(e) => setInviteeName(e.target.value)} placeholder="e.g. Jane Smith" />
        </label>

        <label className="ic-field">
          <span className="ic-label">Email <span className="req">*</span></span>
          <input className="ic-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="crew@example.com" />
        </label>

        <label className="ic-field">
          <span className="ic-label">Department <span className="req">*</span></span>
          <select
            className={`ic-select${formData.department_id ? '' : ' placeholder'}`}
            value={formData.department_id}
            onChange={(e) => setFormData((p) => ({ ...p, department_id: e.target.value, role_id: '' }))}
          >
            <option value="">Select department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>

        <label className="ic-field">
          <span className="ic-label">Role <span className="req">*</span></span>
          <select
            className={`ic-select${formData.role_id ? '' : ' placeholder'}`}
            value={formData.role_id}
            disabled={!departmentPicked}
            onChange={(e) => { const v = e.target.value; setFormData((p) => ({ ...p, role_id: v })); if (v !== '__other__') setCustomRoleName(''); }}
          >
            <option value="">{departmentPicked ? 'Select role' : 'Pick a department first'}</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.source === 'custom' ? `${r.name} (Custom)` : r.name}</option>)}
            {departmentPicked && <option value="__other__">Other…</option>}
          </select>
          {formData.role_id === '__other__' && (
            <input className="ic-input" style={{ marginTop: 8 }} type="text" value={customRoleName} onChange={(e) => setCustomRoleName(e.target.value)} placeholder="New role name" />
          )}
        </label>

        {formData.permission_tier && (
          <div className="ic-field">
            <span className="ic-label">Access level</span>
            <span className="ic-tier"><Icon name="Shield" size={13} /> <b>{formData.permission_tier}</b> · set by the role</span>
          </div>
        )}

        <div className="ic-field">
          <span className="ic-label">Start date <span className="opt">optional</span></span>
          <EditorialDatePicker value={startDate} onChange={setStartDate} placeholder="dd/mm/yyyy" />
          <span className="ic-hint">Set a future date and they’ll show as “Invited” until then.</span>
        </div>

        <div className="ic-foot">
          <button type="button" className="ic-btn ghost" onClick={reset}>Cancel</button>
          <button type="submit" className="ic-btn primary" disabled={loading || !canSubmit}>
            {loading ? <><LogoSpinner size={15} /> Sending…</> : <><Icon name="Send" size={15} /> Send invite</>}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default InviteCrewModal;
