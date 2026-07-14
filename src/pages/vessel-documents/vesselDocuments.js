// vesselDocuments — data layer for the vessel master documents vault.
//
// A self-referencing folder/file tree in `vessel_documents`, with files stored
// in the private 'vessel-vault' bucket. Command/Chief only (enforced by RLS).
// Expiry status reuses the crew-document RAG thresholds so cert tracking reads
// the same across the app.

import { supabase } from '../../lib/supabaseClient';

export { getExpiryStatus, formatDocDate } from '../crew-profile/utils/crewDocuments';
import { formatDocDate as fmtDocDate, getExpiryStatus, getDocStatus, groupDocumentVersions, findHistoricDocIds } from '../crew-profile/utils/crewDocuments';
import { getDocTypeLabel, isAdvisoryDocType, getDocType, DOC_CATEGORIES } from '../crew-profile/documentTypes';

const CAT_LABEL = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.id, c.label]));

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
export const VIRT_CREW = 'virt:crew';
export const VIRT_TEMPLATES = 'virt:templates';
const HOR_BUCKET = 'hor-documents';
const TEMPLATES_BUCKET = 'vessel-documents';
export const isVirtualId = (id) => typeof id === 'string' && id.startsWith('virt:');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Crew Certification is an inspection lens over personal_documents — the crew
// profile stays the system of record. Generated contract drafts are working
// files (only-latest-kept, hidden in the profile too), never part of the lens.
const CREW_DOC_EXCLUDE = 'generated';

// The starter scaffold every vessel's vault opens with — a lean, conventional
// filing skeleton for a yacht's papers. Seeded lazily the first time an account
// opens an empty vault (see seedDefaultFolders); crews are free to rename,
// delete, or add to it. Linked stores (Hours of Rest, Contract Templates) cover
// rest records and contracts, so those aren't duplicated here.
export const DEFAULT_VAULT_FOLDERS = [
  'Registration & Flag',
  'Class & Survey',
  'Insurance',
  'Safety & Security',
  'Pollution Prevention (MARPOL)',
  'Manuals & Plans',
  'Operations & Logs',
];

