// derivedNotifications — synthesized in-memory notification rows.
//
// Some signals don't need their own DB rows because the source data is
// already authoritative — querying it at bell-open time and projecting
// "expired N days ago" / "expiring in 12d" into the notification shape
// is enough. Document expiries are the first example: the personal_
// documents.expiry_date column carries the signal, RLS scopes the read
// (own docs for crew, tenant-wide for COMMAND), and the bell merges
// these into its feed alongside the localStorage + DB sources.
//
// No write paths here — derived notifications can't be "cleared" via
// the bell (the underlying doc has to be renewed or removed for the
// signal to disappear). isRead is hardcoded false so they always
// surface; mark-all-read in the bell just doesn't touch them.

import { fetchExpiringDocuments, getExpiryStatus } from '../pages/crew-profile/utils/crewDocuments';
import { getDocTypeLabel } from '../pages/crew-profile/documentTypes';
import { fetchExpiringVesselDocuments } from '../pages/vessel-documents/vesselDocuments';
import { supabase } from './supabaseClient';

// Laundry signals that don't need their own rows: pieces past their needed-by
// (overdue) and pieces flagged missing / damaged. RLS scopes to the tenant.
async function fetchLaundryNotifications() {
  try {
    const { data } = await supabase
      .from('laundry_items')
      .select('id, description, owner_name, area, status, needed_by, flag')
      .is('archived_at', null)
      .neq('status', 'Delivered')
      .limit(200);
    const now = Date.now();
    const rows = [];
    const mk = (it, type, title, message, severity, at) => rows.push({
      id: `${type}:${it.id}`, type, title, message, severity,
      actionUrl: '/laundry-management-dashboard', isRead: false,
      createdAt: at || new Date().toISOString(), _source: 'derived',
    });
    for (const it of data || []) {
      const who = it.owner_name && it.owner_name !== 'Unknown' ? ` — ${it.owner_name}` : '';
      const item = it.description || 'Laundry item';
      if (it.flag === 'missing') mk(it, 'LAUNDRY_MISSING', 'Laundry missing', `${item}${who} flagged missing`, 'urgent');
      else if (it.flag === 'damaged') mk(it, 'LAUNDRY_DAMAGED', 'Laundry damaged', `${item}${who} flagged damaged`, 'warn');
      if (it.needed_by && new Date(it.needed_by).getTime() < now) {
        mk(it, 'LAUNDRY_OVERDUE', 'Laundry overdue', `${item}${who}${it.area ? ` (${it.area})` : ''} is past its needed-by`, 'urgent', it.needed_by);
      }
    }
    return rows;
  } catch (e) {
    console.warn('[derivedNotifications] laundry fetch failed:', e?.message);
    return [];
  }
}

// Surface docs expiring within 90 days OR already expired. Returns
// rows in the same shape NotificationsDrawer expects. Respects the viewer's
// document-expiry notification preference (off → returns nothing).
export async function fetchDerivedNotifications(userId = null) {
  let allowVesselDocs = true;
  const laundry = await fetchLaundryNotifications();
  try {
    let allowCrewDocs = true;
    if (userId) {
      const { data: pref } = await supabase
        .from('notification_preferences')
        .select('notify_document_expiry, notify_vessel_docs')
        .eq('user_id', userId)
        .maybeSingle();
      if (pref && pref.notify_document_expiry === false) allowCrewDocs = false;
      if (pref && pref.notify_vessel_docs === false) allowVesselDocs = false;
    }
    if (!allowCrewDocs && !allowVesselDocs) return laundry;
    const docs = allowCrewDocs ? await fetchExpiringDocuments(90) : [];
    const out = (docs || []).map((d) => {
      const s = getExpiryStatus(d.expiry_date);
      const days = s?.days ?? null;
      const label = getDocTypeLabel(d.doc_type) || d.doc_type || 'Document';
      const who   = d.crew_name ? ` — ${d.crew_name}` : '';
      let title, message, severity;
      if (s?.level === 'expired') {
        title    = 'Document expired';
        message  = `${label}${who} expired ${days != null ? `${Math.abs(days)} days ago` : ''}`.trim();
        severity = 'urgent';
      } else if (s?.level === 'urgent') {
        title    = 'Document expiring soon';
        message  = `${label}${who} expires in ${days}d`;
        severity = 'warn';
      } else {
        title    = 'Document expiry';
        message  = `${label}${who} expires in ${days}d`;
        severity = 'info';
      }
      return {
        id: `doc_expiry:${d.id}`,
        type: 'DOC_EXPIRY',
        title,
        message,
        severity,
        actionUrl: d.user_id ? `/crew/${d.user_id}#documents` : null,
        isRead: false,
        createdAt: d.expiry_date ? new Date(d.expiry_date).toISOString() : new Date().toISOString(),
        _source: 'derived',
      };
    });

    // Vessel documents (ship's papers / certificates). RLS only returns these
    // to Command/Chief, so non-senior crew see nothing here.
    try {
      const vdocs = allowVesselDocs ? await fetchExpiringVesselDocuments({ withinDays: 90 }) : [];
      (vdocs || []).forEach((d) => {
        const s = getExpiryStatus(d.expiry_date);
        const days = s?.days ?? null;
        let title; let message; let severity;
        if (s?.level === 'expired') {
          title = 'Vessel document expired';
          message = `${d.name} expired ${days != null ? `${Math.abs(days)} days ago` : ''}`.trim();
          severity = 'urgent';
        } else if (s?.level === 'red') {
          title = 'Vessel document expiring soon';
          message = `${d.name} expires in ${days}d`;
          severity = 'warn';
        } else {
          title = 'Vessel document expiry';
          message = `${d.name} expires in ${days}d`;
          severity = 'info';
        }
        out.push({
          id: `vessel_doc_expiry:${d.id}`,
          type: 'VESSEL_DOC_EXPIRY',
          title,
          message,
          severity,
          actionUrl: '/vessel-documents',
          isRead: false,
          createdAt: d.expiry_date ? new Date(d.expiry_date).toISOString() : new Date().toISOString(),
          _source: 'derived',
        });
      });
    } catch (e) {
      console.warn('[derivedNotifications] vessel doc expiry fetch failed:', e?.message);
    }

    return [...out, ...laundry];
  } catch (err) {
    console.warn('[derivedNotifications] doc expiry fetch failed:', err?.message);
    return laundry;
  }
}
