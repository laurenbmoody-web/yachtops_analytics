import React from 'react';

// Sprint 9c.2a: order statuses align with the 8-stage CHECK constraint
// on supplier_orders.status (draft → sent → confirmed → dispatched →
// out_for_delivery → received → invoiced → paid). The 'cls' values map
// to existing CSS chip styles; "picking" is the warm-yellow style hook
// (legacy class name retained for the in-flight states).
const STATUS_MAP = {
  // orders (8-stage lifecycle)
  draft:               { label: 'Draft',            cls: 'new' },
  sent:                { label: 'Sent',             cls: 'new' },
  confirmed:           { label: 'Confirmed',        cls: 'confirmed' },
  dispatched:          { label: 'Dispatched',       cls: 'picking' },
  out_for_delivery:    { label: 'Out for delivery', cls: 'picking' },
  received:            { label: 'Received',         cls: 'confirmed' },
  invoiced:            { label: 'Invoiced',         cls: 'confirmed' },
  paid:                { label: 'Paid',             cls: 'confirmed' },
  // items
  pending:             { label: 'Pending',          cls: 'new' },
  unavailable:         { label: 'Unavailable',      cls: 'issues' },
  substituted:         { label: 'Substituted',      cls: 'picking' },
  // invoices (legacy fallback for non-order entities)
  overdue:             { label: 'Overdue',          cls: 'issues' },
  disputed:            { label: 'Disputed',         cls: 'issues' },
  // deliveries
  scheduled:           { label: 'Scheduled',        cls: 'new' },
  en_route:            { label: 'En route',         cls: 'picking' },
  delivered:           { label: 'Delivered',        cls: 'confirmed' },
  failed:              { label: 'Failed',           cls: 'issues' },
  rescheduled:         { label: 'Rescheduled',      cls: 'picking' },
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
