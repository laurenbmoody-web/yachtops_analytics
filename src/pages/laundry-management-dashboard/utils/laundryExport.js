// Export a set of laundry records to a CSV the crew can keep or hand over —
// the portable, spreadsheet-viewable archive of a voyage / period / day.

import { LaundryStatus, LaundryPriority } from './laundryStorage';

const STATUS_LABEL = {
  [LaundryStatus.IN_PROGRESS]: 'In progress',
  [LaundryStatus.READY_TO_DELIVER]: 'Ready to deliver',
  [LaundryStatus.DELIVERED]: 'Delivered',
};
const kindLabel = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'Guest' : k === 'crew' ? 'Crew' : (k === 'vessel' || k === 'other') ? 'Other' : 'Unknown'; };
const dt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const turnMin = (i) => (i.status === LaundryStatus.DELIVERED && i.deliveredAt && i.createdAt
  ? Math.max(0, Math.round((new Date(i.deliveredAt) - new Date(i.createdAt)) / 60000)) : '');
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const COLUMNS = ['Description', 'Owner', 'Type', 'Cabin / area', 'Laundry no.', 'Colour', 'Care', 'Priority', 'Status', 'Logged', 'Delivered', 'Turnaround (min)', 'Logged by'];

export function laundryItemsToCsv(items) {
  const rows = (items || []).map((i) => [
    i.description, i.ownerName || (kindLabel(i.ownerType) === 'Unknown' ? 'Unknown' : ''), kindLabel(i.ownerType),
    i.area, i.laundryNumber, i.colour, (i.tags || []).join(' / '),
    i.priority === LaundryPriority.URGENT ? 'Urgent' : 'Normal',
    STATUS_LABEL[i.status] || i.status, dt(i.createdAt), dt(i.deliveredAt), turnMin(i), i.createdByName || '',
  ].map(cell).join(','));
  return [COLUMNS.join(','), ...rows].join('\r\n');
}

export function downloadLaundryCsv(items, filename) {
  const csv = laundryItemsToCsv(items);
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename || 'laundry-record').replace(/[^\w.-]+/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
