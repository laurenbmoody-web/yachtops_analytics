import React from 'react';

const STATUS_MAP = {
  // orders
  draft:               { label: 'Draft',        cls: 'new' },
  sent:                { label: 'Sent',          cls: 'new' },
  confirmed:           { label: 'Confirmed',     cls: 'confirmed' },
  partially_confirmed: { label: 'Part. confirmed', cls: 'picking' },
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
