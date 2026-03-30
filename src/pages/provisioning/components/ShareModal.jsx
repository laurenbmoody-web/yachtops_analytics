import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import {
  createShareLink, fetchShareLinks, revokeShareLink,
  addCollaborator, removeCollaborator, updateCollaboratorPermission, fetchCollaborators,
} from '../utils/provisioningStorage';

// ── Permission selector ───────────────────────────────────────────────────────

const LINK_PERMS   = [{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }];
const COLLAB_PERMS = [{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }, { value: 'approve', label: 'Can approve' }];

const PermSelect = ({ value, options, onChange, small }) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    style={{
      fontSize: small ? 11 : 12, padding: small ? '2px 4px' : '4px 8px',
      border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 6,
      background: 'var(--color-background, #F8FAFC)', color: 'var(--color-foreground, #1E3A5F)',
      cursor: 'pointer', outline: 'none',
    }}
  >
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

// ── Copy link row ─────────────────────────────────────────────────────────────

const ShareLinkRow = ({ share, onRevoke }) => {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/provisioning/shared/${share.token}`;

  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, color: 'var(--color-muted-foreground, #94A3B8)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          …/shared/{share.token.slice(0, 12)}…
        </p>
        <p style={{ fontSize: 10, color: 'var(--color-muted-foreground, #94A3B8)', marginTop: 1 }}>
          {share.permission === 'edit' ? 'Can edit' : 'Can view'} · Created {new Date(share.created_at).toLocaleDateString()}
          {share.last_accessed_at && ` · Last used ${new Date(share.last_accessed_at).toLocaleDateString()}`}
        </p>
      </div>
      <button
        onClick={copy}
        style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
          background: copied ? '#ECFDF5' : 'var(--color-muted, #F1F5F9)',
          color: copied ? '#047857' : 'var(--color-foreground, #1E3A5F)',
          border: '1px solid var(--color-border, #E2E8F0)',
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <button
        onClick={() => onRevoke(share.id)}
        style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground, #94A3B8)', flexShrink: 0 }}
        title="Revoke link"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

// ── Collaborator row ──────────────────────────────────────────────────────────

const CollaboratorRow = ({ collab, listId, onRemove, onPermChange }) => {
  const [perm, setPerm] = useState(collab.permission);
  const initials = (collab.full_name || collab.email || '?').slice(0, 2).toUpperCase();

  const handlePermChange = async (val) => {
    setPerm(val);
    await updateCollaboratorPermission(listId, collab.user_id, val);
    onPermChange?.();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: collab.avatar_url ? 'transparent' : '#4A90E2',
        backgroundImage: collab.avatar_url ? `url(${collab.avatar_url})` : undefined,
        backgroundSize: 'cover',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#fff',
      }}>
        {!collab.avatar_url && initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-foreground, #1E3A5F)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {collab.full_name || collab.email || 'Unknown'}
        </p>
        {collab.full_name && collab.email && (
          <p style={{ fontSize: 11, color: 'var(--color-muted-foreground, #94A3B8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{collab.email}</p>
        )}
      </div>
      <PermSelect value={perm} options={COLLAB_PERMS} onChange={handlePermChange} small />
      <button
        onClick={() => onRemove(collab.user_id)}
        style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted-foreground, #94A3B8)', flexShrink: 0 }}
        title="Remove"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

// ── Crew search dropdown ──────────────────────────────────────────────────────

const CrewSearch = ({ crewMembers, existingUserIds, onSelect }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const filtered = (crewMembers || []).filter(c => {
    if (existingUserIds?.includes(c.id)) return false;
    const q = query.toLowerCase();
    return !q || (c.full_name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q);
  }).slice(0, 8);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search crew by name or email…"
        style={{
          width: '100%', padding: '8px 12px', fontSize: 13,
          border: '1px solid var(--color-border, #E2E8F0)', borderRadius: 8,
          background: 'var(--color-background, #F8FAFC)', color: 'var(--color-foreground, #1E3A5F)',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, marginTop: 4,
          background: 'var(--color-card, #fff)', border: '1px solid var(--color-border, #E2E8F0)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
        }}
          onMouseDown={e => e.preventDefault()}
        >
          {filtered.map(c => {
            const initials = (c.full_name || c.email || '?').slice(0, 2).toUpperCase();
            return (
              <button
                key={c.id}
                onClick={() => { onSelect(c); setQuery(''); setOpen(false); }}
                style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                className="hover:bg-muted transition-colors"
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: c.avatar_url ? 'transparent' : '#4A90E2', backgroundImage: c.avatar_url ? `url(${c.avatar_url})` : undefined, backgroundSize: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff' }}>
                  {!c.avatar_url && initials}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-foreground, #1E3A5F)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name || c.email}</p>
                  {c.full_name && c.email && <p style={{ fontSize: 11, color: 'var(--color-muted-foreground, #94A3B8)' }}>{c.email}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const ShareModal = ({ list, crewMembers, currentUserId, onClose }) => {
  const [tab, setTab] = useState('link'); // 'link' | 'people'
  const [shareLinks, setShareLinks] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [newLinkPerm, setNewLinkPerm] = useState('view');
  const [newCollabPerm, setNewCollabPerm] = useState('view');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchShareLinks(list.id).then(setShareLinks);
    fetchCollaborators(list.id).then(setCollaborators);
  }, [list.id]);

  const handleCreateLink = async () => {
    setCreating(true);
    const link = await createShareLink(list.id, newLinkPerm, currentUserId);
    if (link) {
      setShareLinks(prev => [link, ...prev]);
      // Auto-copy the new link
      const url = `${window.location.origin}/provisioning/shared/${link.token}`;
      navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
    }
    setCreating(false);
  };

  const handleRevoke = async (shareId) => {
    await revokeShareLink(shareId);
    setShareLinks(prev => prev.filter(s => s.id !== shareId));
  };

  const handleAddCollab = async (crewMember) => {
    const row = await addCollaborator(list.id, crewMember.id, newCollabPerm, currentUserId);
    if (row) {
      setCollaborators(prev => [...prev, {
        id: row.id, user_id: crewMember.id, permission: newCollabPerm, added_at: row.added_at,
        full_name: crewMember.full_name, email: crewMember.email, avatar_url: crewMember.avatar_url,
      }]);
    }
  };

  const handleRemoveCollab = async (userId) => {
    await removeCollaborator(list.id, userId);
    setCollaborators(prev => prev.filter(c => c.user_id !== userId));
  };

  const existingCollabIds = collaborators.map(c => c.user_id);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: 'var(--color-card, #fff)', borderRadius: 20, boxShadow: '0 24px 64px rgba(0,0,0,0.2)', width: '100%', maxWidth: 480, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--color-border, #E2E8F0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-foreground, #1E3A5F)', margin: 0 }}>Share board</h2>
            <p style={{ fontSize: 12, color: 'var(--color-muted-foreground, #94A3B8)', margin: '3px 0 0' }}>{list.title}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-muted-foreground, #94A3B8)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, #E2E8F0)', padding: '0 20px' }}>
          {[{ id: 'link', label: 'Share link' }, { id: 'people', label: 'Collaborators' }].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                background: 'none', border: 'none', cursor: 'pointer',
                color: tab === t.id ? 'var(--color-foreground, #1E3A5F)' : 'var(--color-muted-foreground, #94A3B8)',
                borderBottom: tab === t.id ? '2px solid #4A90E2' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label}
              {t.id === 'people' && collaborators.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, background: '#4A90E2', color: '#fff', borderRadius: 20, padding: '1px 5px', fontWeight: 600 }}>
                  {collaborators.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>

          {tab === 'link' && (
            <>
              {/* Create link row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                <PermSelect value={newLinkPerm} options={LINK_PERMS} onChange={setNewLinkPerm} />
                <button
                  onClick={handleCreateLink}
                  disabled={creating}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, cursor: creating ? 'wait' : 'pointer',
                    background: '#1E3A5F', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Icon name="Link" size={13} />
                  {creating ? 'Creating…' : copied ? '✓ Link copied!' : 'Create & copy link'}
                </button>
              </div>

              {/* Existing links */}
              {shareLinks.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-muted-foreground, #94A3B8)', textAlign: 'center', padding: '20px 0' }}>
                  No active links. Create one above.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Active links
                  </p>
                  {shareLinks.map(s => (
                    <ShareLinkRow key={s.id} share={s} onRevoke={handleRevoke} />
                  ))}
                </>
              )}
            </>
          )}

          {tab === 'people' && (
            <>
              {/* Add collaborator */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <CrewSearch
                  crewMembers={crewMembers}
                  existingUserIds={existingCollabIds}
                  onSelect={handleAddCollab}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-muted-foreground, #94A3B8)' }}>Default permission:</span>
                  <PermSelect value={newCollabPerm} options={COLLAB_PERMS} onChange={setNewCollabPerm} small />
                </div>
              </div>

              {/* Collaborator list */}
              {collaborators.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-muted-foreground, #94A3B8)', textAlign: 'center', padding: '20px 0' }}>
                  No collaborators yet. Search for a crew member above.
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted-foreground, #94A3B8)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''}
                  </p>
                  {collaborators.map(c => (
                    <CollaboratorRow
                      key={c.user_id}
                      collab={c}
                      listId={list.id}
                      onRemove={handleRemoveCollab}
                      onPermChange={() => {}}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
