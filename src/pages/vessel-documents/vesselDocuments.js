// vesselDocuments — data layer for the vessel master documents vault.
//
// A self-referencing folder/file tree in `vessel_documents`, with files stored
// in the private 'vessel-vault' bucket. Command/Chief only (enforced by RLS).
// Expiry status reuses the crew-document RAG thresholds so cert tracking reads
// the same across the app.

import { supabase } from '../../lib/supabaseClient';

export { getExpiryStatus, formatDocDate } from '../crew-profile/utils/crewDocuments';

const BUCKET = 'vessel-vault';
const ONE_YEAR = 60 * 60 * 24 * 365;

// Slugify a filename for a storage key (keys reject non-ASCII; "/" is a folder
// separator). The original name is kept on the row for display/download.
const safeName = (name) =>
  (name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.]+/, '') || 'file';

// Direct children of a folder (parent_id null = vault root), folders first then
// files, each alphabetical.
export async function fetchChildren({ tenantId, parentId = null }) {
  if (!tenantId) return [];
  let q = supabase.from('vessel_documents').select('*').eq('tenant_id', tenantId);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data, error } = await q;
  if (error) { console.error('[vault] fetchChildren failed', error); throw error; }
  return (data || []).sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1)
    || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

// Resolve a folder's ancestor chain (root → folder) for the breadcrumb.
export async function fetchBreadcrumb({ tenantId, folderId }) {
  if (!tenantId || !folderId) return [];
  const chain = [];
  let id = folderId;
  // Guard against cycles / runaway loops.
  for (let i = 0; i < 64 && id; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase
      .from('vessel_documents')
      .select('id, name, parent_id')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) break;
    chain.unshift({ id: data.id, name: data.name });
    id = data.parent_id;
  }
  return chain;
}

export async function createFolder({ tenantId, parentId = null, name, createdBy = null }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Folder name required');
  const { data, error } = await supabase.from('vessel_documents').insert({
    tenant_id: tenantId,
    parent_id: parentId,
    kind: 'folder',
    name: clean,
    created_by: createdBy,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function uploadFile({ tenantId, parentId = null, file, expiryDate = null, createdBy = null }) {
  const path = `${tenantId}/${Date.now()}-${safeName(file.name)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false,
  });
  if (up.error) throw up.error;
  const { data, error } = await supabase.from('vessel_documents').insert({
    tenant_id: tenantId,
    parent_id: parentId,
    kind: 'file',
    name: file.name || 'file',
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size || null,
    expiry_date: expiryDate || null,
    created_by: createdBy,
  }).select().single();
  if (error) {
    // Roll back the orphaned object if the row insert fails.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

export async function renameItem({ id, name }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Name required');
  const { data, error } = await supabase.from('vessel_documents')
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function setExpiry({ id, expiryDate }) {
  const { data, error } = await supabase.from('vessel_documents')
    .update({ expiry_date: expiryDate || null, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Gather every file storage path beneath a folder (recursive), so we can purge
// the objects before the rows cascade-delete.
async function collectDescendantPaths({ tenantId, folderId }) {
  const kids = await fetchChildren({ tenantId, parentId: folderId });
  let paths = [];
  for (const k of kids) {
    if (k.kind === 'file' && k.storage_path) paths.push(k.storage_path);
    // eslint-disable-next-line no-await-in-loop
    else if (k.kind === 'folder') paths = paths.concat(await collectDescendantPaths({ tenantId, folderId: k.id }));
  }
  return paths;
}

// Delete a file or a folder (and everything under it). Storage objects are
// removed first; the row delete cascades to descendant rows via the FK.
export async function deleteItem({ tenantId, item }) {
  if (item.kind === 'file') {
    if (item.storage_path) await supabase.storage.from(BUCKET).remove([item.storage_path]).catch(() => {});
  } else {
    const paths = await collectDescendantPaths({ tenantId, folderId: item.id });
    if (paths.length) {
      // Storage remove() caps at ~1000 keys per call — chunk to be safe.
      for (let i = 0; i < paths.length; i += 900) {
        // eslint-disable-next-line no-await-in-loop
        await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 900)).catch(() => {});
      }
    }
  }
  const { error } = await supabase.from('vessel_documents').delete().eq('id', item.id);
  if (error) throw error;
}

// A fresh signed URL for opening/downloading a file.
export async function getFileUrl(storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ONE_YEAR);
  if (error) { console.error('[vault] getFileUrl failed', error); return null; }
  return data?.signedUrl || null;
}