// The linked folders that sit at the vault root alongside real items.
const systemFolders = () => ([
  { id: VIRT_HOR, kind: 'folder', name: 'Hours of Rest', system: true, meta: 'Signed records · linked' },
  { id: VIRT_CREW, kind: 'folder', name: 'Crew Documents', system: true, meta: 'Per-crew · linked' },
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

// Fetch a tenant's crew documents and tag each as `historic` — superseded by a
// newer record of the same single-instance type, or the STCW combined-cert kept
// on file once its elements are refreshed. Mirrors the crew-profile rules so an
// expired-but-replaced cert reads as "Historic" here too, not a live expiry.
// Version grouping is per crew member, so the full per-user set is grouped even
// when only filed docs are later shown.
// Fetch a vessel's crew documents keyed BY OWNER rather than by the
// document's tenant_id — so a crew member's certificates surface in the vessel
// vault the moment they join, even though those files were uploaded on a
// previous vessel (or in personal mode) and carry a different tenant_id. RLS
// (command_manages_tenant_personal_documents) still scopes reads to members the
// caller shares a vessel with, so this never widens what Command can see.
async function fetchCrewDocsForUsers(userIds) {
  if (!userIds?.length) return [];
  const { data, error } = await supabase.from('personal_documents')
    .select('id, user_id, doc_type, category, expiry_date, issue_date, created_at, file_url, file_name, mime_type, size_bytes, title, document_number, issuing_authority')
    .in('user_id', userIds);
  if (error) { console.error('[vault] crew docs by owner fetch failed', error); return []; }
  const byUser = new Map();
  (data || []).forEach((d) => { const a = byUser.get(d.user_id) || []; a.push(d); byUser.set(d.user_id, a); });
  const out = [];
  for (const arr of byUser.values()) {
    const { currents } = groupDocumentVersions(arr);
    const currentIds = new Set(currents.map((c) => c.id));
    const historicIds = findHistoricDocIds(currents);
    arr.forEach((d) => out.push({ ...d, historic: !currentIds.has(d.id) || historicIds.has(d.id) }));
  }
  return out;
}

// Which crew-docs sub-folder a document belongs in: expired/superseded first
// (status-based, so it cuts across types), otherwise Certificates vs Documents
// by the document's category.
const CREW_CERT_CATS = new Set(['safety', 'medical', 'deck', 'engineering', 'interior', 'watersports', 'qualification', 'professional']);
function crewDocBucket(d) {
  const st = getDocStatus(d);
  if (d.historic || st.level === 'expired') return 'expired';
  const cat = getDocType(d.doc_type)?.category || d.category || 'other';
  if (cat === 'issued') return 'issued';                 // employer-issued: contracts, SEA, letters
  return CREW_CERT_CATS.has(cat) ? 'certificates' : 'documents'; // certs vs travel/identity
}

// One row per crew member (active or former) who holds at least one document,
// with the role / department / tenure / expiry rollup the crew list shows.
// Docs are fetched by owner, so a new joiner's existing certificates count.
async function crewMemberRows(tenantId) {
  const { data: members } = await supabase.from('tenant_members')
    .select('user_id, role, display_name, department_id, start_date, joined_at, active')
    .eq('tenant_id', tenantId);
  const memberRows = (members || []).filter((m) => m.user_id);
  const ids = [...new Set(memberRows.map((m) => m.user_id))];
  if (!ids.length) return [];
  const visible = (await fetchCrewDocsForUsers(ids))
    .filter((d) => d.file_url && d.category !== CREW_DOC_EXCLUDE);
  const today = new Date().toISOString().slice(0, 10);
  const agg = new Map();
  visible.forEach((d) => {
    if (!d.user_id) return;
    const a = agg.get(d.user_id) || { count: 0, expired: 0, soonest: null };
    a.count += 1;
    if (!d.historic && d.expiry_date && !isAdvisoryDocType(d.doc_type)) {
      if (d.expiry_date < today) a.expired += 1;
      if (!a.soonest || d.expiry_date < a.soonest) a.soonest = d.expiry_date;
    }
    agg.set(d.user_id, a);
  });
  const withDocs = ids.filter((uid) => agg.has(uid));
  if (!withDocs.length) return [];
  const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', withDocs);
  const names = {}; (profs || []).forEach((p) => { names[p.id] = p.full_name; });
  const mem = {};
  memberRows.forEach((m) => { const cur = mem[m.user_id]; if (!cur || (m.active && !cur.active)) mem[m.user_id] = m; });
  const deptIds = [...new Set(memberRows.map((m) => m.department_id).filter(Boolean))];
  const depts = {};
  if (deptIds.length) {
    const { data: d } = await supabase.from('departments').select('id, name').in('id', deptIds);
    (d || []).forEach((x) => { depts[x.id] = x.name; });
  }
  return withDocs.map((uid) => {
    const a = agg.get(uid); const m = mem[uid] || {};
    return {
      uid,
      active: m.active !== false,
      name: names[uid] || m.display_name || 'Crew member',
      role: m.role || null,
      dept: m.department_id ? (depts[m.department_id] || null) : null,
      since: m.start_date || m.joined_at || null,
      docCount: a.count,
      expiredCount: a.expired,
      soonestExpiry: a.soonest,
      meta: `${a.count} document${a.count !== 1 ? 's' : ''}`,
    };
  }).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
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

  // ── Crew Documents — a four-level virtual tree ───────────────────────────
  //   virt:crew                        → Active crew / Former crew
  //   virt:crew:<group>                → one folder per crew member
  //   virt:crew:<group>:<uid>          → Certificates / Documents / Expired
  //   virt:crew:<group>:<uid>:<bucket> → the files
  if (parentId === VIRT_CREW) {
    const rows = await crewMemberRows(tenantId);
    if (!rows.length) return [];
    const active = rows.filter((r) => r.active).length;
    const former = rows.filter((r) => !r.active).length;
    const out = [];
    if (active) out.push({ id: `${VIRT_CREW}:active`, kind: 'folder', system: true, name: 'Active crew', meta: `${active} crew member${active !== 1 ? 's' : ''}` });
    if (former) out.push({ id: `${VIRT_CREW}:former`, kind: 'folder', system: true, name: 'Former crew', meta: `${former} crew member${former !== 1 ? 's' : ''}` });
    return out;
  }

  // Group → one folder per crew member in that group, with the rollup metadata.
  if (parentId === `${VIRT_CREW}:active` || parentId === `${VIRT_CREW}:former`) {
    const group = parentId.endsWith(':former') ? 'former' : 'active';
    const rows = await crewMemberRows(tenantId);
    return rows
      .filter((r) => (group === 'active' ? r.active : !r.active))
      .map((r) => ({
        id: `${VIRT_CREW}:${group}:${r.uid}`,
        kind: 'folder', system: true, crew: true,
        active: r.active, name: r.name, role: r.role, dept: r.dept, since: r.since,
        docCount: r.docCount, expiredCount: r.expiredCount, soonestExpiry: r.soonestExpiry, meta: r.meta,
      }));
  }

  // Member → Certificates / Documents / Issued / Expired folders (non-empty),
  // each carrying an expiry rollup so live compliance shows on the folder.
  const crewMemberMatch = parentId.match(/^virt:crew:(active|former):([0-9a-fA-F-]{36})$/);
  if (crewMemberMatch) {
    const [, group, uid] = crewMemberMatch;
    const docs = (await fetchCrewDocsForUsers([uid]))
      .filter((d) => d.file_url && d.category !== CREW_DOC_EXCLUDE);
    const stats = {}; // bucket → { count, expiring, soonest }
    docs.forEach((d) => {
      const b = crewDocBucket(d);
      const s = stats[b] || { count: 0, expiring: 0, soonest: null };
      s.count += 1;
      const st = getDocStatus(d);
      if (!d.historic && d.expiry_date && !isAdvisoryDocType(d.doc_type)) {
        if (st.level === 'red' || st.level === 'amber') s.expiring += 1; // within 90 days
        if (!s.soonest || d.expiry_date < s.soonest) s.soonest = d.expiry_date;
      }
      stats[b] = s;
    });
    const defs = [
      { key: 'certificates', name: 'Certificates' },
      { key: 'documents', name: 'Documents' },
      { key: 'issued', name: 'Issued documents' },
      { key: 'expired', name: 'Expired & historic' },
    ];
    return defs.filter((def) => stats[def.key]?.count > 0).map((def) => {
      const s = stats[def.key];
      return {
        id: `${VIRT_CREW}:${group}:${uid}:${def.key}`,
        kind: 'folder', system: true,
        name: def.name,
        expiringCount: def.key === 'expired' ? 0 : s.expiring,
        soonestExpiry: def.key === 'expired' ? null : s.soonest,
        meta: `${s.count} document${s.count !== 1 ? 's' : ''}`,
      };
    });
  }

  // Bucket → the read-only files (opens via the stored signed URL).
  const crewBucketMatch = parentId.match(/^virt:crew:(active|former):([0-9a-fA-F-]{36}):(certificates|documents|issued|expired)$/);
  if (crewBucketMatch) {
    const [, , uid, bucket] = crewBucketMatch;
    const docs = (await fetchCrewDocsForUsers([uid]))
      .filter((d) => d.file_url && d.category !== CREW_DOC_EXCLUDE)
      .map((d) => ({ ...d, _st: getDocStatus(d) }))
      .filter((d) => crewDocBucket(d) === bucket);
    docs.sort((a, b) => {
      const rank = (d) => (d.historic ? 3 : d._st.level === 'advisory' ? 2 : 1);
      return (rank(a) - rank(b))
        || String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999'));
    });
    return docs.map((d) => {
      const label = getDocTypeLabel(d.doc_type) || d.doc_type || 'Document';
      const cat = getDocType(d.doc_type)?.category || d.category || 'other';
      return {
        id: `virt:crewfile:${d.id}`,
        kind: 'file',
        readOnly: true,
        url: d.file_url,
        name: d.title || label,
        expiry_date: d.expiry_date || null,
        historic: d.historic,
        statusLevel: d._st.level,
        statusLabel: d._st.label,
        cat,
        catLabel: CAT_LABEL[cat] || 'Other',
        mime_type: d.mime_type,
        size_bytes: d.size_bytes || null,
        meta: d.document_number ? `No. ${d.document_number}` : (d.issuing_authority || label),
      };
    });
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
    if (folderId === VIRT_CREW) return [{ id: VIRT_CREW, name: 'Crew Documents' }];
    if (folderId.startsWith(`${VIRT_CREW}:`)) {
      const [group, uid, bucket] = folderId.slice(`${VIRT_CREW}:`.length).split(':');
      const crumbs = [
        { id: VIRT_CREW, name: 'Crew Documents' },
        { id: `${VIRT_CREW}:${group}`, name: group === 'former' ? 'Former crew' : 'Active crew' },
      ];
      if (uid) {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
        crumbs.push({ id: `${VIRT_CREW}:${group}:${uid}`, name: data?.full_name || 'Crew member' });
        if (bucket) {
          const label = bucket === 'certificates' ? 'Certificates' : bucket === 'documents' ? 'Documents' : bucket === 'issued' ? 'Issued documents' : 'Expired & historic';
          crumbs.push({ id: folderId, name: label });
        }
      }
      return crumbs;
    }
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

// Lay down the default top-level folders for a vessel. Idempotent — only the
// names not already present at the root are inserted, so it never duplicates or
// disturbs folders a crew has already created.
export async function seedDefaultFolders({ tenantId, createdBy = null }) {
  if (!tenantId) return [];
  const { data: existing } = await supabase
    .from('vessel_documents')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('kind', 'folder')
    .is('parent_id', null);
  const have = new Set((existing || []).map((r) => String(r.name).toLowerCase()));
  const rows = DEFAULT_VAULT_FOLDERS
    .filter((name) => !have.has(name.toLowerCase()))
    .map((name) => ({ tenant_id: tenantId, parent_id: null, kind: 'folder', name, created_by: createdBy }));
  if (!rows.length) return [];
  const { data, error } = await supabase.from('vessel_documents').insert(rows).select();
  if (error) { console.error('[vault] seedDefaultFolders failed', error); throw error; }
  return data || [];
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

// The vault "Shelf" — the root landing. Returns the top-level folders (each with
// a recursive tally of the files beneath it: total + RAG counts + last-touched),
// any loose files sitting at the root, and the counts for the two linked stores.
// One read of the tenant's tree drives the whole grid.
export async function fetchShelf({ tenantId }) {
  const empty = { folders: [], rootFiles: [], linked: { hor: 0, templates: 0 } };
  if (!tenantId) return empty;
  const { data, error } = await supabase.from('vessel_documents').select('*').eq('tenant_id', tenantId);
  if (error) { console.error('[vault] fetchShelf failed', error); throw error; }
  const rows = data || [];

  const byParent = new Map();
  rows.forEach((r) => {
    const k = r.parent_id || '__root__';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(r);
  });
  const childrenOf = (id) => byParent.get(id) || [];

  // Recursively tally the files under a folder, bucketed by expiry RAG level.
  const tally = (folderId) => {
    const t = { total: 0, expired: 0, lapsing: 0, valid: 0, last: null };
    const walk = (id) => childrenOf(id).forEach((c) => {
      if (c.updated_at && (!t.last || c.updated_at > t.last)) t.last = c.updated_at;
      if (c.kind === 'file') {
        t.total += 1;
        const lvl = getExpiryStatus(c.expiry_date)?.level;
        if (lvl === 'expired') t.expired += 1;
        else if (lvl === 'red' || lvl === 'amber') t.lapsing += 1;
        else if (lvl === 'green') t.valid += 1;
      } else if (c.kind === 'folder') {
        walk(c.id);
      }
    });
    walk(folderId);
    return t;
  };

  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
  const folders = childrenOf('__root__').filter((r) => r.kind === 'folder').sort(byName).map((f) => {
    const t = tally(f.id);
    const last = f.updated_at && (!t.last || f.updated_at > t.last) ? f.updated_at : t.last;
    return { id: f.id, name: f.name, total: t.total, expired: t.expired, lapsing: t.lapsing, valid: t.valid, lastUpdated: last };
  });
  const rootFiles = childrenOf('__root__').filter((r) => r.kind === 'file').sort(byName);

  // Linked store counts (best-effort — never block the shelf).
  let hor = 0; let templates = 0; let crew = 0;
  try {
    const { data: h } = await supabase.from('hor_signed_documents')
      .select('period_year, period_month').eq('tenant_id', tenantId);
    hor = new Set((h || []).map((r) => `${r.period_year}-${r.period_month}`)).size;
  } catch { /* noop */ }
  try {
    const { count } = await supabase.from('contract_templates')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    templates = count || 0;
  } catch { /* noop */ }
  try {
    // Count crew (active + former) who hold at least one document — by owner,
    // matching the membership-based lens rather than the doc's tenant_id.
    const { data: mem } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId);
    const memIds = [...new Set((mem || []).map((r) => r.user_id).filter(Boolean))];
    if (memIds.length) {
      const { data: c } = await supabase.from('personal_documents')
        .select('user_id').in('user_id', memIds)
        .not('file_url', 'is', null).neq('category', CREW_DOC_EXCLUDE);
      crew = new Set((c || []).map((r) => r.user_id).filter(Boolean)).size;
    }
  } catch { /* noop */ }

  return { folders, rootFiles, linked: { hor, templates, crew } };
}

// Every vault file that carries an expiry (id, name, expiry_date), soonest first.
// Powers the dashboard "Document renewals" ledger — classify client-side.
export async function fetchVesselDocExpirySummary({ tenantId = null } = {}) {
  let q = supabase.from('vessel_documents')
    .select('id, name, expiry_date')
    .eq('kind', 'file')
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true });
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) { console.error('[vault] expiry summary failed', error); return []; }
  return data || [];
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
