import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import {
  createShareLink, fetchShareLinks, revokeShareLink,
  addCollaborator, removeCollaborator, updateCollaboratorPermission, fetchCollaborators,
} from '../utils/provisioningStorage';
import './share-modal.css';

// Share-board modal — editorial rebuild. Two tabs:
//   Collaborators — invite a crew member to view / edit / approve the
//                   board. Backed by provisioning_list_collaborators;
//                   RLS (20260627090000) grants edit collaborators real
//                   item + board write access.
//   Share link    — token links for view / edit access without an account.

const LINK_PERMS   = [{ value: 'view', label: 'Can view' }, { value: 'edit', label: 'Can edit' }];
const COLLAB_PERMS = [
  { value: 'view',    label: 'Can view' },
  { value: 'edit',    label: 'Can edit' },
  { value: 'approve', label: 'Can approve' },
];

const AVATAR_COLOURS = ['#C65A1A', '#1C1B3A', '#2E7D5A', '#7C5BC7', '#B14E16', '#3B6FB0'];
const avatarColour = (key) => {
  const s = String(key || '?');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
};
const initialsOf = (name, email) => (name || email || '?').trim().slice(0, 2).toUpperCase();

const PermSelect = ({ value, options, onChange }) => (
  <select className="shm-select-sm" value={value} onChange={e => onChange(e.target.value)}>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const Avatar = ({ name, email, url, size = 32 }) => (
  <div
    className="shm-avatar"
    style={{
      width: size, height: size, fontSize: size <= 28 ? 10 : 11,
      background: url ? 'transparent' : avatarColour(email || name),
      backgroundImage: url ? `url(${url})` : undefined,
    }}
  >
    {!url && initialsOf(name, email)}
  </div>
);

// ── Share-link row ────────────────────────────────────────────────────────────
const ShareLinkRow = ({ share, onRevoke }) => {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/provisioning/shared/${share.token}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => {
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  });
  const d = (iso) => new Date(iso).toLocaleDateString('en-GB');

  return (
    <div className="shm-link-row">
      <div className="shm-link-info">
        <p className="shm-link-token">…/shared/{share.token.slice(0, 14)}…</p>
        <p className="shm-link-meta">
          {share.permission === 'edit' ? 'Can edit' : 'Can view'} · Created {d(share.created_at)}
          {share.last_accessed_at && ` · Last used ${d(share.last_accessed_at)}`}
        </p>
      </div>
      <button className={`shm-link-copy${copied ? ' is-copied' : ''}`} onClick={copy}>
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <button className="shm-icon-btn" onClick={() => onRevoke(share.id)} title="Revoke link">
        <Icon name="X" size={13} />
      </button>
    </div>
  );
};

