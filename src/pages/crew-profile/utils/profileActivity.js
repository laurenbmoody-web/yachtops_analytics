import { supabase } from '../../../lib/supabaseClient';
import { getStatusLabel } from '../../../utils/crewStatus';
import { getDocTypeLabel } from '../documentTypes';
import { calKind, travelSummary } from './crewCalendar';

// One unified activity feed for a crew profile, aggregated from the event
// sources we already capture. Each source is queried independently and failures
// are swallowed (a tab viewer may lack RLS access to one table, e.g. banking).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const fmtShort = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || '');
};

export const ACTIVITY_CATEGORIES = [
  { id: 'status', label: 'Status', icon: 'Activity', color: '#2F6080', bg: '#E8EFF4' },
  { id: 'travel', label: 'Leave & travel', icon: 'Plane', color: '#2E7D6B', bg: '#E5F0ED' },
  { id: 'document', label: 'Documents', icon: 'FileText', color: '#6B57A0', bg: '#ECE7F6' },
  { id: 'kit', label: 'Kit', icon: 'Shirt', color: '#5C9B6A', bg: '#EAF3EC' },
  { id: 'compliance', label: 'Compliance', icon: 'Clock', color: '#C0504D', bg: '#FBECEB' },
  { id: 'banking', label: 'Banking', icon: 'CreditCard', color: '#8B7A55', bg: '#F3EFE6' },
  { id: 'profile', label: 'Profile', icon: 'User', color: '#6B7280', bg: '#F0F1F4' },
];
export const activityCat = (id) => ACTIVITY_CATEGORIES.find((c) => c.id === id) || ACTIVITY_CATEGORIES[5];

const kitEventTitle = (k) => {
  const d = k.detail || {};
  switch (k.action) {
    case 'issued': return `Kit issued: ${d.item}${d.size ? ` (${d.size})` : ''}`;
    case 'edited': return `Kit item edited: ${d.item}`;
    case 'acknowledged': return `Kit receipt acknowledged (${d.count} item${d.count > 1 ? 's' : ''})`;
    case 'returned': return `Kit returned (${d.count} item${d.count > 1 ? 's' : ''})`;
    case 'lost': return `Kit marked lost: ${d.item}`;
    case 'reinstated': return `Kit reinstated: ${d.item}`;
    case 'removed': return `Kit removed: ${d.item}`;
    case 'size_changed': return `Uniform size updated`;
    default: return 'Kit updated';
  }
};

export const fetchProfileActivity = async (userId) => {
  if (!userId) return [];
  const [statusRes, docsRes, kitRes, horRes, profEvRes, calRes] = await Promise.all([
    supabase.from('crew_status_history').select('id, new_status, old_status, changed_at, changed_by_name, notes').eq('user_id', userId),
    supabase.from('personal_documents').select('id, doc_type, details, created_at, created_by').eq('user_id', userId),
    supabase.from('crew_kit_events').select('id, action, detail, actor_name, created_at').eq('user_id', userId),
    supabase.from('hor_month_status').select('period_year, period_month, submitted_at, submit_signed_name, confirmed_at, approve_signed_name').eq('subject_user_id', userId),
    supabase.from('crew_profile_events').select('id, area, label, old_value, new_value, actor_name, created_at').eq('user_id', userId),
    supabase.from('crew_calendar_entries').select('*').eq('user_id', userId),
  ]);

  const events = [];

  (statusRes.data || []).forEach((s) => events.push({
    id: `st-${s.id}`, at: s.changed_at, category: 'status',
    title: s.old_status ? `Status → ${getStatusLabel(s.new_status)}` : `Status set to ${getStatusLabel(s.new_status)}`,
    detail: s.old_status
      ? `From ${getStatusLabel(s.old_status)}${s.notes ? ` · “${s.notes}”` : ''}`
      : (s.notes ? `“${s.notes}”` : 'Initial status on joining'),
    actor: s.changed_by_name || '',
  }));

  (docsRes.data || []).forEach((d) => events.push({
    id: `doc-${d.id}`, at: d.created_at, category: 'document',
    title: `Document added: ${getDocTypeLabel(d.doc_type, d.details)}`,
    detail: '', actor: '', _actorId: d.created_by,
  }));

  (kitRes.data || []).forEach((k) => events.push({
    id: `kit-${k.id}`, at: k.created_at, category: 'kit',
    title: kitEventTitle(k), detail: '', actor: k.actor_name || '',
  }));

  (horRes.data || []).forEach((h) => {
    const m = `${MONTHS[(h.period_month || 1) - 1]} ${h.period_year}`;
    if (h.submitted_at) events.push({ id: `hor-s-${h.period_year}-${h.period_month}`, at: h.submitted_at, category: 'compliance', title: `Hours of Rest submitted — ${m}`, detail: '', actor: h.submit_signed_name || '' });
    if (h.confirmed_at) events.push({ id: `hor-c-${h.period_year}-${h.period_month}`, at: h.confirmed_at, category: 'compliance', title: `Hours of Rest approved — ${m}`, detail: '', actor: h.approve_signed_name || '' });
  });

  (profEvRes.data || []).forEach((p) => {
    const hasValues = p.old_value != null || p.new_value != null;
    events.push({
      id: `pe-${p.id}`, at: p.created_at,
      category: p.area === 'banking' ? 'banking' : 'profile',
      title: hasValues ? `${p.label} changed` : `${p.label} updated`,
      detail: hasValues ? `“${p.old_value || '—'}” → “${p.new_value || '—'}”` : '',
      actor: p.actor_name || '',
    });
  });

  (calRes.data || []).forEach((c) => {
    const range = `${fmtShort(c.start_date)}${String(c.end_date).slice(0, 10) !== String(c.start_date).slice(0, 10) ? ` – ${fmtShort(c.end_date)}` : ''}`;
    events.push({
      id: `cal-${c.id}`, at: c.created_at, category: 'travel',
      title: `${calKind(c.kind).label}: ${range}`,
      detail: travelSummary(c) || c.note || '', actor: c.actor_name || '',
    });
  });

  // Resolve actor names for events that only carry an id (documents).
  const ids = [...new Set(events.map((e) => e._actorId).filter(Boolean))];
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    const map = {};
    (profs || []).forEach((p) => { map[p.id] = p.full_name; });
    events.forEach((e) => { if (e._actorId && map[e._actorId]) e.actor = map[e._actorId]; });
  }

  return events.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
};
