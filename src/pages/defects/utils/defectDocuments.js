// Defect quote/invoice attachments. Files go to the private `defect-documents`
// bucket (path: tenantId/defectId/…); defect_documents rows keep the object path
// plus the money, so the repair record can show quoted-vs-invoiced variance.
// Read-time we batch-sign the paths into short-lived URLs. Mirrors the
// laundry-photos / vessel-vault patterns.
import { supabase } from '../../../lib/supabaseClient';

const BUCKET = 'defect-documents';
const SIGN_TTL = 3600;
const safeName = (n) => (n || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);

export const DEFECT_DOC_KINDS = { QUOTE: 'quote', INVOICE: 'invoice', OTHER: 'other' };

export const uploadDefectDocument = async ({ defect, file, kind = 'other', amount = null, currency = null, actor }) => {
  if (!file) throw new Error('Choose a file to attach.');
  if (!defect?.id || !actor?.tenantId) throw new Error('Missing defect context.');

  const path = `${actor.tenantId}/${defect.id}/${Date.now()}-${safeName(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;

  const amt = amount != null && amount !== '' ? Number(amount) : null;
  const { data, error } = await supabase.from('defect_documents').insert({
    defect_id: defect.id, tenant_id: actor.tenantId, kind,
    storage_path: path, file_name: file.name || null, mime_type: file.type || null, size_bytes: file.size || null,
    amount: Number.isFinite(amt) ? amt : null, currency: currency || null,
    created_by: actor.userId || null, created_by_name: actor.userName || null,
  }).select('*').single();
  if (error) {
    // Roll the orphaned object back so a failed insert doesn't leave a stray file.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }

  const label = kind === 'quote' ? 'Quote' : kind === 'invoice' ? 'Invoice' : 'Document';
  const money = data.amount != null ? ` (${data.currency || ''}${data.amount})` : '';
  await supabase.from('defect_events').insert({
    defect_id: defect.id, tenant_id: actor.tenantId, type: 'document',
    actor_id: actor.userId || null, actor_name: actor.userName || null,
    summary: `${label} attached${money}`,
  }).then(() => {}, () => {});

  return data;
};

// Rows for a defect with a freshly-signed URL on each. RLS-scoped.
export const fetchDefectDocuments = async (defectId) => {
  if (!defectId) return [];
  const { data, error } = await supabase.from('defect_documents')
    .select('*').eq('defect_id', defectId).order('created_at', { ascending: true });
  if (error) { console.warn('[defects] fetchDefectDocuments', error); return []; }
  const rows = data || [];
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const urls = {};
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL);
    (signed || []).forEach((s) => { if (s?.path && s?.signedUrl) urls[s.path] = s.signedUrl; });
  }
  return rows.map((r) => ({ ...r, url: urls[r.storage_path] || null }));
};

export const deleteDefectDocument = async (doc) => {
  if (!doc?.id) return;
  if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
  await supabase.from('defect_documents').delete().eq('id', doc.id);
};

// Latest quote & invoice amounts → cost variance for the repair record.
export const costSummary = (docs = []) => {
  const latest = (kind) => [...docs].reverse().find((d) => d.kind === kind && d.amount != null);
  const quote = latest('quote');
  const invoice = latest('invoice');
  const variance = quote && invoice ? Number(invoice.amount) - Number(quote.amount) : null;
  return { quote, invoice, variance };
};
