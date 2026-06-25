import { supabase } from '../../../lib/supabaseClient';
import { getDocType, allowsMultipleDocs } from '../documentTypes';

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
  // Supabase storage keys reject non-ASCII (e.g. the em-dash "—") and treat "/"
  // as a folder separator, so slugify the filename for the key. The original
  // file.name is still returned for display/download.
  const safe = (file.name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.]+/, '') || 'file';
  const path = `${userId}/${Date.now()}-${safe}`;
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

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

/**
 * Send a file to the parse-crew-document edge function (Claude vision) and
 * return suggested fields { doc_type, document_number, issue_date,
 * expiry_date, issuing_authority, flag_state, details }. Suggestions only —
 * the user confirms before saving.
 */
export const parseDocumentFile = async (file) => {
  const base64 = await fileToBase64(file);
  const { data, error } = await supabase.functions.invoke('parse-crew-document', {
    body: { base64, mediaType: file.type || 'application/octet-stream' },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.suggestion || {};
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

/**
 * Upload the attached file (if any) and persist a document from the in-memory
 * form shape used by the Add/Edit modal and the batch review. Shared so both
 * paths save identically. Returns the saved row.
 */
export const persistCrewDocument = async ({ form, file, userId, tenantId, createdBy }) => {
  const typeDef = getDocType(form.docType);
  let fileMeta = {};
  if (file) {
    const up = await uploadDocumentFile(userId, file);
    fileMeta = {
      fileUrl: up.file_url, fileName: up.file_name,
      mimeType: up.mime_type, sizeBytes: up.size_bytes,
      details: { ...form.details, storage_path: up.storage_path },
    };
  }
  return saveCrewDocument({
    id: form.id,
    userId, tenantId, createdBy,
    category: typeDef?.category || 'other',
    docType: form.docType,
    documentNumber: form.documentNumber,
    issuingAuthority: form.issuingAuthority,
    flagState: form.flagState,
    issueDate: form.issueDate || null,
    expiryDate: form.expiryDate || null,
    details: fileMeta.details || form.details,
    fileUrl: fileMeta.fileUrl ?? form.fileUrl,
    fileName: fileMeta.fileName ?? form.fileName,
    mimeType: fileMeta.mimeType ?? form.mimeType,
    sizeBytes: fileMeta.sizeBytes ?? form.sizeBytes,
  });
};

// Recency key for a document — latest expiry wins, then latest issue, then
// most recently created. YYYY-MM-DD / ISO timestamps sort lexicographically.
const recencyKey = (d) => `${d.expiry_date || ''}|${d.issue_date || ''}|${d.created_at || ''}`;

/**
 * Split a flat document list into the *current* record per single-instance type
 * and the older records it supersedes. Types that legitimately allow several at
 * once (visas, issued letters, …) each stay current. Returns:
 *   { currents: [...docs], previousById: Map(currentId -> [olderDocs]) }
 * so the UI shows one live row per credential with prior versions tucked under
 * it, and alerts count only what's current.
 */
export const groupDocumentVersions = (docs = []) => {
  const single = new Map();
  const currents = [];
  for (const d of docs) {
    if (allowsMultipleDocs(d.doc_type)) { currents.push(d); continue; }
    const arr = single.get(d.doc_type) || [];
    arr.push(d);
    single.set(d.doc_type, arr);
  }
  const previousById = new Map();
  for (const arr of single.values()) {
    arr.sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)));
    currents.push(arr[0]);
    if (arr.length > 1) previousById.set(arr[0].id, arr.slice(1));
  }
  return { currents, previousById };
};

/**
 * Find an existing document that looks like a duplicate of `form` (same type and
 * either the same document number or the same issue+expiry dates). Used to warn
 * before adding a second identical copy. A refreshed cert (different expiry) is
 * NOT a duplicate — that's handled by version grouping instead.
 */
export const findDuplicateDoc = (docs = [], form = {}) => {
  if (!form.docType) return null;
  const n = (v) => String(v ?? '').trim().toLowerCase();
  return docs.find((d) => {
    if (d.id === form.id) return false;
    if (d.doc_type !== form.docType) return false;
    const sameNumber = n(d.document_number) && n(d.document_number) === n(form.documentNumber);
    const sameDates = (!!d.issue_date || !!d.expiry_date)
      && (d.issue_date || '') === (form.issueDate || '')
      && (d.expiry_date || '') === (form.expiryDate || '');
    return sameNumber || sameDates;
  }) || null;
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
 *
 * Superseded records are excluded: we pull each crew member's full document set
 * and keep only the current record per single-instance type (same rule as the
 * profile tab), so last cycle's expired cert never raises a stale alert once a
 * refreshed one is on file.
 */
export const fetchExpiringDocuments = async (withinDays = 90) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    ?.from('personal_documents')
    ?.select('id, user_id, doc_type, details, expiry_date, issue_date, created_at');
  if (error) {
    console.error('[docs] expiring fetch failed', error);
    return [];
  }

  // Keep only current records, grouped per crew member (version grouping is
  // per person + type), then narrow to the expiring window.
  const byUser = new Map();
  for (const d of data || []) {
    const a = byUser.get(d.user_id) || [];
    a.push(d);
    byUser.set(d.user_id, a);
  }
  const docs = [];
  for (const arr of byUser.values()) docs.push(...groupDocumentVersions(arr).currents);

  const expiring = docs
    .filter((d) => d.expiry_date && String(d.expiry_date).slice(0, 10) <= cutoffStr)
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));

  const ids = [...new Set(expiring.map((d) => d.user_id).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const { data: profs } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', ids);
    (profs || []).forEach((p) => { names[p.id] = p.full_name; });
  }
  return expiring.map((d) => ({ ...d, crew_name: names[d.user_id] || null }));
};

