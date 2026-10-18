import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Whether the active vessel can use Cargo, from its plan lifecycle:
//   • complimentary vessels (Horizon, internal/demo) — always full access;
//   • subscription ended (canceled / unpaid / incomplete_expired) — "ended":
//     the vessel is locked except Membership and crew's own pages, and its data
//     is deleted 90 days after `endedAt` (supabase vessel-lifecycle function).
// Anything else (trial, active, past due) is full access.

export const ENDED_STATUSES = ['canceled', 'unpaid', 'incomplete_expired'];
const DAY = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const cache = new Map(); // tenantId -> { at, value }

export function describeAccess(row) {
  if (!row) return { ended: false, complimentary: false };
  const complimentary = !!row.complimentary;
  const ended = !complimentary && ENDED_STATUSES.includes(row.subscription_status) && !!row.access_ended_at;
  const endedAt = row.access_ended_at ? new Date(row.access_ended_at) : null;
  return {
    complimentary,
    ended,
    endedAt,
    deleteOn: endedAt ? new Date(endedAt.getTime() + 90 * DAY) : null,
    deleted: !!row.data_deleted_at,
    vesselName: row.name || '',
  };
}

export async function fetchVesselAccess(tenantId, { fresh = false } = {}) {
  if (!tenantId) return describeAccess(null);
  const hit = cache.get(tenantId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await supabase
    .from('tenants')
    .select('name, subscription_status, complimentary, access_ended_at, data_deleted_at')
    .eq('id', tenantId)
    .maybeSingle();
  // On any error, never lock the vessel out.
  const value = error ? describeAccess(null) : describeAccess(data);
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

export function useVesselAccess(tenantId) {
  const [state, setState] = useState(() => {
    const hit = tenantId && cache.get(tenantId);
    return hit ? { loading: false, ...hit.value } : { loading: !!tenantId, ended: false, complimentary: false };
  });
  useEffect(() => {
    let live = true;
    if (!tenantId) { setState({ loading: false, ended: false, complimentary: false }); return undefined; }
    fetchVesselAccess(tenantId).then((v) => { if (live) setState({ loading: false, ...v }); });
    return () => { live = false; };
  }, [tenantId]);
  return state;
}

// Download everything the vessel holds as one JSON file (Command only).
export async function exportVesselData(tenantId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-vessel-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  if (!res.ok) {
    let msg = 'Export failed — please try again.';
    try { msg = (await res.json())?.error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'cargo-vessel-export.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
