// Vessel Map — 3D Gaussian-splat scans of the vessel's spaces, rendered
// in-browser with @sparkjsdev/spark + plain three.js (no R3F). Crew-side
// only. Every active tenant member can view; hotspot placement is
// COMMAND/CHIEF (mirrored by RLS on scan_hotspots).
//
// Data flow: vessel_scans rows for the tenant → signed URL (1h) for the
// selected scan's private storage object → SplatViewer loads whatever
// format the row declares (ply/spz/… — never assumes SPZ). scan_hotspots
// render as layer-coloured pins; the layer chip row filters them.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Header from '../../components/navigation/Header';
import SplatViewer from './components/SplatViewer';
import ToolRail from './components/ToolRail';
import Inspector from './components/Inspector';
import InteriorView from './components/InteriorView';
import OrientPanel from './components/OrientPanel';
import PinPayload from './components/PinPayload';
import PinLocation from './components/PinLocation';
import useCanvasShortcuts from '../../hooks/useCanvasShortcuts';
import { LAYERS, layerColor, layerLabel } from './layers';
import { refreshScanThumb } from './utils/scanThumb';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';

const SIGNED_URL_TTL = 60 * 60; // 1 hour — splat downloads are big but not that big

// The dark stage the splat glows against — a deep neutral in the navy family
// (between --d-navy-deep and --d-navy). Single source of truth: fed to the
// WebGL clear colour and to CSS as --vm-stage.
const VM_STAGE = '#22253F';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const fmtMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

// Matches the CSS breakpoint where the workspace layout (rail, floating
// chrome) replaces the mobile variant.
const useIsDesktop = () => {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e) => setDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
};

