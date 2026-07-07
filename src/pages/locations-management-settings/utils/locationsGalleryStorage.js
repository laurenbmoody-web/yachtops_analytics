// Location Management — gallery read layer.
// One trip: the whole vessel_locations tree (decks → zones → spaces) plus the
// scans bound to spaces, stitched into a shape the gallery renders directly.
// Every space carries its scan (thumb + status) or null — the "not scanned yet"
// state the gallery surfaces. Mutations still go through locationsHierarchyStorage.
import { supabase } from '../../../lib/supabaseClient';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data?.[0]?.tenant_id;
  } catch {
    return null;
  }
};

// Batch-sign thumbnail paths (1h). Returns { path -> signedUrl }.
export const signThumbs = async (paths) => {
  const clean = [...new Set(paths.filter(Boolean))];
  if (clean.length === 0) return {};
  const { data, error } = await supabase
    .storage.from('vessel-scans')
    .createSignedUrls(clean, 3600);
  if (error) {
    console.error('[loc-gallery] thumb sign error:', error);
    return {};
  }
  const map = {};
  (data || []).forEach((d) => { if (d?.signedUrl && !d.error) map[d.path] = d.signedUrl; });
  return map;
};

// Full gallery: decks[] → zones[] → spaces[], each space annotated with its
// scan, plus vessel-wide coverage. Archived nodes are excluded.
export const getVesselGallery = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return { decks: [], coverage: { scanned: 0, total: 0 }, tenantId: null };

  const [{ data: locs, error: locErr }, { data: scans, error: scanErr }] = await Promise.all([
    supabase.from('vessel_locations')
      .select('id, level, parent_id, name, sort_order, is_archived')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase.from('vessel_scans')
      .select('id, name, space_id, status, thumb_path')
      .eq('tenant_id', tenantId)
      .not('space_id', 'is', null),
  ]);
  if (locErr) { console.error('[loc-gallery] locations error:', locErr); return { decks: [], coverage: { scanned: 0, total: 0 }, tenantId }; }
  if (scanErr) console.error('[loc-gallery] scans error:', scanErr);

  const scanBySpace = {};
  (scans || []).forEach((s) => {
    // one primary scan per space; prefer a 'ready' one if several slipped in
    const cur = scanBySpace[s.space_id];
    if (!cur || (cur.status !== 'ready' && s.status === 'ready')) scanBySpace[s.space_id] = s;
  });

  const byLevel = (lvl) => (locs || []).filter((l) => l.level === lvl);
  const childrenOf = (lvl, parentId) => byLevel(lvl).filter((l) => l.parent_id === parentId);

  let scanned = 0;
  let total = 0;
  const thumbPaths = [];

  const decks = byLevel('deck').map((deck) => {
    const zones = childrenOf('zone', deck.id).map((zone) => {
      const spaces = childrenOf('space', zone.id).map((space) => {
        const scan = scanBySpace[space.id] || null;
        total += 1;
        if (scan?.status === 'ready') scanned += 1;
        if (scan?.thumb_path) thumbPaths.push(scan.thumb_path);
        return {
          id: space.id,
          name: space.name,
          scan: scan ? { id: scan.id, status: scan.status, thumbPath: scan.thumb_path } : null,
        };
      });
      return { id: zone.id, name: zone.name, spaces, spaceCount: spaces.length };
    });
    const spaceCount = zones.reduce((n, z) => n + z.spaceCount, 0);
    return { id: deck.id, name: deck.name, zones, zoneCount: zones.length, spaceCount };
  });

  const thumbs = await signThumbs(thumbPaths);
  decks.forEach((d) => d.zones.forEach((z) => z.spaces.forEach((s) => {
    if (s.scan?.thumbPath) s.scan.thumbUrl = thumbs[s.scan.thumbPath] || null;
  })));

  return { decks, coverage: { scanned, total }, tenantId };
};
