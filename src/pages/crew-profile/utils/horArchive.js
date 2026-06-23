// horArchive — the signed Record of Hours of Rest vault.
//
// When a crew member's month becomes fully signed off (crew signature + master
// counter-signature → hor_month_status 'confirmed'), we render THAT seafarer's
// signed MLC record to PDF and file it in the private 'hor-documents' bucket
// under a per-month folder: {tenant}/{year}-{MM}/{subject}.pdf. The vault then
// accumulates one signed PDF per seafarer per month — the authoritative record
// to pull back at a PSC/flag inspection, independent of any emailed copy.
//
// The render reuses the exact rota-export pipeline (loadRotaHorExportData →
// buildSeafarerHorPDF), so a vaulted record is identical to the on-screen one.

import { supabase } from '../../../lib/supabaseClient';
import { loadRotaHorExportData } from '../../crew-rota/rotaHorExportData';
import { buildSeafarerHorPDF } from '../../crew-rota/rotaHorExport';

const BUCKET = 'hor-documents';
const SIGNED_URL_TTL = 3600; // 1 hour
const pad2 = (n) => String(n).padStart(2, '0');

// Build + file one seafarer's signed record for the given month. `jsMonth` is
// 0-based (JS Date convention). Returns the inserted index row, or null when
// there's nothing to archive (month not started / member not found).
export async function archiveSignedHorRecord({ tenantId, subjectUserId, year, jsMonth }) {
  if (!tenantId || !subjectUserId || year == null || jsMonth == null) return null;

  const payload = await loadRotaHorExportData({ tenantId, year, month: jsMonth + 1, withSignatures: true });
  if (payload.empty) return null;

  // Find the subject within the dept-grouped rows (tag with their department).
  let member = null;
  for (const grp of payload.rows || []) {
    const hit = (grp.members || []).find((m) => m.userId === subjectUserId);
    if (hit) { member = { dept: grp.dept, ...hit }; break; }
  }
  if (!member) return null;

  const signature = payload.signatures?.[subjectUserId] || null;
  const { blob, filename } = await buildSeafarerHorPDF({
    member,
    days: payload.days,
    meta: payload.meta,
    windowShifts: payload.windowShifts,
    breachReasons: payload.breachReasons,
    signature,
  });

  // Per-month folder; stable name so re-signing overwrites in place.
  const path = `${tenantId}/${year}-${pad2(jsMonth + 1)}/${subjectUserId}.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (up.error) throw up.error;

  const { data: auth } = await supabase.auth.getUser();
  const row = {
    tenant_id: tenantId,
    subject_user_id: subjectUserId,
    period_year: year,
    period_month: jsMonth + 1,
    storage_path: path,
    file_name: filename,
    crew_signed_name: signature?.seafarer?.name || null,
    master_signed_name: signature?.master?.name || null,
    byte_size: blob.size || null,
    archived_by: auth?.user?.id || null,
    archived_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('hor_signed_documents')
    .upsert(row, { onConflict: 'tenant_id,subject_user_id,period_year,period_month' });
  if (error) throw error;
  return row;
}

// Best-effort wrapper: never let a vault failure break the sign-off it follows.
export async function archiveSignedHorRecordSafe(args) {
  try {
    return await archiveSignedHorRecord(args);
  } catch (e) {
    console.warn('[HOR] vault archive failed (sign-off still saved):', e);
    return null;
  }
}

// A fresh signed URL to read an archived record back.
export async function getSignedHorRecordUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) {
    console.error('[HOR] getSignedHorRecordUrl failed for', path, error);
    return null;
  }
  return data?.signedUrl || null;
}

// All vaulted records for a vessel-month, keyed by subject_user_id.
export async function fetchSignedHorRecordsForMonth({ tenantId, year, jsMonth }) {
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from('hor_signed_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('period_year', year)
    .eq('period_month', jsMonth + 1);
  if (error) { console.warn('[HOR] fetchSignedHorRecordsForMonth failed', error); return {}; }
  const byUser = {};
  (data || []).forEach((r) => { byUser[r.subject_user_id] = r; });
  return byUser;
}
