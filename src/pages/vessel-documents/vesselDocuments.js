// vesselDocuments — data layer for the vessel master documents vault.
//
// A self-referencing folder/file tree in `vessel_documents`, with files stored
// in the private 'vessel-vault' bucket. Command/Chief only (enforced by RLS).
// Expiry status reuses the crew-document RAG thresholds so cert tracking reads
// the same across the app.

import { supabase } from '../../lib/supabaseClient';

export { getExpiryStatus, formatDocDate } from '../crew-profile/utils/crewDocuments';
import { formatDocDate as fmtDocDate } from '../crew-profile/utils/crewDocuments';

const BUCKET = 'vessel-vault';
const ONE_YEAR = 60 * 60 * 24 * 365;

// ── Linked (virtual) system folders ────────────────────────────────────────
// The vault is the vessel's single home for documents, so two stores that live
// in their own tables/buckets are *surfaced* here as read-only "linked" folders
// rather than copied — keeping one source of truth:
//   • Hours of Rest      — signed monthly MLC records (hor_signed_documents →
//                          hor-documents bucket), filed by month.
//   • Contract Templates — the crew-contract templates (contract_templates →
//                          vessel-documents bucket).
// Their ids are namespaced `virt:*` so the tree logic can tell them apart from
// real rows and refuse mutating actions (rename / move / delete / expiry).
export const VIRT_HOR = 'virt:hor';
export const VIRT_TEMPLATES = 'virt:templates';
const HOR_BUCKET = 'hor-documents';
const TEMPLATES_BUCKET = 'vessel-documents';
export const isVirtualId = (id) => typeof id === 'string' && id.startsWith('virt:');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// The linked folders that sit at the vault root alongside real items.
const systemFolders = () => ([
  { id: VIRT_HOR, kind: 'folder', name: 'Hours of Rest', system: true, meta: 'Signed records · linked' },
  { id: VIRT_TEMPLATES, kind: 'folder', name: 'Contract Templates', system: true, meta: 'Templates · linked' },
]);

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
  // Linked branches (Hours of Rest / Contract Templates) read from their own
  // stores rather than vessel_documents.
  if (isVirtualId(parentId)) return fetchVirtualChildren({ tenantId, parentId });

  let q = supabase.from('vessel_documents').select('*').eq('tenant_id', tenantId);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data, error } = await q;
  if (error) { console.error('[vault] fetchChildren failed', error); throw error; }
  const sorted = (data || []).sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1)
    || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  // At the vault root, surface the linked system folders above real items.
  return parentId ? sorted : [...systemFolders(), ...sorted];
}

