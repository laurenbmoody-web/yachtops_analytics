import React from 'react';

// Supplier-portal status display map. Sprint 9c.2a migrated the schema
// to a canonical 8-stage lifecycle but kept this surface unchanged in
// terms of label vocabulary — the editorial 8-stage Timeline lands on
// the vessel side (Sprint 9c.2). One rename mapping added so the new
// canonical 'received' value renders as the supplier-side label
// 'Delivered'. Other new canonical values (dispatched, out_for_delivery,
// invoiced, paid) keep their existing fallback behaviour or rely on
// pre-existing entries in the map below.
const STATUS_MAP = {
  // orders
  draft:               { label: 'Draft',        cls: 'new' },
  sent:                { label: 'Sent',          cls: 'new' },
  confirmed:           { label: 'Confirmed',     cls: 'confirmed' },
  // items
  pending:             { label: 'Pending',       cls: 'new' },
  unavailable:         { label: 'Unavailable',   cls: 'issues' },
  substituted:         { label: 'Substituted',   cls: 'picking' },
  // invoices
  paid:                { label: 'Paid',          cls: 'confirmed' },
  overdue:             { label: 'Overdue',       cls: 'issues' },
  disputed:            { label: 'Disputed',      cls: 'issues' },
  // deliveries
  scheduled:           { label: 'Scheduled',    cls: 'new' },
  en_route:            { label: 'En route',     cls: 'picking' },
  delivered:           { label: 'Delivered',    cls: 'confirmed' },
  failed:              { label: 'Failed',        cls: 'issues' },
  rescheduled:         { label: 'Rescheduled',  cls: 'picking' },
  // canonical → supplier-display rename mapping (9c.2a)
  received:            { label: 'Delivered',    cls: 'confirmed' },
};

const StatusBadge = ({ status, style }) => {
  const { label, cls } = STATUS_MAP[status] ?? { label: status, cls: 'new' };
  return (
    <span className={`sp-status ${cls}`} style={style}>
      <span className="d" />{label}
    </span>
  );
};

export default StatusBadge;
