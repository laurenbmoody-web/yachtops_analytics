import React, { useEffect, useState } from 'react';
import SupplierModal from './SupplierModal';
import { fetchSupplierTeam, assignOrderToContact } from '../utils/supplierStorage';

const initialsOf = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function ReassignModal({ order, open, onClose, onSaved }) {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  const currentAssigneeId = order?.assigned_contact?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(currentAssigneeId);
    fetchSupplierTeam()
      .then((rows) => { if (!cancelled) setTeam(rows); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not load team'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, currentAssigneeId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await assignOrderToContact(order.id, selectedId);
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save assignment');
    } finally {
      setSaving(false);
    }
  };

  const noChange = selectedId === currentAssigneeId;

  return (
    <SupplierModal
      open={open}
      onClose={onClose}
      title="Reassign order"
      footer={
        <>
          {currentAssigneeId && (
            <button
              type="button"
              className="sp-btn sp-btn-secondary"
              onClick={() => setSelectedId(null)}
              style={{ marginRight: 'auto' }}
              disabled={saving}
            >
              Unassign
            </button>
          )}
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={handleSave}
            disabled={saving || noChange}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </>
      }
    >
      {error && (
        <div style={{
          marginBottom: 14, padding: '8px 12px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 7, color: '#991B1B', fontSize: 12.5,
        }}>{error}</div>
      )}

      {loading && (
        <div style={{ color: 'var(--muted-strong)', fontSize: 13 }}>
          Loading team…
        </div>
      )}

      {!loading && team.length === 0 && (
        <div style={{ color: 'var(--muted-strong)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
          No team members yet. Invite teammates from Settings.
        </div>
      )}

      {!loading && team.length > 0 && (
        <div className="sp-team-list">
          {team.map((member) => {
            const isSelected = selectedId === member.id;
            const isCurrent = member.id === currentAssigneeId;
            return (
              <button
                key={member.id}
                type="button"
                className={`sp-team-row${isSelected ? ' selected' : ''}`}
                onClick={() => setSelectedId(member.id)}
                aria-pressed={isSelected}
              >
                <span className="sp-team-av">{initialsOf(member.name || member.email)}</span>
                <span className="sp-team-info">
                  <span className="sp-team-name">{member.name || member.email}</span>
                  {member.role && <span className="sp-team-role">{member.role}</span>}
                </span>
                {isCurrent && <span className="sp-team-current-badge">Current</span>}
              </button>
            );
          })}
        </div>
      )}
    </SupplierModal>
  );
}
