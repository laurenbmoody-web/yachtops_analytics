import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save, Plus, Trash2, Mail, RefreshCw, UserPlus, X, Crown, Shield, Clock, Zap, Paperclip, Check, FileText } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { usePermission, useTier, hasClientPermission } from '../../../contexts/SupplierPermissionContext';
import {
  updateSupplierProfile,
  updateSupplierStorefront,
  fetchMySupplierReviews,
  fetchMyCertifications,
  saveMyCertifications,
  uploadCertDoc,
  requestCertReview,
  fetchAliases,
  addAlias,
  resendAliasVerification,
  deleteAlias,
  fetchTeamMembers,
  fetchPendingInvites,
  createInvite,
  revokeInvite,
  nudgeInvite,
  removeMember,
  updateMemberTier,
  requestOwnershipTransfer,
} from '../utils/supplierStorage';
import { getSupplierTier } from '../../../components/SupplierRoleGuard';
import InvoicingSettings from '../components/InvoicingSettings';
import './storefront-preview.css';

// Tab order per spec. adminOnly tabs are hidden from managers.
const ALL_TABS = [
  { slug: 'company',       label: 'Company profile',    adminOnly: false },
  { slug: 'storefront',    label: 'Storefront',          adminOnly: false },
  { slug: 'team',          label: 'Team & permissions',  adminOnly: false },
  { slug: 'zones',         label: 'Delivery zones',      adminOnly: false },
  { slug: 'tax',           label: 'Tax & invoicing',     adminOnly: false },
  { slug: 'payment',       label: 'Payment & banking',   adminOnly: true  },
  { slug: 'documents',     label: 'Documents & legal',   adminOnly: true  },
  { slug: 'integrations',  label: 'Integrations',        adminOnly: true  },
  { slug: 'notifications', label: 'Notifications',       adminOnly: false },
];

const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? '').trim());

// ─── Team section ──────────────────────────────────────────────────────────

const TIER_PILL_STYLES = {
  OWNER:   { background: '#1C2340', color: '#FFFFFF' },
  ADMIN:   { background: '#FDECE2', color: '#B4551A', border: '1px solid #E9BE9E' },
  MEMBER:  { background: 'var(--chip-bg)', color: 'var(--muted-strong)' },
  FINANCE: { background: '#E0F4F2', color: '#0F766E', border: '1px solid #B8E0DA' },
  VIEWER:  { background: 'var(--bg-3)', color: 'var(--muted-strong)', border: '1px solid var(--line)' },
};

const initialsFromName = (name, email) => {
  const src = name?.trim() || email?.trim() || '';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const roleLabel = (role) => {
  if (!role) return null;
  return role.charAt(0).toUpperCase() + role.slice(1);
};

const TierPill = ({ tier }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 9px', borderRadius: 999, fontSize: 10.5,
    fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
    ...TIER_PILL_STYLES[tier] ?? TIER_PILL_STYLES.VIEWER,
  }}>
    {tier === 'OWNER' && <Crown size={10} />}
    {tier === 'ADMIN' && <Shield size={10} />}
    {tier}
  </span>
);

const TeamMemberRow = ({
  member, myContactId, canInvite, canRemove, isOwner,
  onChangeTier, onRemove, onTransfer,
}) => {
  const isSelf = member.id === myContactId;
  const isOwnerRow = member.permission_tier === 'OWNER';
  const showTierDropdown = canInvite && !isOwnerRow && !isSelf;
  const showRemove       = canRemove && !isOwnerRow && !isSelf;
  const showTransfer     = isOwner && !isOwnerRow && !isSelf;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px',
      border: '1px solid var(--line)', borderRadius: 8,
      background: 'var(--card)',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%',
        background: 'var(--chip-bg)', color: 'var(--muted-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}>{initialsFromName(member.name, member.email)}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
          {member.name || member.email}{isSelf && <span style={{ color: 'var(--muted-s)', fontWeight: 400 }}> · you</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted-s)' }}>{member.email}</div>
      </div>

      {member.role && (
        <span style={{
          fontSize: 11, fontWeight: 500, color: 'var(--muted-s)',
          padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6,
        }}>{roleLabel(member.role)}</span>
      )}

      <TierPill tier={member.permission_tier} />

      {showTierDropdown && (
        <select
          value={member.permission_tier}
          onChange={(e) => onChangeTier(member, e.target.value)}
          style={{
            fontSize: 12, padding: '5px 8px', borderRadius: 6,
            border: '1px solid var(--line)', background: 'var(--card)',
            color: 'var(--fg)',
          }}
        >
          <option value="ADMIN">ADMIN</option>
          <option value="MEMBER">MEMBER</option>
          <option value="FINANCE">FINANCE</option>
          <option value="VIEWER">VIEWER</option>
        </select>
      )}

      {showTransfer && (
        <button
          type="button"
          onClick={() => onTransfer(member)}
          title="Transfer ownership to this member"
          style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6,
            border: '1px solid var(--line)', background: 'var(--card)',
            color: 'var(--fg-2)', cursor: 'pointer',
          }}
        >Transfer…</button>
      )}

      {showRemove && (
        <button
          type="button"
          onClick={() => onRemove(member)}
          title="Remove from team"
          style={{
            padding: 6, borderRadius: 6, border: 'none',
            background: 'transparent', color: 'var(--muted-s)', cursor: 'pointer',
          }}
        ><Trash2 size={14} /></button>
      )}
    </div>
  );
};

