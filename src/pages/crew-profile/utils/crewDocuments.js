import { supabase } from '../../../lib/supabaseClient';

const BUCKET = 'crew-documents';
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * RAG status for a document, driven by its expiry date.
 * Thresholds mirror the dashboard alert windows: 90 / 60 / 30 days.
 *   expired  → red
 *   ≤30 days → red
 *   ≤90 days → amber
 *   else     → green
 *   no date  → neutral
 */
export const getExpiryStatus = (expiryDate) => {
  if (!expiryDate) return { level: 'none', label: 'No expiry', days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  const days = Math.round((exp - today) / 86400000);
  if (days < 0) return { level: 'expired', label: `Expired ${Math.abs(days)}d ago`, days };
  if (days <= 30) return { level: 'red', label: `${days}d left`, days };
  if (days <= 90) return { level: 'amber', label: `${days}d left`, days };
  return { level: 'green', label: 'Valid', days };
};

export const EXPIRY_STATUS_CLASSES = {
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  red:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  amber:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  green:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  none:    'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

// Unambiguous European date display (dd MMM yyyy).
export const formatDocDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fetchCrewDocuments = async (userId) => {
  if (!userId) return [];
  const { data, error } = await supabase
    ?.from('personal_documents')
    ?.select('*')
    ?.eq('user_id', userId)
    ?.order('expiry_date', { ascending: true, nullsFirst: false });
  if (error) {
    console.error('[docs] fetch failed', error);
    throw error;
  }
  return data || [];
};

/**
 * Upload a file to crew-documents/{userId}/... and return a signed URL +
 * metadata. The storage path is kept so the URL can be re-signed later.
 */
export const uploadDocumentFile = async (userId, file) => {
  const path = `${userId}/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabase?.storage?.from(BUCKET)?.upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data: urlData, error: urlErr } = await supabase
    ?.storage?.from(BUCKET)?.createSignedUrl(path, ONE_YEAR);
  if (urlErr) throw urlErr;
  return {
    file_url: urlData?.signedUrl || null,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size || null,
    storage_path: path,
  };
};

export const saveCrewDocument = async (doc) => {
  const payload = {
    user_id: doc.userId,
    tenant_id: doc.tenantId || null,
    category: doc.category || null,
    doc_type: doc.docType,
    title: doc.title || null,
    document_number: doc.documentNumber || null,
    issuing_authority: doc.issuingAuthority || null,
    flag_state: doc.flagState || null,
    issue_date: doc.issueDate || null,
    expiry_date: doc.expiryDate || null,
    details: doc.details || {},
    file_url: doc.fileUrl || null,
    file_name: doc.fileName || null,
    mime_type: doc.mimeType || null,
    size_bytes: doc.sizeBytes || null,
    updated_at: new Date().toISOString(),
  };
  let res;
  if (doc.id) {
    res = await supabase?.from('personal_documents')?.update(payload)?.eq('id', doc.id)?.select()?.single();
  } else {
    payload.created_by = doc.createdBy || null;
    res = await supabase?.from('personal_documents')?.insert(payload)?.select()?.single();
  }
  if (res?.error) throw res.error;
  return res?.data;
};

export const deleteCrewDocument = async (id) => {
  const { error } = await supabase?.from('personal_documents')?.delete()?.eq('id', id);
  if (error) throw error;
};

/**
 * Documents expiring within `withinDays` (or already expired), newest-expiry
 * first. RLS scopes the result automatically: a crew member sees only their
 * own; COMMAND sees their whole tenant's crew. Each row is enriched with the
 * crew member's name for the dashboard list.
 */
export const fetchExpiringDocuments = async (withinDays = 90) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    ?.from('personal_documents')
    ?.select('id, user_id, doc_type, details, expiry_date')
    ?.not('expiry_date', 'is', null)
    ?.lte('expiry_date', cutoffStr)
    ?.order('expiry_date', { ascending: true });
  if (error) {
    console.error('[docs] expiring fetch failed', error);
    return [];
  }
  const docs = data || [];
  const ids = [...new Set(docs.map((d) => d.user_id).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const { data: profs } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', ids);
    (profs || []).forEach((p) => { names[p.id] = p.full_name; });
  }
  return docs.map((d) => ({ ...d, crew_name: names[d.user_id] || null }));
};