export default function VesselMapPage() {
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();
  const userTier = (tenantRole || '').toUpperCase();
  const canPlaceHotspots = userTier === 'COMMAND' || userTier === 'CHIEF';

  const [scans, setScans] = useState([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [selectedScanId, setSelectedScanId] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [signError, setSignError] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [creatorNames, setCreatorNames] = useState({}); // user_id → full_name for pin creators
  const [activeLayers, setActiveLayers] = useState(() => new Set(LAYERS.map((l) => l.key)));
  const [viewer, setViewer] = useState({ status: 'idle' });
  const [selectedHotspot, setSelectedHotspot] = useState(null);
  const [mobileTab, setMobileTab] = useState('details'); // the floating card's rooms
  const [immersive, setImmersive] = useState(false); // stage fills the viewport
  // Canvas mode — the rail's single active tool. 'pin' is the old
  // placementMode; the mobile variant's Add-hotspot button drives the same
  // state.
  const [mode, setMode] = useState('navigate');
  const [pendingPosition, setPendingPosition] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [hovered, setHovered] = useState(null); // { label, x, y } — pin hover tag
  const [adjusting, setAdjusting] = useState(null); // pin being repositioned
  const [adjustError, setAdjustError] = useState(null);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [orientDraft, setOrientDraft] = useState(null); // {x,y,z} radians while orienting
  const [orientError, setOrientError] = useState(null);
  const [orientSaving, setOrientSaving] = useState(false);
  const viewerApiRef = useRef(null); // SplatViewer API — poster capture on orient save
  // ?pin= deep link (from inventory's "On the vessel map"), consumed once.
  const pendingPinRef = useRef(new URLSearchParams(window.location.search).get('pin'));
  const isDesktop = useIsDesktop();
  const placementMode = mode === 'pin';

  const [spaceLinks, setSpaceLinks] = useState([]); // doorway links [{id,a,b,aPos,bPos}]
  const [spaceNames, setSpaceNames] = useState({}); // space_id → room name (for doors to un-scanned rooms)
  const [placingDoor, setPlacingDoor] = useState(null); // {linkId, end, name} being anchored in 3D
  const [measure, setMeasure] = useState(null); // { meters, points } | null — Measure tool readout
  const [justCreatedId, setJustCreatedId] = useState(null); // a freshly-dropped pin — autofocus its name, discard if unnamed
  const [containerStack, setContainerStack] = useState([]); // opened containers, deepest last ([] = the 3-D scan)

  const selectedScan = useMemo(
    () => scans.find((s) => s.id === selectedScanId) || null,
    [scans, selectedScanId]
  );

  // Doorways from the current room: every link this room is an end of. Each
  // carries the neighbour's name, whether it's walkable (has a scan yet), and
  // the doorway's placed position. Un-scanned neighbours still show — you can
  // place the door now; it opens once that room is scanned.
  const roomDoorways = useMemo(() => {
    const sid = selectedScan?.space_id;
    if (!sid || spaceLinks.length === 0) return [];
    const scanBySpace = {};
    scans.forEach((s) => { if (s.space_id && !scanBySpace[s.space_id]) scanBySpace[s.space_id] = s; });
    const seen = new Set();
    const out = [];
    spaceLinks.forEach((l) => {
      const end = l.a === sid ? 'a' : l.b === sid ? 'b' : null;
      if (!end) return;
      const other = end === 'a' ? l.b : l.a;
      if (seen.has(other)) return;
      const targetScan = scanBySpace[other] || null;
      if (targetScan && targetScan.id === selectedScan.id) return; // link to self
      seen.add(other);
      out.push({
        linkId: l.id,
        end,
        name: targetScan?.name || spaceNames[other] || 'Room',
        targetScanId: targetScan?.id || null,
        walkable: !!targetScan,
        pos: end === 'a' ? l.aPos : l.bPos,
      });
    });
    return out;
  }, [selectedScan?.space_id, selectedScan?.id, spaceLinks, scans, spaceNames]);

  // Placed doorways become 3D pins in the scene (flagged isDoor so they ride
  // the hotspot sprite path). Walkable = teal + navigates; not-yet = muted. The
  // door being repositioned is hidden — the pending pin stands in for it.
  const doorPins = useMemo(
    () => roomDoorways
      .filter((d) => d.pos && placingDoor?.linkId !== d.linkId)
      .map((d) => ({ id: `door-${d.linkId}`, isDoor: true, targetScanId: d.targetScanId, walkable: d.walkable, label: d.name, position: d.pos, color: d.walkable ? '#0E7C86' : '#6B7280', layer: 'doorway' })),
    [roomDoorways, placingDoor]
  );

  // Backfill a poster for scans that never got one: the first time a scan
  // finishes loading on the map without a thumbnail, capture a frame and save
  // it (new uploads already capture one during "stand it upright"). Runs once
  // per scan per session, never while orienting.
  const posterDoneRef = useRef(new Set());
  useEffect(() => {
    if (viewer.status !== 'ready' || orientDraft !== null) return undefined;
    if (!selectedScan || !activeTenantId || selectedScan.thumb_path) return undefined;
    if (posterDoneRef.current.has(selectedScan.id)) return undefined;
    posterDoneRef.current.add(selectedScan.id);
    const scan = selectedScan;
    const t = setTimeout(async () => {
      try {
        const blob = await viewerApiRef.current?.captureFrame?.();
        if (!blob) return;
        const newThumbPath = await refreshScanThumb({ scan, tenantId: activeTenantId, blob });
        if (newThumbPath) setScans((prev) => prev.map((s) => (s.id === scan.id ? { ...s, thumb_path: newThumbPath } : s)));
      } catch (err) {
        console.error('[vessel-map] auto poster capture failed:', err);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [viewer.status, orientDraft, selectedScan?.id, selectedScan?.thumb_path, activeTenantId]);

  // ── Scans for the tenant ────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    (async () => {
      setScansLoading(true);
      const { data, error } = await supabase
        .from('vessel_scans')
        .select('*')
        .eq('tenant_id', activeTenantId)
        .eq('status', 'ready') // in-flight/abandoned uploads live on the manage surface
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('[vessel-map] scans fetch error:', error);
        setScans([]);
      } else {
        setScans(data || []);
        // Deep links from the manage library: /vessel/map?scan={id} opens
        // that room directly; otherwise keep/derive the default selection.
        const wanted = new URLSearchParams(window.location.search).get('scan');
        setSelectedScanId((prev) => {
          if (wanted && data?.some((s) => s.id === wanted)) return wanted;
          return prev && data?.some((s) => s.id === prev) ? prev : data?.[0]?.id || null;
        });
      }
      setScansLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId]);

  // ── Doorway links between rooms (for walkthrough navigation) ─────────────
  const loadLinks = useCallback(async () => {
    if (!activeTenantId) return;
    const { data, error } = await supabase
      .from('vessel_space_links')
      .select('id, a_space_id, b_space_id, a_pos, b_pos')
      .eq('tenant_id', activeTenantId);
    if (error) { console.error('[vessel-map] links fetch error:', error); setSpaceLinks([]); return; }
    setSpaceLinks((data || []).map((r) => ({ id: r.id, a: r.a_space_id, b: r.b_space_id, aPos: r.a_pos, bPos: r.b_pos })));
  }, [activeTenantId]);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Room names for every space — so a doorway to a not-yet-scanned room still
  // shows the room's name (there's no scan to borrow it from).
  useEffect(() => {
    if (!activeTenantId) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('vessel_locations')
        .select('id, name')
        .eq('tenant_id', activeTenantId)
        .eq('level', 'space');
      if (cancelled) return;
      if (error) { console.error('[vessel-map] space names fetch error:', error); setSpaceNames({}); return; }
      const m = {};
      (data || []).forEach((r) => { m[r.id] = r.name; });
      setSpaceNames(m);
    })();
    return () => { cancelled = true; };
  }, [activeTenantId]);

  // ── Signed URL for the selected scan's file ─────────────────────────────
  useEffect(() => {
    if (!selectedScan) { setSignedUrl(null); return; }
    let cancelled = false;
    setSignedUrl(null);
    setSignError(null);
    setViewer({ status: 'idle' });
    (async () => {
      const { data, error } = await supabase.storage
        .from('vessel-scans')
        .createSignedUrl(selectedScan.storage_path, SIGNED_URL_TTL);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        console.error('[vessel-map] sign url failed for', selectedScan.storage_path, error);
        setSignError(error?.message || 'Could not sign the scan file URL.');
        return;
      }
      setSignedUrl(data.signedUrl);
    })();
    return () => { cancelled = true; };
  }, [selectedScan?.id, selectedScan?.storage_path]);

  // ── Hotspots for the selected scan ──────────────────────────────────────
  const loadHotspots = useCallback(async () => {
    if (!selectedScan || !activeTenantId) { setHotspots([]); return; }
    const { data, error } = await supabase
      .from('scan_hotspots')
      .select('*')
      .eq('scan_id', selectedScan.id)
      .eq('tenant_id', activeTenantId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[vessel-map] hotspots fetch error:', error);
      return;
    }
    setHotspots(data || []);

    // Deep links from inventory: /vessel/map?scan={id}&pin={id} opens the
    // room with that pin's inspector already up. Consumed once.
    if (pendingPinRef.current) {
      const wanted = (data || []).find((h) => h.id === pendingPinRef.current);
      if (wanted) {
        pendingPinRef.current = null;
        setSelectedHotspot(wanted);
      }
    }

    // Creator names for the inspector's Details tab — one lookup for all
    // pins; nulls (pre-tracking pins) simply don't render an "Added by" row.
    // Names for pin creators AND payload authors (notes / ticks / photos).
    const uids = [...new Set((data || []).flatMap((h) => [
      h.created_by,
      ...((h.detail?.notes || []).map((n) => n.created_by)),
      ...((h.detail?.checklist || []).map((c) => c.done_by)),
      ...((h.detail?.photos || []).map((p) => p.created_by)),
    ]).filter(Boolean))];
    if (uids.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', uids);
      if (pErr) {
        console.error('[vessel-map] creator names fetch error:', pErr);
      } else {
        setCreatorNames(Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name])));
      }
    }
  }, [selectedScan?.id, activeTenantId]);

  useEffect(() => {
    setSelectedHotspot(null);
    setMode('navigate');
    setPendingPosition(null);
    setContainerStack([]);
    loadHotspots();
  }, [loadHotspots]);

  // Only top-level pins live on the 3-D scan; nested pins sit on a container's
  // interior photo (parent_id set) and are handled by the interior view.
  const topHotspots = useMemo(() => hotspots.filter((h) => !h.parent_id), [hotspots]);

  const layerCounts = useMemo(() => {
    const counts = {};
    for (const h of topHotspots) counts[h.layer] = (counts[h.layer] || 0) + 1;
    return counts;
  }, [topHotspots]);

  // All top-level pins go to the viewer; layer visibility is a fade, not a
  // filter (chips toggle their pins with a 150ms fade, not a pop).
  const allHotspots = useMemo(
    () => topHotspots.map((h) => ({ ...h, color: h.color || layerColor(h.layer), isContainer: !!h.is_container })),
    [topHotspots]
  );

  // The opened-container path, resolved live from hotspots (so labels/photo
  // track edits), and the child pins sitting on the deepest one's photo.
  const containerTrail = useMemo(
    () => containerStack.map((c) => hotspots.find((h) => h.id === c.id) || c),
    [containerStack, hotspots]
  );
  const openContainer = containerTrail[containerTrail.length - 1] || null;
  const childPins = useMemo(
    () => (openContainer ? hotspots.filter((h) => h.parent_id === openContainer.id) : []),
    [openContainer, hotspots]
  );
  // Hotspots + placed doorway pins — one stable array for the viewer.
  const viewerHotspots = useMemo(() => [...allHotspots, ...doorPins], [allHotspots, doorPins]);
  const visibleLayerList = useMemo(() => [...activeLayers], [activeLayers]);

  const toggleLayer = (key) => setActiveLayers((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Fresh pin, fresh rooms — the floating card resets to Details.
  useEffect(() => { setMobileTab('details'); }, [selectedHotspot?.id]);

  // Hiding a layer deselects its pin — a ring around an invisible pin reads
  // as a ghost.
  useEffect(() => {
    if (selectedHotspot && !activeLayers.has(selectedHotspot.layer || 'general')) {
      setSelectedHotspot(null);
    }
  }, [activeLayers, selectedHotspot]);

  // ── Hotspot placement ───────────────────────────────────────────────────
  const startPlacement = () => {
    setSelectedHotspot(null);
    setPendingPosition(null);
    setAdjusting(null);
    setAdjustError(null);
    setMode('pin');
  };
  const cancelPlacement = () => {
    setMode('navigate');
    setPendingPosition(null);
    setModalOpen(false);
    setAdjusting(null);
    setAdjustError(null);
  };

  // Dropping a pin creates it straight away and opens the inspector as its
  // editor — name, category and every tab in one place, no create-then-reopen.
  // Desktop drops on click; mobile drops a pending pin to nudge, then commits.
  const placePending = (pos) => {
    setPendingPosition(pos);
    if (isDesktop && pos && !adjusting) createDraftPin(pos);
  };

  // Create a blank pin at pos and open it. Name is filled in the inspector;
  // an unnamed pin is discarded when the inspector closes (see closeInspector).
  const createDraftPin = async (pos) => {
    if (!pos || !selectedScan) return;
    const layer = 'general';
    const { data, error } = await supabase
      .from('scan_hotspots')
      .insert({
        scan_id: selectedScan.id,
        tenant_id: activeTenantId,
        label: '',
        layer,
        color: layerColor(layer),
        position: pos,
        detail: {},
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    cancelPlacement();
    if (error) { console.error('[vessel-map] draft pin error:', error); return; }
    setHotspots((prev) => [...prev, data]);
    setActiveLayers((prev) => new Set(prev).add(layer));
    if (data.created_by && !creatorNames[data.created_by]) {
      const name = user?.user_metadata?.full_name || user?.email;
      if (name) setCreatorNames((prev) => ({ ...prev, [data.created_by]: name }));
    }
    setSelectedHotspot(data);
    setJustCreatedId(data.id);
  };

  // ── Container interiors ─────────────────────────────────────────────────
  // Open a container's inside (its photo + child pins). Nested containers push
  // another level; the breadcrumb walks back out. Editing chrome is reset so
  // the interior opens clean.
  const openInterior = (container) => {
    if (!container) return;
    setContainerStack((s) => [...s, { id: container.id, label: container.label }]);
    setSelectedHotspot(null);
    setJustCreatedId(null);
    setMode('navigate');
    setAdjusting(null);
    setPlacingDoor(null);
    setMeasure(null);
  };
  // Breadcrumb navigation: -1 = back out to the 3-D scan; i = up to that level.
  const crumbTo = (index) => {
    setSelectedHotspot(null);
    setJustCreatedId(null);
    setMode('navigate');
    setContainerStack((s) => (index < 0 ? [] : s.slice(0, index + 1)));
  };
  // Drop a child pin on the open container's photo at a 2-D {x,y} (0..1), then
  // open its inspector — same create-and-edit flow as a 3-D pin.
  const createChildPin = async (pos) => {
    const parent = containerTrail[containerTrail.length - 1];
    if (!parent || !selectedScan) return;
    const layer = 'general';
    const { data, error } = await supabase
      .from('scan_hotspots')
      .insert({
        scan_id: selectedScan.id,
        tenant_id: activeTenantId,
        parent_id: parent.id,
        label: '',
        layer,
        color: layerColor(layer),
        position: pos,
        detail: {},
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (error) { console.error('[vessel-map] child pin error:', error); return; }
    setHotspots((prev) => [...prev, data]);
    setActiveLayers((prev) => new Set(prev).add(layer));
    if (data.created_by && !creatorNames[data.created_by]) {
      const name = user?.user_metadata?.full_name || user?.email;
      if (name) setCreatorNames((prev) => ({ ...prev, [data.created_by]: name }));
    }
    setSelectedHotspot(data);
    setJustCreatedId(data.id);
  };

  const renameHotspot = (id, label) => {
    setHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, label } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === id ? { ...prev, label } : prev));
    supabase.from('scan_hotspots').update({ label }).eq('id', id)
      .then(({ error }) => { if (error) console.error('[vessel-map] rename error:', error); });
  };

  const setContainer = (id, on) => {
    setHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, is_container: on } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === id ? { ...prev, is_container: on } : prev));
    supabase.from('scan_hotspots').update({ is_container: on }).eq('id', id)
      .then(({ error }) => { if (error) console.error('[vessel-map] container toggle error:', error); });
  };

  const setInteriorPhoto = (id, path) => {
    setHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, interior_photo_path: path } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === id ? { ...prev, interior_photo_path: path } : prev));
    supabase.from('scan_hotspots').update({ interior_photo_path: path }).eq('id', id)
      .then(({ error }) => { if (error) console.error('[vessel-map] interior photo save error:', error); });
  };

  const relayerHotspot = (id, layer) => {
    const color = layerColor(layer);
    setHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, layer, color } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === id ? { ...prev, layer, color } : prev));
    setActiveLayers((prev) => new Set(prev).add(layer));
    supabase.from('scan_hotspots').update({ layer, color }).eq('id', id)
      .then(({ error }) => { if (error) console.error('[vessel-map] relayer error:', error); });
  };

  // Closing the inspector discards a pin that was never named — so a stray
  // drop doesn't leave a blank pin behind.
  const closeInspector = () => {
    const h = selectedHotspot;
    setSelectedHotspot(null);
    setJustCreatedId(null);
    if (h && !(h.label && h.label.trim())) {
      setHotspots((prev) => prev.filter((x) => x.id !== h.id));
      supabase.from('scan_hotspots').delete().eq('id', h.id)
        .then(({ error }) => { if (error) console.error('[vessel-map] discard draft error:', error); });
    }
  };

  // ── Doorway pin placement ───────────────────────────────────────────────
  // Same discipline as hotspots: click drops a pending pin, drag to nudge it
  // exactly onto the door, then confirm. (A doorway is an opening, so the first
  // click often lands on the fallback plane — the nudge is what puts it on the
  // door and keeps it there as you orbit.)
  // The rail's single active tool. Doorways is its own edit mode: the door
  // controls live here, not in an always-on bar.
  const selectMode = (m) => {
    setPlacingDoor(null);
    setPendingPosition(null);
    if (m !== 'measure') setMeasure(null);
    if (m === 'pin') { setMode('pin'); setSelectedHotspot(null); setAdjusting(null); setAdjustError(null); return; }
    if (m === 'doorways') { setMode('doorways'); setSelectedHotspot(null); setAdjusting(null); setModalOpen(false); return; }
    if (m === 'measure') { setMode('measure'); setSelectedHotspot(null); setAdjusting(null); setModalOpen(false); return; }
    cancelPlacement(); // navigate
  };

  const startPlaceDoor = (d) => {
    setSelectedHotspot(null);
    setPendingPosition(null);
    setAdjusting(null);
    setPlacingDoor({ linkId: d.linkId, end: d.end, name: d.name });
  };
  const saveDoorPosition = async (linkId, end, pos) => {
    const col = end === 'a' ? 'a_pos' : 'b_pos';
    const { error } = await supabase.from('vessel_space_links').update({ [col]: pos }).eq('id', linkId);
    if (error) { console.error('[vessel-map] door position save error:', error); return; }
    await loadLinks();
  };
  const confirmDoorPlacement = async () => {
    if (!placingDoor || !pendingPosition) return;
    const { linkId, end } = placingDoor;
    setPlacingDoor(null);
    setPendingPosition(null);
    await saveDoorPosition(linkId, end, pendingPosition);
  };
  const cancelDoorPlacement = () => { setPlacingDoor(null); setPendingPosition(null); };
  // The viewer's place callback: a door drop/drag sets the pending pin (confirm
  // to save); otherwise it's the hotspot flow.
  const handleViewerPlace = (pos) => {
    if (placingDoor) { setPendingPosition(pos); return; }
    placePending(pos);
  };
  // Click a pin. Doorway pins: in Doorways mode a click starts repositioning
  // that door; otherwise a walkable door walks you through. Everything else
  // selects the hotspot.
  const handleSelectHotspot = (h) => {
    if (h?.isDoor) {
      if (mode === 'doorways') {
        const d = roomDoorways.find((rd) => `door-${rd.linkId}` === h.id);
        if (d) startPlaceDoor(d);
      } else if (h.targetScanId) {
        setSelectedScanId(h.targetScanId);
      }
      return;
    }
    setSelectedHotspot(h);
  };


  // ── Adjust position (COMMAND/CHIEF, from the inspector) ─────────────────
  const startAdjust = (h) => {
    setSelectedHotspot(null);
    setAdjusting(h);
    setAdjustError(null);
    setPendingPosition(h.position);
    setMode('pin');
  };
  const cancelAdjust = () => {
    const original = adjusting;
    cancelPlacement();
    if (original) setSelectedHotspot(original); // back where the flow began
  };
  const saveAdjust = async () => {
    if (!adjusting || !pendingPosition || adjustSaving) return;
    setAdjustSaving(true);
    setAdjustError(null);
    const { error } = await supabase
      .from('scan_hotspots')
      .update({ position: pendingPosition })
      .in('id', [adjusting.id]);
    setAdjustSaving(false);
    if (error) {
      console.error('[vessel-map] position update error:', error);
      setAdjustError(error.message || 'Could not move the pin.');
      return;
    }
    const moved = { ...adjusting, position: pendingPosition };
    setHotspots((prev) => prev.map((h) => (h.id === moved.id ? moved : h)));
    cancelPlacement();
    setSelectedHotspot(moved);
  };

  // Keyboard vocabulary (desktop only): V navigate, P pin, Escape unwinds —
  // modal first, then adjust, then selection, then back to Navigate.
  useCanvasShortcuts({
    v: () => selectMode('navigate'),
    p: () => {
      if (canPlaceHotspots && viewer.status === 'ready') selectMode('pin');
    },
    d: () => {
      if (canPlaceHotspots && viewer.status === 'ready') selectMode('doorways');
    },
    m: () => {
      if (viewer.status === 'ready') selectMode('measure');
    },
    f: () => setImmersive((v) => !v),
    escape: () => {
      if (placingDoor) cancelDoorPlacement();
      else if (adjusting) cancelAdjust();
      else if (selectedHotspot) closeInspector();
      else if (mode === 'pin' || mode === 'doorways' || mode === 'measure') selectMode('navigate');
      else if (containerStack.length) crumbTo(containerStack.length - 2);
      else if (immersive) setImmersive(false);
    },
  }, { enabled: isDesktop });

  // Immersive stage: the page behind must not scroll.
  useEffect(() => {
    if (!immersive) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [immersive]);

  // ── Orient scan (COMMAND/CHIEF): rotate-90° per axis, live re-frame, save.
  // Tuning orientation by SQL stops today. Controls live in OrientPanel
  // (shared with the manage surface's post-upload step).
  const baseRotation = selectedScan?.splat_rotation || { x: 0, y: 0, z: 0 };
  const liveRotation = orientDraft ?? baseRotation;
  const saveOrientation = async () => {
    if (!orientDraft || orientSaving) return;
    setOrientSaving(true);
    setOrientError(null);
    // Capture the approved frame first — any orient save refreshes the
    // poster so manage-list thumbnails never drift from the canonical view.
    let thumbBlob = null;
    try {
      thumbBlob = await viewerApiRef.current?.captureFrame?.();
    } catch (err) {
      console.error('[vessel-map] thumb capture error:', err);
    }
    const { error } = await supabase
      .from('vessel_scans')
      .update({ splat_rotation: orientDraft })
      .in('id', [selectedScan.id]);
    setOrientSaving(false);
    if (error) {
      console.error('[vessel-map] orientation save error:', error);
      setOrientError(error.message || 'Could not save the orientation.');
      return;
    }
    const newThumbPath = thumbBlob
      ? await refreshScanThumb({ scan: selectedScan, tenantId: activeTenantId, blob: thumbBlob })
      : null;
    setScans((prev) => prev.map((s) => (s.id === selectedScan.id
      ? { ...s, splat_rotation: orientDraft, ...(newThumbPath ? { thumb_path: newThumbPath } : {}) }
      : s)));
    setOrientDraft(null);
  };
  const cancelOrientation = () => {
    setOrientDraft(null);
    setOrientError(null);
  };

  // Returns an error message on failure (inspector shows it), null on success.
  const deleteHotspot = async (id) => {
    const { error } = await supabase.from('scan_hotspots').delete().eq('id', id);
    if (error) {
      console.error('[vessel-map] hotspot delete error:', error);
      return error.message || 'Could not remove the pin.';
    }
    setHotspots((prev) => prev.filter((h) => h.id !== id));
    setSelectedHotspot(null);
    return null;
  };

  // ── Render ──────────────────────────────────────────────────────────────
  // Payload writes report fresh detail back — hotspots and the open
  // selection both track it.
  const onDetailSaved = useCallback((hotspotId, detail) => {
    setHotspots((prev) => prev.map((h) => (h.id === hotspotId ? { ...h, detail } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === hotspotId ? { ...prev, detail } : prev));
    // A note/tick/photo just authored by this user should name them at once.
    if (user?.id && !creatorNames[user.id]) {
      const name = user?.user_metadata?.full_name || user?.email;
      if (name) setCreatorNames((prev) => ({ ...prev, [user.id]: name }));
    }
  }, [user, creatorNames]);

  const onLocationChanged = useCallback((hotspotId, locationId) => {
    setHotspots((prev) => prev.map((h) => (h.id === hotspotId ? { ...h, storage_location_id: locationId } : h)));
    setSelectedHotspot((prev) => (prev && prev.id === hotspotId ? { ...prev, storage_location_id: locationId } : prev));
  }, []);

  const showViewer = signedUrl && !signError;
  const loadPct = viewer.status === 'loading' ? viewer.progress : null;

  // One chip row, two treatments: '' (light, in the cream toolbar — the
  // mobile variant) and 'vm-chip-dark' (floating on the dark stage, ≥1024px).
  const layerChips = (variant) => LAYERS.map((l) => {
    const on = activeLayers.has(l.key);
    return (
      <button
        key={l.key}
        className={`vm-chip ${variant}${on ? ' vm-chip-on' : ''}`}
        onClick={() => toggleLayer(l.key)}
        title={`${on ? 'Hide' : 'Show'} ${l.label} pins`}
      >
        <span className="vm-pill-dot" style={{ background: l.color, opacity: on ? 1 : 0.35 }} />
        {l.label}
        {layerCounts[l.key] ? <span className="vm-chip-count">{layerCounts[l.key]}</span> : null}
      </button>
    );
  });

  return (
    <>
      <Header />
      <div className="editorial-page pv-dashboard vm-page" style={{ '--vm-stage': VM_STAGE }}>
        <div className="vm-shell">

          <div className="vm-headblock">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Vessel Map</span>
              <span className="bar" />
              <span className="muted">3D scans</span>
              {!scansLoading && scans.length > 0 && (
                <>
                  <span className="bar" />
                  <span className="muted">{scans.length} space{scans.length === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting">
              THE VESSEL<span className="period">,</span> <em>in the round</em><span className="period">.</span>
            </h1>
          </div>

          {scansLoading && (
            <div className="vm-panel vm-panel-quiet">Loading scans…</div>
          )}

          {!scansLoading && scans.length === 0 && (
            <div className="vm-panel vm-empty">
              <p className="vm-empty-title">No scans yet</p>
              <p className="vm-empty-body">
                When a space aboard is captured as a 3D scan it will appear here,
                ready to walk through and pin.
              </p>
            </div>
          )}

          {!scansLoading && scans.length > 0 && (
            <>
              {scans.length > 1 && (
                <div className="vm-scan-row">
                  {scans.map((s) => (
                    <button
                      key={s.id}
                      className={`vm-pill${s.id === selectedScanId ? ' vm-pill-selected' : ''}`}
                      onClick={() => setSelectedScanId(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="vm-toolbar">
                <div className="vm-layer-chips">{layerChips('')}</div>

                {canPlaceHotspots && (
                  <button className="vm-btn-ghost vm-toolbar-manage" onClick={() => navigate('/settings/vessel?section=location-management')}>
                    Manage scans
                  </button>
                )}

                {canPlaceHotspots && (
                  placementMode ? (
                    <div className="vm-place-controls">
                      <span className="vm-place-hint">
                        {pendingPosition
                          ? 'Drag the pin to fine-tune, then save'
                          : 'Click in the room to drop a pin'}
                      </span>
                      {pendingPosition && (
                        <button className="vm-btn-primary" onClick={() => createDraftPin(pendingPosition)}>
                          Place pin
                        </button>
                      )}
                      <button className="vm-btn-ghost" onClick={cancelPlacement}>Cancel</button>
                    </div>
                  ) : (
                    <button className="vm-btn-primary" onClick={startPlacement} disabled={viewer.status !== 'ready'}>
                      Add hotspot
                    </button>
                  )
                )}
              </div>

              <div className={`vm-stage${immersive ? ' vm-stage-full' : ''}`}>
                {showViewer && (
                  <SplatViewer
                    signedUrl={signedUrl}
                    fileName={selectedScan.storage_path.split('/').pop()}
                    cameraPosition={selectedScan.camera_position}
                    cameraTarget={selectedScan.camera_target}
                    splatRotation={liveRotation}
                    splatScale={selectedScan.splat_scale}
                    hotspots={viewerHotspots}
                    visibleLayers={visibleLayerList}
                    selectedId={selectedHotspot?.id ?? null}
                    adjustingId={adjusting?.id ?? null}
                    placementMode={placementMode || !!placingDoor}
                    placeSurfaceOnly={!!placingDoor}
                    pendingColor={placingDoor ? '#0E7C86' : '#C65A1A'}
                    measureMode={mode === 'measure'}
                    onMeasure={setMeasure}
                    pendingPosition={pendingPosition}
                    onPlacePending={handleViewerPlace}
                    onSelectHotspot={handleSelectHotspot}
                    onHoverHotspot={(h, at) => setHovered(h ? { id: h.id, label: h.label, x: at.x, y: at.y } : null)}
                    onLoadState={setViewer}
                    apiRef={viewerApiRef}
                    stageColor={VM_STAGE}
                  />
                )}

                {/* Inside a container — a photo of the interior, covering the
                    3-D stage, with its own pins. The scan keeps rendering
                    underneath so backing out restores the camera. */}
                {openContainer && (
                  <InteriorView
                    scanName={selectedScan.name}
                    trail={containerTrail}
                    childPins={childPins}
                    canManage={canPlaceHotspots}
                    placing={mode === 'pin'}
                    selectedId={selectedHotspot?.id ?? null}
                    onPlace={createChildPin}
                    onSelectPin={setSelectedHotspot}
                    onCrumb={crumbTo}
                  />
                )}

                {/* Fullscreen: the room deserves the whole glass. f toggles.
                    Yields the corner while the straighten panel is open. */}
                {viewer.status === 'ready' && orientDraft === null && !openContainer && (
                  <button
                    className="vm-fullscreen-btn"
                    onClick={() => setImmersive((v) => !v)}
                    aria-label={immersive ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {immersive ? '✕ Exit fullscreen' : '⛶ Fullscreen'}
                  </button>
                )}

                <ToolRail
                  mode={mode}
                  onMode={selectMode}
                  canPin={canPlaceHotspots}
                  pinReady={openContainer ? true : viewer.status === 'ready'}
                  interior={!!openContainer}
                />

                {placementMode && !modalOpen && !adjusting && (
                  <div className="vm-pin-hint">
                    Click to drop a pin
                    <span className="vm-pin-hint-kbd">Esc cancels</span>
                  </div>
                )}

                {placementMode && adjusting && (
                  <div className="vm-pin-hint vm-adjust-bar">
                    <span className="vm-adjust-label">Repositioning “{adjusting.label}” — click or drag</span>
                    {adjustError && <span className="vm-adjust-error">{adjustError}</span>}
                    <button className="vm-btn-primary vm-adjust-btn" onClick={saveAdjust} disabled={adjustSaving}>
                      {adjustSaving ? 'Saving…' : 'Save position'}
                    </button>
                    <button className="vm-btn-ghost vm-adjust-btn" onClick={cancelAdjust} disabled={adjustSaving}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Pin hover tag — fades in after a 150ms dwell. */}
                {hovered && (
                  <div key={hovered.id} className="vm-pin-tag" style={{ left: hovered.x + 14, top: hovered.y - 10 }}>
                    {hovered.label}
                  </div>
                )}

                {/* Orient scan (COMMAND/CHIEF, desktop): rotate-90° per axis,
                    live re-frame, save writes the row. */}
                {canPlaceHotspots && viewer.status === 'ready' && (
                  orientDraft === null ? (
                    <button
                      className="vm-orient-open"
                      title="Fix a scan that loads tilted or on its side"
                      onClick={() => {
                        setOrientError(null);
                        setOrientDraft({
                          x: Number(baseRotation.x) || 0,
                          y: Number(baseRotation.y) || 0,
                          z: Number(baseRotation.z) || 0,
                        });
                      }}
                    >
                      Straighten scan
                    </button>
                  ) : (
                    <OrientPanel
                      value={liveRotation}
                      onChange={(next) => { setOrientError(null); setOrientDraft(next); }}
                      onSave={saveOrientation}
                      onCancel={cancelOrientation}
                      saving={orientSaving}
                      error={orientError}
                    />
                  )
                )}

                {/* Back-of-house — quiet, near the scan chrome. */}
                {canPlaceHotspots && (
                  <button className="vm-manage-link" onClick={() => navigate('/settings/vessel?section=location-management')}>
                    Manage scans
                  </button>
                )}

                {/* ≥1024px: the inspector replaces the floating card. */}
                <Inspector
                  hotspot={selectedHotspot}
                  creatorName={selectedHotspot?.created_by ? creatorNames[selectedHotspot.created_by] : null}
                  canManage={canPlaceHotspots}
                  user={user}
                  tier={userTier}
                  tenantId={activeTenantId}
                  names={creatorNames}
                  onDetailSaved={onDetailSaved}
                  onLocationChanged={onLocationChanged}
                  onClose={closeInspector}
                  onDelete={deleteHotspot}
                  onAdjust={startAdjust}
                  onRename={renameHotspot}
                  onRelayer={relayerHotspot}
                  onToggleContainer={setContainer}
                  onInteriorPhoto={setInteriorPhoto}
                  onOpenInterior={openInterior}
                  childCount={selectedHotspot ? hotspots.filter((h) => h.parent_id === selectedHotspot.id).length : 0}
                  autoFocusName={justCreatedId === selectedHotspot?.id}
                />

                {/* ≥1024px: breadcrumb + layer chips float on the dark stage,
                    light-on-dark. Below that the cream toolbar above carries
                    them — the shipped layout, now the mobile variant. */}
                <div className="vm-stage-overlay">
                  <p className="vm-ov-breadcrumb">
                    <span className="dot">●</span>
                    <span>Vessel Map</span>
                    {selectedScan && (
                      <>
                        <span className="sep">·</span>
                        <em>{selectedScan.name}</em>
                      </>
                    )}
                  </p>
                  <div className="vm-ov-chips">{layerChips('vm-chip-dark')}</div>
                </div>

                {/* Doorways EDIT mode (rail tool) — placement lives here, not in
                    an always-on bar. */}
                {showViewer && viewer.status !== 'error' && !orientDraft && !adjusting && mode === 'doorways' && (
                  <div className="vm-doors">
                    {placingDoor ? (
                      <>
                        <span className="vm-doors-label">Placing</span>
                        <span className="vm-door-placing">
                          {pendingPosition
                            ? `Drag the pin onto the door to “${placingDoor.name}”, then place it`
                            : `Click the door/frame for “${placingDoor.name}” — the pin snaps to the surface`}
                        </span>
                        {pendingPosition && (
                          <button className="vm-door vm-door-confirm" onClick={confirmDoorPlacement}>Place door</button>
                        )}
                        <button className="vm-door vm-door-cancel" onClick={cancelDoorPlacement}>Cancel</button>
                      </>
                    ) : roomDoorways.length === 0 ? (
                      <span className="vm-door-placing">No doorways here yet — link this room to another on the deck plan.</span>
                    ) : (
                      <>
                        <span className="vm-doors-label">Doorways</span>
                        {roomDoorways.map((d) => (
                          <button
                            key={d.linkId}
                            className={`vm-door vm-door-edit${d.walkable ? ' is-walkable' : ''}`}
                            onClick={() => startPlaceDoor(d)}
                            title={d.pos ? `Move the pin for ${d.name}` : `Place a pin on the door for ${d.name}`}
                          >
                            <span className="vm-door-dot" aria-hidden="true" />
                            {d.name}
                            <span className="vm-door-act">{d.pos ? 'Move' : 'Place'}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Navigate — a clean walk shortcut for doors that are ready. */}
                {showViewer && viewer.status !== 'error' && !orientDraft && !adjusting && mode === 'navigate' && roomDoorways.some((d) => d.walkable) && (
                  <div className="vm-doors">
                    <span className="vm-doors-label">Walk to</span>
                    {roomDoorways.filter((d) => d.walkable).map((d) => (
                      <button key={d.linkId} className="vm-door" onClick={() => setSelectedScanId(d.targetScanId)} title={`Walk through to ${d.name}`}>
                        {d.name}<span className="vm-door-arrow" aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Measure tool readout. */}
                {showViewer && viewer.status !== 'error' && mode === 'measure' && (
                  <div className="vm-doors vm-measure">
                    <span className="vm-doors-label">Measure</span>
                    {measure?.points === 2 ? (
                      <>
                        <span className="vm-measure-val">≈ {measure.meters.toFixed(2)} m</span>
                        <span className="vm-door-placing">Click again to start over.</span>
                      </>
                    ) : (
                      <span className="vm-door-placing">{measure?.points === 1 ? 'Click the second point.' : 'Click two points on the scan to measure the distance.'}</span>
                    )}
                  </div>
                )}

                {signError && (
                  <div className="vm-panel vm-missing">
                    <p className="vm-empty-title">Scan file not available</p>
                    <p className="vm-empty-body">
                      “{selectedScan.name}” points at <code>{selectedScan.storage_path}</code> in
                      the vessel-scans bucket, but the file isn't there yet. Upload it to that
                      exact path and reload.
                    </p>
                  </div>
                )}

                {showViewer && viewer.status === 'error' && (
                  <div className="vm-panel vm-missing">
                    <p className="vm-empty-title">Couldn't load this scan</p>
                    <p className="vm-empty-body">{viewer.message}</p>
                  </div>
                )}

                {showViewer && viewer.status === 'loading' && (
                  <div className="vm-loading">
                    <p className="vm-loading-label">
                      Loading {selectedScan.name}
                      {viewer.loadedBytes ? ` — ${fmtMB(viewer.loadedBytes)}` : ''}
                      {loadPct != null ? ` (${loadPct}%)` : ''}
                    </p>
                    <div className="vm-loading-track">
                      <div
                        className={`vm-loading-fill${loadPct == null ? ' vm-loading-indeterminate' : ''}`}
                        style={loadPct != null ? { width: `${loadPct}%` } : undefined}
                      />
                    </div>
                  </div>
                )}

                {selectedHotspot && (
                  <aside className="vm-side-panel">
                    <button className="vm-side-close" onClick={closeInspector} aria-label="Close">×</button>
                    {canPlaceHotspots ? (
                      <input
                        className="vm-input vm-name-input"
                        value={selectedHotspot.label}
                        placeholder="Name this pin"
                        autoFocus={justCreatedId === selectedHotspot.id}
                        onChange={(e) => renameHotspot(selectedHotspot.id, e.target.value)}
                      />
                    ) : (
                      <h2 className="vm-side-title">{selectedHotspot.label || 'Untitled pin'}</h2>
                    )}
                    {canPlaceHotspots ? (
                      <div className="vm-swatch-row" role="radiogroup" aria-label="Category">
                        {LAYERS.map((l) => {
                          const on = (selectedHotspot.layer || 'general') === l.key;
                          return (
                            <button key={l.key} type="button" role="radio" aria-checked={on} title={l.label}
                              className={`vm-swatch${on ? ' on' : ''}`}
                              style={{ background: l.color, color: l.color }}
                              onClick={() => relayerHotspot(selectedHotspot.id, l.key)} />
                          );
                        })}
                        <span className="vm-swatch-name">{layerLabel(selectedHotspot.layer)}</span>
                      </div>
                    ) : (
                      <span className="vm-pill vm-pill-static">
                        <span className="vm-pill-dot" style={{ background: selectedHotspot.color || layerColor(selectedHotspot.layer) }} />
                        {layerLabel(selectedHotspot.layer)}
                      </span>
                    )}
                    {canPlaceHotspots && (
                      <label className={`vm-ct${selectedHotspot.is_container ? ' on' : ''}`}>
                        <input type="checkbox" checked={!!selectedHotspot.is_container} onChange={(e) => setContainer(selectedHotspot.id, e.target.checked)} />
                        <span className="vm-ct-switch" aria-hidden="true" />
                        <span className="vm-ct-text">
                          <span className="vm-ct-title">Other pins live inside this one</span>
                          <span className="vm-ct-sub">{selectedHotspot.is_container ? 'Opens a photo of the inside where you place pins' : 'Off — just this one pin, nothing inside it'}</span>
                        </span>
                      </label>
                    )}

                    {/* Same four rooms as the desktop inspector — functional,
                        not redesigned. Photos-from-phone is the headline. */}
                    <div className="vm-insp-tabs vm-side-tabs" role="tablist">
                      {['details', 'notes', 'list', 'photos'].map((t) => (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={mobileTab === t}
                          className={`vm-insp-tab${mobileTab === t ? ' vm-insp-tab-on' : ''}`}
                          onClick={() => setMobileTab(t)}
                        >
                          {t === 'details' ? 'Details' : t === 'notes' ? 'Notes' : t === 'list' ? 'List' : 'Photos'}
                        </button>
                      ))}
                    </div>

                    {mobileTab === 'details' && (
                      <>
                        <p className="vm-side-row">
                          <span className="vm-label">Added</span>
                          {fmtDate(selectedHotspot.created_at)}
                        </p>
                        <PinLocation
                          hotspot={selectedHotspot}
                          canManage={canPlaceHotspots}
                          tenantId={activeTenantId}
                          onLocationChanged={onLocationChanged}
                        />
                      </>
                    )}
                    {mobileTab !== 'details' && (
                      <PinPayload
                        hotspot={selectedHotspot}
                        tab={mobileTab}
                        user={user}
                        tier={userTier}
                        canManage={canPlaceHotspots}
                        tenantId={activeTenantId}
                        names={creatorNames}
                        onDetailSaved={onDetailSaved}
                      />
                    )}
                  </aside>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}