const PendingInviteRow = ({ invite, supplierName, onResent, onRevoked }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const handleResend = async () => {
    setBusy(true); setErr(null);
    try {
      await nudgeInvite(invite.id, supplierName);
      onResent?.(invite);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm(`Revoke invite for ${invite.email}?`)) return;
    setBusy(true); setErr(null);
    try {
      await revokeInvite(invite.id);
      onRevoked?.(invite);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      border: '1px dashed var(--line)', borderRadius: 8,
      background: 'var(--bg-3)',
    }}>
      <Mail size={14} style={{ color: 'var(--muted)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>
          {invite.name ? `${invite.name} · ${invite.email}` : invite.email}
        </div>
        {err && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 2 }}>{err}</div>}
      </div>
      {invite.role && (
        <span style={{
          fontSize: 11, fontWeight: 500, color: 'var(--muted-s)',
          padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6,
        }}>{roleLabel(invite.role)}</span>
      )}
      <TierPill tier={invite.permission_tier} />
      <div style={{ fontSize: 11, color: 'var(--muted-s)' }}>
        {invite.nudge_count > 0 ? `Resent ${invite.nudge_count}×` : 'Sent'}
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={busy}
        style={{
          fontSize: 12, padding: '5px 10px', borderRadius: 6,
          border: '1px solid var(--line)', background: 'var(--card)',
          color: 'var(--fg)', cursor: busy ? 'wait' : 'pointer',
        }}
      >Resend</button>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={busy}
        title="Revoke invite"
        style={{
          padding: 6, borderRadius: 6, border: 'none',
          background: 'transparent', color: 'var(--muted-s)', cursor: 'pointer',
        }}
      ><X size={14} /></button>
    </div>
  );
};

// Auto-suggest tier from role
const TIER_FOR_ROLE = { sales: 'MEMBER', logistics: 'MEMBER', accounts: 'FINANCE', admin: 'ADMIN' };