// ── Collaborator row ──────────────────────────────────────────────────────────
const CollaboratorRow = ({ collab, listId, isSelf, onRemove }) => {
  const [perm, setPerm] = useState(collab.permission);
  const handlePermChange = async (val) => {
    setPerm(val);
    await updateCollaboratorPermission(listId, collab.user_id, val);
  };
  return (
    <div className="shm-collab-row">
      <Avatar name={collab.full_name} email={collab.email} url={collab.avatar_url} />
      <div className="shm-collab-info">
        <p className="shm-collab-name">
          {collab.full_name || collab.email || 'Unknown'}
          {isSelf && <span className="shm-collab-you">You</span>}
        </p>
        {collab.full_name && collab.email && <p className="shm-collab-email">{collab.email}</p>}
      </div>
      <PermSelect value={perm} options={COLLAB_PERMS} onChange={handlePermChange} />
      <button className="shm-icon-btn" onClick={() => onRemove(collab.user_id)} title="Remove">
        <Icon name="X" size={13} />
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
  });
  // No slice cap — the full crew list renders inline and the modal
  // body scrolls. Capping at 8 silently dropped crew off the bottom.

  return (
    <div ref={ref} className="shm-search-wrap">
      <input
        className="shm-field"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search crew by name or email…"
      />
      {/* Inline results — plain hairline rows in the modal flow, not a
          floating menu. The modal body is the single scroll surface, so
          there's no box-within-a-box clipping past the panel edge. */}
      {open && (
        <div className="shm-search-inline">
          {filtered.length === 0 ? (
            <p className="shm-search-none">No matching crew.</p>
          ) : filtered.map(c => (
            <button key={c.id} className="shm-search-item" onMouseDown={e => e.preventDefault()} onClick={() => { onSelect(c); setQuery(''); setOpen(false); }}>
              <Avatar name={c.full_name} email={c.email} url={c.avatar_url} size={28} />
              <div style={{ minWidth: 0 }}>
                <p className="shm-collab-name">{c.full_name || c.email}</p>
                {c.full_name && c.email && <p className="shm-collab-email">{c.email}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────
const ShareModal = ({ list, crewMembers, currentUserId, onClose }) => {
  const [tab, setTab] = useState('people'); // 'people' | 'link' — people leads now
  const [shareLinks, setShareLinks] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [newLinkPerm, setNewLinkPerm] = useState('view');
  const [newCollabPerm, setNewCollabPerm] = useState('edit');
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
    <div className="shm-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="shm shm-panel" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="shm-head">
          <div>
            <p className="shm-eyebrow">Provisioning Board</p>
            <h2 className="shm-title">Share, <em>collaborate</em>.</h2>
            <p className="shm-collab-email" style={{ marginTop: 3 }}>{list.title}</p>
          </div>
          <button className="shm-close" onClick={onClose} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="shm-tabs">
          <button className={`shm-tab${tab === 'people' ? ' is-active' : ''}`} onClick={() => setTab('people')}>
            Collaborators
            {collaborators.length > 0 && <span className="shm-tab-count">{collaborators.length}</span>}
          </button>
          <button className={`shm-tab${tab === 'link' ? ' is-active' : ''}`} onClick={() => setTab('link')}>
            Share link
            {shareLinks.length > 0 && <span className="shm-tab-count">{shareLinks.length}</span>}
          </button>
        </div>

        {/* Body */}
        <div className="shm-body">

          {tab === 'people' && (
            <>
              <CrewSearch crewMembers={crewMembers} existingUserIds={existingCollabIds} onSelect={handleAddCollab} />
              <div className="shm-default-perm">
                <span>New collaborators can</span>
                <PermSelect value={newCollabPerm} options={COLLAB_PERMS} onChange={setNewCollabPerm} />
              </div>

              <div style={{ marginTop: 18 }}>
                {collaborators.length === 0 ? (
                  <p className="shm-empty">No collaborators yet.<br />Search a crew member above to invite them.</p>
                ) : (
                  <>
                    <p className="shm-section-label">
                      {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''}
                    </p>
                    {collaborators.map(c => (
                      <CollaboratorRow
                        key={c.user_id}
                        collab={c}
                        listId={list.id}
                        isSelf={c.user_id === currentUserId}
                        onRemove={handleRemoveCollab}
                      />
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {tab === 'link' && (
            <>
              <div className="shm-create-row">
                <PermSelect value={newLinkPerm} options={LINK_PERMS} onChange={setNewLinkPerm} />
                <button className="shm-btn-primary" onClick={handleCreateLink} disabled={creating}>
                  <Icon name="Link" size={13} />
                  {creating ? 'Creating…' : copied ? '✓ Link copied!' : 'Create & copy link'}
                </button>
              </div>

              {shareLinks.length === 0 ? (
                <p className="shm-empty">No active links. Create one above.</p>
              ) : (
                <>
                  <p className="shm-section-label">Active links</p>
                  {shareLinks.map(s => <ShareLinkRow key={s.id} share={s} onRevoke={handleRevoke} />)}
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