// Children of a linked (virtual) folder. Returns items in the same shape the UI
// expects, flagged `readOnly` (and carrying their source `bucket`) so the tree
// opens them but never offers to mutate them.
async function fetchVirtualChildren({ tenantId, parentId }) {
  // Hours of Rest → one folder per signed month, newest first.
  if (parentId === VIRT_HOR) {
    const { data, error } = await supabase
      .from('hor_signed_documents')
      .select('period_year, period_month')
      .eq('tenant_id', tenantId);
    if (error) { console.error('[vault] HOR months failed', error); return []; }
    const months = new Map();
    (data || []).forEach((r) => months.set(`${r.period_year}-${r.period_month}`, r));
    return [...months.values()]
      .sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month)
      .map((r) => ({
        id: `${VIRT_HOR}:${r.period_year}-${r.period_month}`,
        kind: 'folder',
        system: true,
        name: `${MONTH_NAMES[r.period_month - 1]} ${r.period_year}`,
      }));
  }

  // Hours of Rest → a month's signed records, one PDF per seafarer.
  if (parentId.startsWith(`${VIRT_HOR}:`)) {
    const [year, month] = parentId.slice(`${VIRT_HOR}:`.length).split('-').map(Number);
    const { data, error } = await supabase
      .from('hor_signed_documents')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('period_year', year)
      .eq('period_month', month);
    if (error) { console.error('[vault] HOR records failed', error); return []; }
    const ids = [...new Set((data || []).map((d) => d.subject_user_id).filter(Boolean))];
    const names = {};
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      (profs || []).forEach((p) => { names[p.id] = p.full_name; });
    }
    return (data || []).map((r) => ({
      id: `virt:horfile:${r.storage_path}`,
      kind: 'file',
      readOnly: true,
      bucket: HOR_BUCKET,
      name: names[r.subject_user_id] ? `${names[r.subject_user_id]} — Record of rest` : (r.file_name || 'Record of rest'),
      storage_path: r.storage_path,
      mime_type: 'application/pdf',
      size_bytes: r.byte_size || null,
      meta: r.archived_at ? `Signed · ${fmtDocDate(r.archived_at)}` : null,
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  // Contract Templates → a flat list of the tenant's templates.
  if (parentId === VIRT_TEMPLATES) {
    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[vault] templates failed', error); return []; }
    return (data || []).map((t) => ({
      id: `virt:tplfile:${t.id}`,
      kind: 'file',
      readOnly: true,
      bucket: TEMPLATES_BUCKET,
      name: t.name || t.file_name || 'Template',
      storage_path: t.storage_path,
      mime_type: t.mime_type,
      size_bytes: t.size_bytes || null,
      meta: (t.roles && t.roles.length) ? t.roles.join(', ') : 'Any role',
    }));
  }

  return [];
}

// Resolve a folder's ancestor chain (root → folder) for the breadcrumb.
export async function fetchBreadcrumb({ tenantId, folderId }) {
  if (!tenantId || !folderId) return [];
  // Linked branches have a synthetic, known chain — no DB walk needed.
  if (isVirtualId(folderId)) {
    if (folderId === VIRT_HOR) return [{ id: VIRT_HOR, name: 'Hours of Rest' }];
    if (folderId.startsWith(`${VIRT_HOR}:`)) {
      const [year, month] = folderId.slice(`${VIRT_HOR}:`.length).split('-').map(Number);
      return [
        { id: VIRT_HOR, name: 'Hours of Rest' },
        { id: folderId, name: `${MONTH_NAMES[month - 1]} ${year}` },
      ];
    }
    if (folderId === VIRT_TEMPLATES) return [{ id: VIRT_TEMPLATES, name: 'Contract Templates' }];
    return [];
  }
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

// A fresh signed URL for opening/downloading a file. Linked items pass their own
// source `bucket` (hor-documents / vessel-documents); real items use the vault.
export async function getFileUrl(storagePath, bucket = BUCKET) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, ONE_YEAR);
  if (error) { console.error('[vault] getFileUrl failed', error); return null; }
  return data?.signedUrl || null;
}

// Re-parent a folder or file. Guards against moving a folder into itself or one
// of its own descendants (which would orphan the subtree). Linked items can't
// be moved. `newParentId` null = the vault root.
export async function moveItem({ tenantId, id, newParentId }) {
  if (isVirtualId(id) || isVirtualId(newParentId)) throw new Error('Linked items can’t be moved');
  if (newParentId === id) throw new Error('Can’t move a folder into itself');
  if (newParentId) {
    // Walk the destination's ancestor chain; hitting `id` means a cycle.
    let cur = newParentId;
    for (let i = 0; i < 64 && cur; i += 1) {
      if (cur === id) throw new Error('Can’t move a folder inside itself');
      // eslint-disable-next-line no-await-in-loop
      const { data } = await supabase.from('vessel_documents')
        .select('parent_id').eq('tenant_id', tenantId).eq('id', cur).maybeSingle();
      cur = data?.parent_id || null;
    }
  }
  const { error } = await supabase.from('vessel_documents')
    .update({ parent_id: newParentId || null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Sub-folders of a folder (real items only), for the move-destination picker.
export async function fetchFolders({ tenantId, parentId = null }) {
  if (!tenantId) return [];
  let q = supabase.from('vessel_documents').select('id, name, parent_id')
    .eq('tenant_id', tenantId).eq('kind', 'folder');
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data, error } = await q;
  if (error) { console.error('[vault] fetchFolders failed', error); return []; }
  return (data || []).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

// Vessel documents that carry an expiry within `withinDays` (or already lapsed),
// soonest first — powers the renewal reminders (bell + dashboard card). RLS
// scopes the read to the caller's tenant(s); pass `tenantId` to narrow further.
export async function fetchExpiringVesselDocuments({ tenantId = null, withinDays = 90 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);
  let q = supabase.from('vessel_documents')
    .select('id, name, expiry_date')
    .eq('kind', 'file')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', cutoff.toISOString().slice(0, 10))
    .order('expiry_date', { ascending: true });
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) { console.error('[vault] expiring fetch failed', error); return []; }
  return data || [];
}