const InviteModal = ({ supplierId, supplierName, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('sales');
  const [tier, setTier] = useState('MEMBER');
  const [tierTouched, setTierTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    if (!tierTouched) setTier(TIER_FOR_ROLE[newRole] ?? 'MEMBER');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) { setErr('Enter a valid email address.'); return; }
    setSubmitting(true); setErr(null);
    try {
      const created = await createInvite({
        supplierId,
        email,
        name: name.trim() || null,
        permissionTier: tier,
        role,
        supplierName,
      });
      onCreated?.(created);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(12,14,20,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: 12,
          border: '1px solid var(--line)',
          width: '100%', maxWidth: 460, padding: '24px 26px',
          boxShadow: '0 10px 32px rgba(12,14,20,0.18)',
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: 'var(--fg)', margin: '0 0 4px' }}>
              Invite team member
            </h3>
            <div style={{ fontSize: 12.5, color: 'var(--muted-s)' }}>
              They'll receive an email with a link to join {supplierName}.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            padding: 4, border: 'none', background: 'transparent', color: 'var(--muted-s)',
            cursor: 'pointer',
          }}><X size={18} /></button>
        </div>

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
            {err}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Teammate's name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Luca Moreau"
              autoComplete="off"
              style={{
                width: '100%', border: '1px solid var(--line)', borderRadius: 7,
                padding: '9px 12px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@supplier.com"
              autoComplete="off"
              style={{
                width: '100%', border: '1px solid var(--line)', borderRadius: 7,
                padding: '9px 12px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Role</label>
              <select
                value={role}
                onChange={(e) => handleRoleChange(e.target.value)}
                style={{
                  width: '100%', border: '1px solid var(--line)', borderRadius: 7,
                  padding: '9px 12px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)',
                }}
              >
                <option value="sales">Sales</option>
                <option value="logistics">Logistics</option>
                <option value="accounts">Accounts</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Permission tier</label>
              <select
                value={tier}
                onChange={(e) => { setTier(e.target.value); setTierTouched(true); }}
                style={{
                  width: '100%', border: '1px solid var(--line)', borderRadius: 7,
                  padding: '9px 12px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)',
                }}
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MEMBER">MEMBER</option>
                <option value="FINANCE">FINANCE</option>
                <option value="VIEWER">VIEWER</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={onClose} className="sp-pill" style={{ padding: '9px 16px' }} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="sp-pill primary" style={{ padding: '9px 18px' }} disabled={submitting || !email.trim()}>
              {submitting ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TransferOwnershipModal = ({ supplier, fromName, target, onClose, onDone }) => {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  const handleSubmit = async () => {
    setSubmitting(true); setErr(null);
    try {
      const result = await requestOwnershipTransfer(target.id, supplier.name, fromName);
      if (!result?.ok) {
        setErr(result?.error || 'Request failed');
        return;
      }
      onDone?.(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(12,14,20,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: 12,
          border: '1px solid var(--line)',
          width: '100%', maxWidth: 480, padding: '24px 26px',
          boxShadow: '0 10px 32px rgba(12,14,20,0.18)',
        }}>
        <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: 'var(--fg)', margin: '0 0 8px' }}>
          Transfer ownership of {supplier.name} to {target.name || target.email}?
        </h3>
        <p style={{ fontSize: 13.5, color: 'var(--muted-strong)', lineHeight: 1.55, margin: '0 0 14px' }}>
          They'll receive an email with a link to confirm. Until they confirm, you remain the owner.
          After confirmation, you'll become an Admin.
        </p>

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="sp-pill" style={{ padding: '9px 16px' }} disabled={submitting}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} className="sp-pill primary" style={{ padding: '9px 18px' }} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send transfer request'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TeamSection = ({ supplier, currentContact }) => {
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null);

  const { allowed: canInvite } = usePermission('team:invite');
  const { allowed: canRemove } = usePermission('team:remove');
  const isOwner = currentContact?.permission_tier === 'OWNER';

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ms, ins] = await Promise.all([
        fetchTeamMembers(supplier.id),
        canInvite ? fetchPendingInvites(supplier.id) : Promise.resolve([]),
      ]);
      setMembers(ms);
      setInvites(ins);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (supplier?.id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier?.id, canInvite]);

  const handleChangeTier = async (member, newTier) => {
    if (!window.confirm(`Change ${member.name || member.email}'s permission tier to ${newTier}?`)) return;
    try {
      const result = await updateMemberTier(member.id, newTier);
      if (!result?.ok) throw new Error(result?.error || 'Update failed');
      setMembers((prev) => prev.map((m) => m.id === member.id ? { ...m, permission_tier: newTier } : m));
      showToast('Permission tier updated.');
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.name || member.email} from ${supplier.name}? They'll lose access immediately.`)) return;
    try {
      const result = await removeMember(member.id);
      if (!result?.ok) throw new Error(result?.error || 'Remove failed');
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      showToast(`${member.name || member.email} removed.`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>
          Team
        </h4>
        <div style={{ fontSize: 12.5, color: 'var(--muted-s)', lineHeight: 1.5 }}>
          Everyone at {supplier.name} who has access to this portal.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}
      {toast && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--green)' }}>
          {toast}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{
              border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px',
              background: 'var(--bg-2)', height: 58,
            }} />
          ))}
        </div>
      )}

      {!loading && members && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted-s)', padding: '12px 0' }}>
              No team members yet.
            </div>
          )}
          {members.map((m) => (
            <TeamMemberRow
              key={m.id}
              member={m}
              myContactId={currentContact?.id}
              canInvite={canInvite}
              canRemove={canRemove}
              isOwner={isOwner}
              onChangeTier={handleChangeTier}
              onRemove={handleRemove}
              onTransfer={setTransferTarget}
            />
          ))}
        </div>
      )}

      {!loading && canInvite && invites && invites.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{
            fontFamily: 'Inter', fontWeight: 600, fontSize: 11,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--muted-strong)', marginBottom: 10,
          }}>Pending invites</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {invites.map((inv) => (
              <PendingInviteRow
                key={inv.id}
                invite={inv}
                supplierName={supplier.name}
                onResent={() => { showToast(`Invite resent to ${inv.email}.`); load(); }}
                onRevoked={() => { showToast(`Invite for ${inv.email} revoked.`); load(); }}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && canInvite && (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="sp-pill primary"
            style={{ padding: '9px 18px' }}
          >
            <UserPlus size={13} /> Invite team member
          </button>
        </div>
      )}

      {inviting && (
        <InviteModal
          supplierId={supplier.id}
          supplierName={supplier.name}
          onClose={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            showToast('Invitation sent.');
            load();
          }}
        />
      )}

      {transferTarget && (
        <TransferOwnershipModal
          supplier={supplier}
          fromName={currentContact?.name || currentContact?.email || 'the current owner'}
          target={transferTarget}
          onClose={() => setTransferTarget(null)}
          onDone={() => {
            setTransferTarget(null);
            showToast('Transfer request sent. They have 72 hours to confirm.');
          }}
        />
      )}
    </div>
  );
};

