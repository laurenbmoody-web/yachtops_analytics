// Vessel Map — 3D Gaussian-splat scans of the vessel's spaces, rendered
// in-browser with @sparkjsdev/spark + plain three.js (no R3F). Crew-side
// only. Every active tenant member can view; hotspot placement is
// COMMAND/CHIEF (mirrored by RLS on scan_hotspots).
//
// Data flow: vessel_scans rows for the tenant → signed URL (1h) for the
// selected scan's private storage object → SplatViewer loads whatever
// format the row declares (ply/spz/… — never assumes SPZ). scan_hotspots
// render as layer-coloured pins; the layer chip row filters them.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Header from '../../components/navigation/Header';
import SplatViewer from './components/SplatViewer';
import HotspotModal from './components/HotspotModal';
import ToolRail from './components/ToolRail';
import Inspector from './components/Inspector';
import useCanvasShortcuts from '../../hooks/useCanvasShortcuts';
import { LAYERS, layerColor, layerLabel } from './layers';
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
  // Canvas mode — the rail's single active tool. 'pin' is the old
  // placementMode; the mobile variant's Add-hotspot button drives the same
  // state.
  const [mode, setMode] = useState('navigate');
  const [pendingPosition, setPendingPosition] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [hovered, setHovered] = useState(null); // { label, x, y } — pin hover tag
  const [orientDraft, setOrientDraft] = useState(null); // {x,y,z} radians while orienting
  const [orientError, setOrientError] = useState(null);
  const [orientSaving, setOrientSaving] = useState(false);
  const isDesktop = useIsDesktop();
  const placementMode = mode === 'pin';

  const selectedScan = useMemo(
    () => scans.find((s) => s.id === selectedScanId) || null,
    [scans, selectedScanId]
  );

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
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('[vessel-map] scans fetch error:', error);
        setScans([]);
      } else {
        setScans(data || []);
        setSelectedScanId((prev) => prev && data?.some((s) => s.id === prev) ? prev : data?.[0]?.id || null);
      }
      setScansLoading(false);
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

    // Creator names for the inspector's Details tab — one lookup for all
    // pins; nulls (pre-tracking pins) simply don't render an "Added by" row.
    const uids = [...new Set((data || []).map((h) => h.created_by).filter(Boolean))];
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
    loadHotspots();
  }, [loadHotspots]);

  const layerCounts = useMemo(() => {
    const counts = {};
    for (const h of hotspots) counts[h.layer] = (counts[h.layer] || 0) + 1;
    return counts;
  }, [hotspots]);

  // All pins go to the viewer; layer visibility is a fade, not a filter
  // (chips toggle their pins with a 150ms fade, not a pop).
  const allHotspots = useMemo(
    () => hotspots.map((h) => ({ ...h, color: h.color || layerColor(h.layer) })),
    [hotspots]
  );
  const visibleLayerList = useMemo(() => [...activeLayers], [activeLayers]);

  const toggleLayer = (key) => setActiveLayers((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

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
    setMode('pin');
  };
  const cancelPlacement = () => {
    setMode('navigate');
    setPendingPosition(null);
    setModalOpen(false);
  };

  // Desktop is the one-gesture flow: click drops the pin AND opens the
  // creation modal. The mobile variant keeps the shipped two-step
  // (drop → drag to fine-tune → Save).
  const placePending = (pos) => {
    setPendingPosition(pos);
    if (isDesktop && pos) setModalOpen(true);
  };

  const dismissModal = () => {
    setModalOpen(false);
    if (isDesktop) setPendingPosition(null); // stay in Pin mode, retry the click
  };

  // Keyboard vocabulary (desktop only): V navigate, P pin, Escape unwinds —
  // modal first, then selection, then back to Navigate.
  useCanvasShortcuts({
    v: () => cancelPlacement(),
    p: () => {
      if (canPlaceHotspots && viewer.status === 'ready') startPlacement();
    },
    escape: () => {
      if (modalOpen) dismissModal();
      else if (selectedHotspot) setSelectedHotspot(null);
      else cancelPlacement();
    },
  }, { enabled: isDesktop });

  // ── Orient scan (COMMAND/CHIEF): rotate-90° per axis, live re-frame, save.
  // Tuning orientation by SQL stops today.
  const HALF_PI = Math.PI / 2;
  const norm = (rad) => {
    const twoPi = Math.PI * 2;
    let r = rad % twoPi;
    if (r > Math.PI) r -= twoPi;
    if (r < -Math.PI + 1e-9) r += twoPi;
    return +r.toFixed(6);
  };
  const baseRotation = selectedScan?.splat_rotation || { x: 0, y: 0, z: 0 };
  const liveRotation = orientDraft ?? baseRotation;
  const rotateAxis = (axis, dir) => {
    setOrientError(null);
    setOrientDraft((prev) => {
      const cur = prev ?? { x: Number(baseRotation.x) || 0, y: Number(baseRotation.y) || 0, z: Number(baseRotation.z) || 0 };
      return { ...cur, [axis]: norm((cur[axis] || 0) + dir * HALF_PI) };
    });
  };
  const saveOrientation = async () => {
    if (!orientDraft || orientSaving) return;
    setOrientSaving(true);
    setOrientError(null);
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
    setScans((prev) => prev.map((s) => (s.id === selectedScan.id ? { ...s, splat_rotation: orientDraft } : s)));
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

  // Returns an error message on failure (modal shows it), null on success.
  const saveHotspot = async ({ label, layer }) => {
    const { data, error } = await supabase
      .from('scan_hotspots')
      .insert({
        scan_id: selectedScan.id,
        tenant_id: activeTenantId,
        label,
        layer,
        color: layerColor(layer),
        position: pendingPosition,
        detail: {},
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (error) {
      console.error('[vessel-map] hotspot insert error:', error);
      return error.message || 'Could not save the hotspot.';
    }
    setHotspots((prev) => [...prev, data]);
    setActiveLayers((prev) => new Set(prev).add(layer)); // never save into a hidden layer
    // The creator-name map fills from profiles on load — a pin saved this
    // session is the signed-in user, so seed their name without a refetch.
    if (data.created_by && !creatorNames[data.created_by]) {
      const name = user?.user_metadata?.full_name || user?.email;
      if (name) setCreatorNames((prev) => ({ ...prev, [data.created_by]: name }));
    }
    cancelPlacement();
    setSelectedHotspot(data); // pin it, name it, then enrich it — selection opens the details
    return null;
  };

  // ── Render ──────────────────────────────────────────────────────────────
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
                  placementMode ? (
                    <div className="vm-place-controls">
                      <span className="vm-place-hint">
                        {pendingPosition
                          ? 'Drag the pin to fine-tune, then save'
                          : 'Click in the room to drop a pin'}
                      </span>
                      {pendingPosition && (
                        <button className="vm-btn-primary" onClick={() => setModalOpen(true)}>
                          Save hotspot
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

              <div className="vm-stage">
                {showViewer && (
                  <SplatViewer
                    signedUrl={signedUrl}
                    fileName={selectedScan.storage_path.split('/').pop()}
                    cameraPosition={selectedScan.camera_position}
                    cameraTarget={selectedScan.camera_target}
                    splatRotation={liveRotation}
                    splatScale={selectedScan.splat_scale}
                    hotspots={allHotspots}
                    visibleLayers={visibleLayerList}
                    selectedId={selectedHotspot?.id ?? null}
                    placementMode={placementMode}
                    pendingPosition={pendingPosition}
                    onPlacePending={placePending}
                    onSelectHotspot={setSelectedHotspot}
                    onHoverHotspot={(h, at) => setHovered(h ? { id: h.id, label: h.label, x: at.x, y: at.y } : null)}
                    onLoadState={setViewer}
                    stageColor={VM_STAGE}
                  />
                )}

                <ToolRail
                  mode={mode}
                  onMode={(m) => (m === 'pin' ? startPlacement() : cancelPlacement())}
                  canPin={canPlaceHotspots}
                  pinReady={viewer.status === 'ready'}
                />

                {placementMode && !modalOpen && (
                  <div className="vm-pin-hint">
                    Click to drop a pin
                    <span className="vm-pin-hint-kbd">Esc cancels</span>
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
                      onClick={() => {
                        setOrientError(null);
                        setOrientDraft({
                          x: Number(baseRotation.x) || 0,
                          y: Number(baseRotation.y) || 0,
                          z: Number(baseRotation.z) || 0,
                        });
                      }}
                    >
                      Orient scan
                    </button>
                  ) : (
                    <div className="vm-orient-panel">
                      <p className="vm-orient-eyebrow">Orient scan</p>
                      {['x', 'y', 'z'].map((axis) => (
                        <div key={axis} className="vm-orient-row">
                          <span className="vm-orient-axis">{axis.toUpperCase()}</span>
                          <button className="vm-orient-step" onClick={() => rotateAxis(axis, -1)} aria-label={`Rotate ${axis} -90°`}>−90°</button>
                          <span className="vm-orient-val">{Math.round((liveRotation[axis] || 0) * 180 / Math.PI)}°</span>
                          <button className="vm-orient-step" onClick={() => rotateAxis(axis, 1)} aria-label={`Rotate ${axis} +90°`}>+90°</button>
                        </div>
                      ))}
                      {orientError && <p className="vm-orient-error">{orientError}</p>}
                      <div className="vm-orient-actions">
                        <button className="vm-btn-primary vm-orient-save" onClick={saveOrientation} disabled={orientSaving}>
                          {orientSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button className="vm-btn-ghost vm-orient-cancel" onClick={cancelOrientation} disabled={orientSaving}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                )}

                {/* ≥1024px: the inspector replaces the floating card. */}
                <Inspector
                  hotspot={selectedHotspot}
                  creatorName={selectedHotspot?.created_by ? creatorNames[selectedHotspot.created_by] : null}
                  canManage={canPlaceHotspots}
                  onClose={() => setSelectedHotspot(null)}
                  onDelete={deleteHotspot}
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
                    <button className="vm-side-close" onClick={() => setSelectedHotspot(null)} aria-label="Close">×</button>
                    <p className="vm-label">Hotspot</p>
                    <h2 className="vm-side-title">{selectedHotspot.label}</h2>
                    <span className="vm-pill vm-pill-static">
                      <span className="vm-pill-dot" style={{ background: selectedHotspot.color || layerColor(selectedHotspot.layer) }} />
                      {layerLabel(selectedHotspot.layer)}
                    </span>
                    {selectedHotspot.storage_location_id && (
                      <p className="vm-side-row">
                        <span className="vm-label">Storage location</span>
                        {selectedHotspot.storage_location_id}
                      </p>
                    )}
                    <p className="vm-side-row">
                      <span className="vm-label">Added</span>
                      {fmtDate(selectedHotspot.created_at)}
                    </p>
                  </aside>
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {modalOpen && pendingPosition && (
        <HotspotModal onSave={saveHotspot} onCancel={dismissModal} />
      )}
    </>
  );
}
