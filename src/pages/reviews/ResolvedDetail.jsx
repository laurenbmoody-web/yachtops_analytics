import React from 'react';
import Icon from '../../components/AppIcon';
import { fmtDateRange } from './reviewFormat';
import SnapshotRotaLines from './SnapshotRotaLines';

// ResolvedDetail — read-only right-pane view for a History (resolved) item.
// No rota grid, no actions: just the outcome and the submission's metadata.
// (The full rota-snapshot view could be a later enhancement.)

const OUTCOME = {
  accepted:             { label: 'Accepted', cls: 'ok', icon: 'CheckCircle', verb: 'Accepted by' },
  accepted_with_edits:  { label: 'Accepted with edits', cls: 'ok', icon: 'CheckCircle', verb: 'Edited & accepted by' },
  rejected:             { label: 'Rejected', cls: 'warn', icon: 'XCircle', verb: 'Rejected by' },
};

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function initials(name) {
  if (!name) return '—';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Person({ name, role }) {
  return (
    <span className="rv-meta-person">
      <span className="rv-meta-avatar" aria-hidden="true">{initials(name)}</span>
      <span className="rv-meta-person-text">
        <span className="rv-meta-person-name">{name || 'crew'}</span>
        {role && <span className="rv-meta-person-role">{role}</span>}
      </span>
    </span>
  );
}

export default function ResolvedDetail({ item }) {
  if (!item) return null;
  const o = OUTCOME[item.status] || { label: item.status || 'Resolved', cls: '', icon: 'Info', verb: 'Decided by' };
  const range = fmtDateRange(item.date_start, item.date_end);
  const counts = `${item.day_count} day${item.day_count === 1 ? '' : 's'} · ${item.shift_count} shift${item.shift_count === 1 ? '' : 's'}`;
  const when = fmtWhen(item.decided_at);
  const submittedWhen = fmtWhen(item.created_at);
  return (
    <div className="rv-resolved">
      <div className="rv-resolved-eyebrow">
        {item.department_name || ''}{item.mlc_override_count > 0 ? ` · ${item.mlc_override_count} MLC override${item.mlc_override_count === 1 ? '' : 's'}` : ''}
      </div>
      <h2 className="rv-rp-title">{item.rota_name || 'Rota'}</h2>

      <div className={`rv-resolved-badge ${o.cls}`}>
        <Icon name={o.icon} size={16} />
        <span>{o.label}</span>
      </div>

      <div className="rv-resolved-meta">
        <div className="rv-meta-row">
          <span className="rv-meta-k">Submitted by</span>
          <span className="rv-meta-v">
            <Person name={item.submitter_name} role={item.submitter_role} />
            {submittedWhen && <><span className="rv-meta-sep" aria-hidden="true" /><span className="rv-meta-when">{submittedWhen}</span></>}
          </span>
        </div>
        <div className="rv-meta-row">
          <span className="rv-meta-k">Coverage</span>
          <span className="rv-meta-v">{range ? `${range} · ${counts}` : counts}</span>
        </div>
        <div className="rv-meta-row">
          <span className="rv-meta-k">{o.verb}</span>
          <span className="rv-meta-v">
            {item.decided_by_name
              ? <Person name={item.decided_by_name} role={item.decided_by_role} />
              : <span className="rv-meta-person-name">—</span>}
            {when && <><span className="rv-meta-sep" aria-hidden="true" /><span className="rv-meta-when">{when}</span></>}
          </span>
        </div>
        {item.decision_note && (
          <div className={`rv-meta-note ${o.cls}`}>
            <span className="rv-meta-note-k">{item.status === 'rejected' ? 'Reason' : 'Note'}</span>
            <span className="rv-meta-note-v">{item.decision_note}</span>
          </div>
        )}
      </div>

      <SnapshotRotaLines
        snapshotId={item.snapshot_id}
        dateStart={item.date_start}
        dateEnd={item.date_end}
      />
    </div>
  );
}