const EmailAliasesSection = ({ supplierId }) => {
  const [aliases, setAliases] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAliases(supplierId);
      setAliases(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (supplierId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    if (!isValidEmail(newEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await addAlias(supplierId, newEmail);
      setAliases((prev) => [...(prev ?? []), created]);
      showToast(`Verification email sent to ${created.email}`);
      setNewEmail('');
      setAdding(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (alias) => {
    setBusyId(alias.id);
    setError(null);
    try {
      const updated = await resendAliasVerification(alias.id);
      setAliases((prev) => prev.map((a) => (a.id === alias.id ? updated : a)));
      showToast(`Verification email resent to ${alias.email}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (alias) => {
    if (!window.confirm(`Remove ${alias.email} from your supplier account? Orders sent here will no longer route to your portal.`)) return;
    setBusyId(alias.id);
    setError(null);
    try {
      await deleteAlias(alias.id);
      setAliases((prev) => prev.filter((a) => a.id !== alias.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const pill = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999, fontSize: 10.5,
    fontWeight: 600, letterSpacing: 0.2, textTransform: 'uppercase',
  };
  const dot = (color) => ({
    width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
  });

  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
      <div style={{ marginBottom: 14 }}>
        <h4 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>
          Email addresses
        </h4>
        <div style={{ fontSize: 12.5, color: 'var(--muted-s)', lineHeight: 1.5 }}>
          Orders sent to any of these addresses will appear in your portal.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}
      {toast && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--green)' }}>
          {toast}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-2)', height: 44,
            }}>
              <div style={{ width: 14, height: 14, background: 'var(--line)', borderRadius: 3 }} />
              <div style={{ flex: 1, height: 12, background: 'var(--line)', borderRadius: 3 }} />
              <div style={{ width: 60, height: 12, background: 'var(--line)', borderRadius: 3 }} />
            </div>
          ))}
        </div>
      )}

      {/* Error with retry */}
      {!loading && aliases == null && error && (
        <div style={{ padding: '18px 0' }}>
          <button
            onClick={load}
            className="sp-pill"
            style={{ padding: '7px 14px', fontSize: 12.5 }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Alias list */}
      {!loading && aliases && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {aliases.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted-s)', padding: '12px 0' }}>
              No email addresses linked yet.
            </div>
          )}
          {aliases.map((a) => (
            <div
              key={a.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--card)',
              }}
            >
              <Mail size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{a.email}</div>

              {a.is_primary && (
                <span style={{ ...pill, background: 'var(--bg-3)', color: 'var(--muted-s)' }}>
                  Primary
                </span>
              )}

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.verified ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--green)' }}>
                    <span style={dot('#16A34A')} /> Verified
                  </span>
                ) : (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B45309' }}>
                      <span style={dot('#F59E0B')} /> Pending verification
                    </span>
                    <button
                      type="button"
                      onClick={() => handleResend(a)}
                      disabled={busyId === a.id}
                      style={{
                        fontSize: 12, padding: '5px 10px', borderRadius: 6,
                        border: '1px solid var(--line)', background: 'var(--card)',
                        color: 'var(--fg)', cursor: busyId === a.id ? 'wait' : 'pointer',
                      }}
                    >
                      {busyId === a.id ? 'Sending…' : 'Resend email'}
                    </button>
                  </>
                )}
                {!a.is_primary && (
                  <button
                    type="button"
                    onClick={() => handleDelete(a)}
                    disabled={busyId === a.id}
                    title="Remove this email"
                    style={{
                      padding: 6, borderRadius: 6,
                      border: 'none', background: 'transparent',
                      color: 'var(--muted-s)', cursor: busyId === a.id ? 'wait' : 'pointer',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {!loading && (
        <div style={{ marginTop: 14 }}>
          {!adding ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(null); }}
              className="sp-pill"
              style={{ padding: '7px 14px', fontSize: 12.5 }}
            >
              <Plus size={13} /> Add email address
            </button>
          ) : (
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 520 }}>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoFocus
                placeholder="orders@supplier.com"
                style={{
                  flex: 1, border: '1px solid var(--line)', borderRadius: 7,
                  padding: '9px 12px', fontSize: 13, background: 'var(--card)',
                  color: 'var(--fg)', fontFamily: 'inherit',
                }}
              />
              <button
                type="submit"
                className="sp-pill primary"
                style={{ padding: '9px 16px' }}
                disabled={submitting || !newEmail.trim()}
              >
                {submitting ? 'Sending…' : 'Send verification'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewEmail(''); setError(null); }}
                className="sp-pill"
                style={{ padding: '9px 16px' }}
                disabled={submitting}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

// 24-hour time picker (no AM/PM). Two scrollable columns — hours 00–23,
// minutes in 5s — matching the app's editorial fields. Value is 'HH:MM'.
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Compress selected weekdays into readable ranges: Mon,Tue,Wed,Fri → "Mon–Wed, Fri".
const fmtDays = (days) => {
  if (!days || !days.length) return '';
  const idx = days.map(d => WEEK_DAYS.indexOf(d)).filter(i => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return '';
  if (idx.length === 7) return 'Every day';
  const runs = []; let start = idx[0], prev = idx[0];
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === prev + 1) prev = idx[i];
    else { runs.push([start, prev]); start = idx[i]; prev = idx[i]; }
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? WEEK_DAYS[a] : `${WEEK_DAYS[a]}–${WEEK_DAYS[b]}`)).join(', ');
};
const TIME_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const TIME_MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const TimeField = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const [h, m] = (value || '').split(':');
  const opt = (sel) => ({
    display: 'block', width: '100%', textAlign: 'center', border: 'none', cursor: 'pointer',
    background: sel ? '#C65A1A' : 'transparent', color: sel ? '#fff' : 'var(--fg)',
    borderRadius: 7, padding: '7px 0', fontSize: 13, fontWeight: sel ? 600 : 400, fontFamily: 'inherit',
  });
  const col = { flex: 1, maxHeight: 182, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '9px 12px', fontSize: 13,
        background: 'var(--card)', color: value ? 'var(--fg)' : 'var(--muted)', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', boxSizing: 'border-box',
      }}>
        <span>{value || 'Set time'}</span>
        <Clock size={14} style={{ color: 'var(--muted-s)' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, display: 'flex', gap: 4,
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 16px 40px -16px rgba(15,23,42,0.25)', padding: 6, width: 148,
        }}>
          <div style={col}>{TIME_HOURS.map(x => <button key={x} type="button" style={opt(x === h)} onClick={() => onChange(`${x}:${m || '00'}`)}>{x}</button>)}</div>
          <div style={{ alignSelf: 'center', color: 'var(--muted)', fontWeight: 700 }}>:</div>
          <div style={col}>{TIME_MINS.map(x => <button key={x} type="button" style={opt(x === m)} onClick={() => onChange(`${h || '00'}:${x}`)}>{x}</button>)}</div>
        </div>
      )}
    </div>
  );
};

// Live "what yachts see" preview — the supplier's own buyer-facing card,
// built from their profile + the current form values so it updates as they
// edit. Closes the loop the review flagged: they can see their storefront.
const StorefrontPreview = ({ supplier, form, certs }) => {
  const [rating, setRating] = useState(null);
  useEffect(() => {
    fetchMySupplierReviews()
      .then(rows => {
        if (!rows.length) { setRating(null); return; }
        setRating({ avg: rows.reduce((s, r) => s + r.rating, 0) / rows.length, count: rows.length });
      })
      .catch(() => {});
  }, []);

  const name = supplier.name || 'Your storefront';
  const initials = (name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '•').toUpperCase();
  const location = [supplier.business_city, supplier.business_country].filter(Boolean).join(', ');
  const ports = (supplier.coverage_ports || []).slice(0, 4);
  const cats = supplier.categories || [];
  const lead = form.lead_time_days;
  const cutoff = form.order_cutoff;
  const min = form.min_order_value;
  const cur = form.min_order_currency || 'EUR';
  const express = !!form.express_available;
  const days = fmtDays(form.delivery_days);
  const cutoffStrict = !!form.cutoff_strict;
  const hasLead = lead !== '' && lead != null;
  const hasMin = min !== '' && min != null;
  const hasTerms = hasLead || cutoff || hasMin || express || days || certs.length > 0;

  const stars = (v) => [1, 2, 3, 4, 5].map(i => {
    const fill = v >= i ? 100 : (v >= i - 0.5 ? 50 : 0);
    return <span key={i} className="spv-star"><span className="b">★</span><span className="f" style={{ width: `${fill}%` }}>★</span></span>;
  });

  return (
    <div className="spv-card">
      <div className="spv-eyebrow">Preview · what yachts see</div>
      <div className="spv-head">
        <span className="spv-logo">{supplier.logo_url ? <img src={supplier.logo_url} alt="" /> : initials}</span>
        <div className="spv-id">
          <div className="spv-name">{name}</div>
          <div className="spv-sub">
            {rating
              ? <span className="spv-rating"><span className="spv-stars">{stars(rating.avg)}</span> {rating.avg.toFixed(1)} · {rating.count} review{rating.count === 1 ? '' : 's'}</span>
              : <span className="spv-unrated">No reviews yet</span>}
            {location && <><span className="spv-dot">·</span>{location}</>}
          </div>
        </div>
      </div>

      {(ports.length > 0 || cats.length > 0) && (
        <div className="spv-facts">
          {ports.length > 0 && <span>Serves <b>{ports.join(' · ')}</b></span>}
          {ports.length > 0 && cats.length > 0 && <span className="spv-dot">·</span>}
          {cats.length > 0 && <span>{cats.slice(0, 3).join(' · ')}{cats.length > 3 ? ` +${cats.length - 3}` : ''}</span>}
        </div>
      )}

      {hasTerms ? (
        <div className="spv-terms">
          {days && <span className="spv-term">delivers <b>{days}</b></span>}
          {hasLead && <span className="spv-term"><b>≈{lead}d</b> lead time</span>}
          {cutoff && <span className="spv-term">order by <b>{cutoff}</b> {cutoffStrict ? '(firm)' : '(flexible)'}</span>}
          {hasMin && <span className="spv-term"><b>{cur} {min}</b> min</span>}
          {express && <span className="spv-term rush"><Zap size={12} strokeWidth={2} /> Rush available</span>}
          {certs.map(c => <span key={c.name} className="spv-cert">{c.name}{c.verified && <Check size={11} strokeWidth={3} style={{ marginLeft: 3, color: '#1D9E75', verticalAlign: '-1px' }} />}</span>)}
        </div>
      ) : (
        <div className="spv-empty">Fill in the details below and they'll show here — this is how a captain sees you when choosing a supplier.</div>
      )}
    </div>
  );
};

// Storefront details — the operational trust signals a buyer sees before
// choosing this supplier. Framed as TYPICAL, not hard limits; the
// express-available toggle captures that a good supplier will rush for the
// right job. Self-contained save (own form + sanitising).
const StorefrontSection = ({ supplier, onSaved }) => {
  const [form, setForm] = useState({
    lead_time_days:     supplier.lead_time_days ?? '',
    order_cutoff:       (supplier.order_cutoff || '').slice(0, 5), // 'HH:MM'
    min_order_value:    supplier.min_order_value ?? '',
    min_order_currency: supplier.min_order_currency || 'EUR',
    express_available:  !!supplier.express_available,
    delivery_days:      Array.isArray(supplier.delivery_days) ? supplier.delivery_days : [],
    cutoff_strict:      !!supplier.cutoff_strict,
  });
  // Certs are records now: { name, docUrl, verified }. Loaded fresh so we
  // have documents + verified state (not just the names on the profile).
  const [certs, setCerts] = useState(
    (Array.isArray(supplier.certifications) ? supplier.certifications : []).map(name => ({ name, docUrl: '', verified: false }))
  );
  const [certDraft, setCertDraft] = useState('');
  const [uploadingCert, setUploadingCert] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMyCertifications().then(rows => { if (rows.length) setCerts(rows); }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCert = () => {
    const c = certDraft.trim();
    if (!c) return;
    if (!certs.some(x => x.name.toLowerCase() === c.toLowerCase())) setCerts([...certs, { name: c, docUrl: '', verified: false }]);
    setCertDraft('');
  };

  const uploadDoc = async (name, file) => {
    if (!file) return;
    setUploadingCert(name);
    try {
      const url = await uploadCertDoc(supplier.id, file);
      setCerts(cs => cs.map(c => (c.name === name ? { ...c, docUrl: url } : c)));
    } catch (e) {
      setError(e.message || 'Could not upload the document');
    } finally {
      setUploadingCert(null);
    }
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v));
      await saveMyCertifications(certs);
      await updateSupplierStorefront({
        lead_time_days:     num(form.lead_time_days),
        order_cutoff:       form.order_cutoff ? form.order_cutoff : null,
        min_order_value:    num(form.min_order_value),
        min_order_currency: form.min_order_currency || 'EUR',
        certifications:     certs.map(c => c.name),
        express_available:  !!form.express_available,
        delivery_days:      form.delivery_days || [],
        cutoff_strict:      !!form.cutoff_strict,
      });
      // Queue an AI first-pass review for any cert with a document that isn't
      // yet verified — the edge function is idempotent per document, so it's
      // safe to fire for all of them. Don't block the save on it.
      certs
        .filter(c => c.docUrl && !c.verified)
        .forEach(c => { requestCertReview(supplier.id, c.name); });
      await onSaved?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const lbl = { fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 };
  const inp = { width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '9px 12px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)', fontFamily: 'inherit', boxSizing: 'border-box' };

  return (
    <>
      <h4 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>Storefront</h4>
      <p style={{ fontSize: 12.5, color: 'var(--muted-strong)', margin: '0 0 18px', lineHeight: 1.5, maxWidth: 460 }}>
        What yachts see before choosing you. These are your <em>typical</em> terms — not hard limits.
      </p>

      <StorefrontPreview supplier={supplier} form={form} certs={certs} />


      {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
      {saved && <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--green)' }}>Storefront updated.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div>
          <label style={lbl}>Standard lead time (days)</label>
          <input type="number" min="0" value={form.lead_time_days} onChange={e => set('lead_time_days', e.target.value)} placeholder="e.g. 2" style={inp} />
        </div>
        <div>
          <label style={lbl}>Standard order cut-off</label>
          <TimeField value={form.order_cutoff} onChange={v => set('order_cutoff', v)} />
        </div>
        <div>
          <label style={lbl}>Typical minimum order</label>
          <input type="number" min="0" step="0.01" value={form.min_order_value} onChange={e => set('min_order_value', e.target.value)} placeholder="e.g. 300" style={inp} />
        </div>
        <div>
          <label style={lbl}>Currency</label>
          <select value={form.min_order_currency} onChange={e => set('min_order_currency', e.target.value)} style={inp}>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
      </div>

      {/* Delivery days */}
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Delivery days</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {WEEK_DAYS.map(d => {
            const on = form.delivery_days.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => set('delivery_days', on ? form.delivery_days.filter(x => x !== d) : [...form.delivery_days, d])}
                style={{
                  border: `1px solid ${on ? '#C65A1A' : 'var(--line)'}`, background: on ? '#C65A1A' : 'var(--card)',
                  color: on ? '#fff' : 'var(--fg)', borderRadius: 999, padding: '6px 14px', fontSize: 12.5,
                  fontWeight: on ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{d}</button>
            );
          })}
        </div>
      </div>

      {/* Cut-off strict vs flexible */}
      <div style={{ marginBottom: 18 }}>
        <label style={lbl}>Cut-off is</label>
        <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}>
          {[{ k: false, t: 'Flexible', s: "We'll try after cut-off" }, { k: true, t: 'Firm', s: 'Blocks the next run' }].map((o, i) => {
            const on = !!form.cutoff_strict === o.k;
            return (
              <button
                key={o.t}
                type="button"
                title={o.s}
                onClick={() => set('cutoff_strict', o.k)}
                style={{
                  border: 'none', borderLeft: i ? '1px solid var(--line)' : 'none',
                  background: on ? '#C65A1A' : 'var(--card)', color: on ? '#fff' : 'var(--muted-s)',
                  padding: '8px 16px', fontSize: 12.5, fontWeight: on ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{o.t}</button>
            );
          })}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--muted-s)', marginLeft: 12 }}>
          {form.cutoff_strict ? 'Orders after cut-off roll to the next delivery.' : 'You may still take an order after cut-off — buyers see "flexible".'}
        </span>
      </div>

      {/* Express / rush */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.express_available} onChange={e => set('express_available', e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Zap size={14} strokeWidth={1.8} style={{ color: '#C65A1A' }} /> Express / rush orders on request
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted-s)', marginTop: 2 }}>Shows a “Rush available” badge — you'll take urgent orders for the right job.</span>
        </span>
      </label>

      {/* Certifications */}
      <div style={{ marginBottom: 22 }}>
        <label style={lbl}>Certifications</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: certs.length ? 10 : 0 }}>
          <input
            value={certDraft}
            onChange={e => setCertDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCert(); } }}
            placeholder="e.g. HACCP, Organic, IFS, Cold-chain"
            style={{ ...inp, flex: 1 }}
          />
          <button type="button" className="sp-pill" style={{ padding: '9px 14px', whiteSpace: 'nowrap' }} onClick={addCert}>
            <Plus size={13} /> Add
          </button>
        </div>
        {certs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
            {certs.map(c => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px 8px 14px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                  {c.name}
                  {c.verified && (
                    <span title="Verified by Cargo" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#EAF6EF', color: '#1D9E75', borderRadius: 999, padding: '2px 8px 2px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.2 }}>
                      <Check size={11} strokeWidth={3} /> Verified
                    </span>
                  )}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {c.docUrl ? (
                    <a href={c.docUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#C65A1A', textDecoration: 'none', fontWeight: 600 }}>
                      <FileText size={13} /> View
                    </a>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--faint)' }}>No document</span>
                  )}
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted-s)', cursor: uploadingCert === c.name ? 'default' : 'pointer', fontWeight: 500 }}>
                    <Paperclip size={13} />
                    {uploadingCert === c.name ? 'Uploading…' : c.docUrl ? 'Replace' : 'Attach'}
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; uploadDoc(c.name, f); }}
                      disabled={uploadingCert === c.name}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <button type="button" onClick={() => setCerts(certs.filter(x => x.name !== c.name))} aria-label={`Remove ${c.name}`} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted-s)', lineHeight: 0, padding: 2 }}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--muted-s)', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Attach the certificate (PDF or image). Cargo reviews uploads and adds a <strong>Verified</strong> tick buyers can trust.
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="sp-pill primary" style={{ padding: '9px 20px' }} onClick={handleSave} disabled={saving}>
          <Save size={13} />{saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  );
};

const Field = ({ label, value, onChange, type = 'text', readOnly = false }) => (
  <div>
    <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>{label}</label>
    <input
      type={type}
      value={value ?? ''}
      onChange={onChange ? e => onChange(e.target.value) : undefined}
      readOnly={readOnly}
      style={{
        width: '100%',
        border: '1px solid var(--line)',
        borderRadius: 7,
        padding: '9px 12px',
        fontSize: 13,
        background: readOnly ? 'var(--bg-3)' : 'var(--card)',
        color: 'var(--fg)',
        fontFamily: 'inherit',
      }}
    />
  </div>
);

const SupplierSettings = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { supplier, contact, refreshSupplier } = useSupplier();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const tier = getSupplierTier(contact?.role);
  const isAdmin = tier === 'admin';

  // Tabs visible to the current role
  const visibleTabs = ALL_TABS.filter(t => isAdmin || !t.adminOnly);

  // Derive active slug from URL
  const pathSlug = location.pathname.split('/').pop();
  const activeTab = visibleTabs.find(t => t.slug === pathSlug) ?? visibleTabs[0];
  const activeSlug = activeTab.slug;
  const activeLabel = activeTab.label;

  React.useEffect(() => {
    if (supplier && !form) {
      setForm({
        name:                  supplier.name ?? '',
        description:           supplier.description ?? '',
        contact_email:         supplier.contact_email ?? '',
        contact_phone:         supplier.contact_phone ?? '',
        website:               supplier.website ?? '',
        payment_terms_default: supplier.payment_terms_default ?? '30 days',
      });
    }
  }, [supplier]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateSupplierProfile(supplier.id, form);
      await refreshSupplier();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!supplier || !form) {
    return (
      <div className="sp-page">
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Workspace · {supplier.name}</div>
          <h1 className="sp-page-title">Workspace <em>profile</em></h1>
          <p className="sp-page-sub">Team, delivery zones, payment terms, integrations.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20 }}>
        {/* Tab nav — each item links to its own URL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleTabs.map(({ slug, label }) => (
            <button
              key={slug}
              onClick={() => navigate(`/supplier/workspace/${slug}`)}
              style={{
                padding: '9px 12px', borderRadius: 8, textAlign: 'left',
                fontSize: 13, fontWeight: activeSlug === slug ? 600 : 400,
                color: activeSlug === slug ? 'var(--fg)' : 'var(--muted-s)',
                background: activeSlug === slug ? 'var(--card)' : 'transparent',
                border: activeSlug === slug ? '1px solid var(--line)' : '1px solid transparent',
                cursor: 'pointer', transition: 'background 0.1s',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div className="sp-card" style={{ padding: '22px 24px' }}>
          {activeSlug === 'company' ? (
            <>
              <h4 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 16px' }}>Company profile</h4>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>
                  {error}
                </div>
              )}
              {saved && (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--green)' }}>
                  Profile updated successfully.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <Field label="Trading name"    value={form.name}                  onChange={v => set('name', v)} />
                <Field label="Contact email"   value={form.contact_email}          onChange={v => set('contact_email', v)} type="email" />
                <Field label="Contact phone"   value={form.contact_phone}          onChange={v => set('contact_phone', v)} />
                <Field label="Website"         value={form.website}                onChange={v => set('website', v)} />
                <Field label="Payment terms"   value={form.payment_terms_default}  onChange={v => set('payment_terms_default', v)} />
                <Field label="Supplier ID"     value={supplier.id}                readOnly />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="sp-pill primary" style={{ padding: '9px 20px' }} onClick={handleSave} disabled={saving}>
                  <Save size={13} />{saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>

              <EmailAliasesSection supplierId={supplier.id} />
            </>
          ) : activeSlug === 'storefront' ? (
            <StorefrontSection supplier={supplier} onSaved={refreshSupplier} />
          ) : activeSlug === 'team' ? (
            hasClientPermission(contact?.permission_tier, 'team:view') ? (
              <TeamSection supplier={supplier} currentContact={contact} />
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
                <div style={{ fontSize: 13 }}>You don't have permission to view the team.</div>
              </div>
            )
          ) : activeSlug === 'tax' ? (
            <InvoicingSettings supplier={supplier} onSaved={refreshSupplier} />
          ) : activeSlug === 'documents' ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🛡</div>
              <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: 'var(--fg)', marginBottom: 6 }}>Documents & legal</div>
              <div style={{ fontSize: 13, color: 'var(--muted-strong)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
                Manage certifications, agreements, and compliance documents. Coming soon.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚙</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{activeLabel}</div>
              <div style={{ fontSize: 13 }}>Coming in a future update.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierSettings;
