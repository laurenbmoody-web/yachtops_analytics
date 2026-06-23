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

// Surface docs expiring within 90 days OR already expired. Returns
// rows in the same shape NotificationsDrawer expects. Respects the viewer's
// document-expiry notification preference (off → returns nothing).
export async function fetchDerivedNotifications(userId = null) {
  try {
    if (userId) {
      const { data: pref } = await supabase
        .from('notification_preferences')
        .select('notify_document_expiry')
        .eq('user_id', userId)
        .maybeSingle();
      if (pref && pref.notify_document_expiry === false) return [];
    }
    const docs = await fetchExpiringDocuments(90);
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
      const vdocs = await fetchExpiringVesselDocuments({ withinDays: 90 });
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

    return out;
  } catch (err) {
    console.warn('[derivedNotifications] doc expiry fetch failed:', err?.message);
    return [];
  }
}
