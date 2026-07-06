// SplatViewer — plain three.js + @sparkjsdev/spark Gaussian-splat viewer.
// No React Three Fiber: one effect owns the whole GL lifecycle (scene,
// camera, renderer, SparkRenderer, SplatMesh, OrbitControls) and tears it
// all down on unmount so route changes never leak GL contexts or workers.
//
// Camera containment: room bounds come from the 8th–92nd percentile of
// splat centres (stride-sampled to ~60k, splats under 0.3 opacity skipped —
// halo fuzz is translucent), so clamp boxes, zoom limits and near/far track
// the actual room rather than the outlier cloud. The clamp runs on every
// controls change; no combination of zoom/pan/orbit leaves the room. The
// derivation re-runs live when the scan is re-oriented (Orient tool).
//
// Pins are UI, not objects in the room: constant on-screen size, layer
// visibility fades over 150ms, hover raises a label tag, selection gets one
// ring pulse (600ms, once) then a steady ring, and the orbit target glides
// to a selected pin over 400ms ease-in-out — cancelled the moment the user
// grabs the canvas.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const CLICK_SLOP_PX = 6;   // pointer travel under this = click, over = orbit drag
const FADE_MS = 150;       // layer-toggle pin fade
const GLIDE_MS = 400;      // camera target glide on selection
const PULSE_MS = 600;      // selection ring pulse, once

const toVec3 = (v, fallback) => new THREE.Vector3(
  Number(v?.x ?? fallback.x), Number(v?.y ?? fallback.y), Number(v?.z ?? fallback.z)
);

// Circular disc texture for pin sprites, cached per colour.
const discTextureCache = new Map();
const discTexture = (color) => {
  if (discTextureCache.has(color)) return discTextureCache.get(color);
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  discTextureCache.set(color, tex);
  return tex;
};

// Off-white ring texture for the selection treatment.
let ringTextureCached = null;
const ringTexture = () => {
  if (ringTextureCached) return ringTextureCached;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(244,243,238,0.95)';
  ctx.stroke();
  ringTextureCached = new THREE.CanvasTexture(canvas);
  ringTextureCached.colorSpace = THREE.SRGBColorSpace;
  return ringTextureCached;
};

const makePin = (color) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTexture(color),
    depthTest: false,
    transparent: true,
  }));
  sprite.scale.setScalar(0.0001); // real scale set per-frame
  sprite.renderOrder = 10;
  return sprite;
};

const makeRing = () => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTexture(),
    depthTest: false,
    transparent: true,
  }));
  sprite.renderOrder = 11;
  sprite.visible = false;
  sprite.userData.isRing = true;
  return sprite;
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Shrink a Box3 towards its centre by `factor` (0..1) per axis.
const shrunkBox = (box, factor) => {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(factor);
  return new THREE.Box3().setFromCenterAndSize(center, size);
};

export default function SplatViewer({
  signedUrl,
  fileName,               // basename of storage_path — Spark infers ply/spz/… from it
  cameraPosition,         // scan row jsonb {x,y,z}
  cameraTarget,           // scan row jsonb {x,y,z}
  splatRotation,          // scan row jsonb {x,y,z} radians — live: Orient tool re-fits
  splatScale,             // scan row numeric
  hotspots,               // ALL pins [{id, label, layer, position, color}]
  visibleLayers,          // array of layer keys currently shown — pins fade in/out
  selectedId,             // id of the selected hotspot — ring + target glide
  adjustingId,            // pin being repositioned — hidden while the pending pin stands in
  placementMode,
  pendingPosition,        // {x,y,z} | null — the not-yet-saved pin
  onPlacePending,         // (pos) => void — click/drag placed the pending pin
  onSelectHotspot,        // (hotspot | null) => void
  onHoverHotspot,         // (hotspot | null, {x, y}) => void — client coords
  onLoadState,            // ({status, progress?, message?}) => void
  stageColor = '#22253F', // WebGL clear colour — the dark stage the splat glows against
}) {
  const containerRef = useRef(null);
  const glRef = useRef(null);        // everything the main effect builds
  const hotspotsRef = useRef(hotspots);
  const visibleRef = useRef(visibleLayers);
  const placementRef = useRef(placementMode);
  const pendingRef = useRef(pendingPosition);
  const selectedRef = useRef(selectedId);
  const adjustingRef = useRef(adjustingId);
  const callbacksRef = useRef({});

  hotspotsRef.current = hotspots;
  visibleRef.current = visibleLayers;
  placementRef.current = placementMode;
  adjustingRef.current = adjustingId;
  callbacksRef.current = { onPlacePending, onSelectHotspot, onHoverHotspot, onLoadState };

  // ── Main GL lifecycle — rebuilt only when the file changes ────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !signedUrl) return undefined;

    let disposed = false;
    const emit = (state) => { if (!disposed) callbacksRef.current.onLoadState?.(state); };
    emit({ status: 'loading', progress: 0 });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / Math.max(1, container.clientHeight), 0.01, 1000
    );
    camera.position.copy(toVec3(cameraPosition, { x: 0, y: 1.6, z: 3 }));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(new THREE.Color(stageColor), 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.touchAction = 'none'; // OrbitControls owns touch
    container.appendChild(renderer.domElement);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(toVec3(cameraTarget, { x: 0, y: 1, z: 0 }));
    controls.enableDamping = true;
    controls.dampingFactor = 0.18; // default 0.05 coasts for seconds on big rooms

    const rot = toVec3(splatRotation, { x: 0, y: 0, z: 0 });
    const mesh = new SplatMesh({
      url: signedUrl,
      fileName, // signed URLs carry query params — give Spark the real name for format inference
      onProgress: (e) => {
        const pct = e?.total ? Math.round((e.loaded / e.total) * 100) : null;
        emit({ status: 'loading', progress: pct, loadedBytes: e?.loaded ?? 0 });
      },
    });
    mesh.rotation.set(rot.x, rot.y, rot.z);
    mesh.scale.setScalar(Number(splatScale) || 1);
    scene.add(mesh);

    const spriteGroup = new THREE.Group();
    scene.add(spriteGroup);
    let pendingPin = null;

    // Selection treatment: steady ring + one expanding ghost on select.
    const steadyRing = makeRing();
    const pulseRing = makeRing();
    scene.add(steadyRing);
    scene.add(pulseRing);
    let pulseStart = 0;

    // Placement reticle — a small surface-snapped dot tracking the cursor in
    // Pin mode, so placement is previewed before the click. Hidden on miss.
    const reticle = makePin('#F4F3EE');
    reticle.material.opacity = 0.9;
    reticle.renderOrder = 12;
    reticle.visible = false;
    scene.add(reticle);
    let reticleOn = false;

    // Target glide on selection — cancelled the moment the user grabs.
    let glide = null; // { from, to, start }
    controls.addEventListener('start', () => { glide = null; });

    // Clamp boxes — null until load completes; refit() rebuilds them.
    let targetBox = null;
    let cameraBox = null;
    const clampView = () => {
      if (!targetBox) return;
      targetBox.clampPoint(controls.target, controls.target);
      cameraBox.clampPoint(camera.position, camera.position);
    };
    controls.addEventListener('change', clampView);

    // ── Per-frame pin pass: constant screen size, layer fades, rings ────────
    const PIN_VIEW_FRACTION = 0.035;
    let lastFrame = performance.now();
    const pinPass = () => {
      const now = performance.now();
      const dt = Math.min(now - lastFrame, 100);
      lastFrame = now;
      const fovScale = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const fadeStep = dt / FADE_MS;
      const visible = visibleRef.current;

      for (const pin of spriteGroup.children) {
        const d = pin.position.distanceTo(camera.position);
        pin.scale.setScalar(d * fovScale * PIN_VIEW_FRACTION * (pin.userData.isPending ? 1.25 : 1));

        if (!pin.userData.isPending) {
          // Chips toggle their pins with a 150ms fade, not a pop. A pin
          // being repositioned hides — the pending pin stands in for it.
          const shown = (!visible || visible.includes(pin.userData.hotspot?.layer || 'general'))
            && pin.userData.hotspot?.id !== adjustingRef.current;
          pin.userData.shown = shown;
          const target = shown ? 1 : 0;
          const o = pin.material.opacity;
          pin.material.opacity = target > o ? Math.min(target, o + fadeStep) : Math.max(target, o - fadeStep);
          pin.visible = pin.material.opacity > 0.01;
        }
      }

      const sel = (hotspotsRef.current || []).find((h) => h.id === selectedRef.current);
      steadyRing.visible = !!sel;
      if (sel) {
        steadyRing.position.set(Number(sel.position?.x) || 0, Number(sel.position?.y) || 0, Number(sel.position?.z) || 0);
        const d = steadyRing.position.distanceTo(camera.position);
        const base = d * fovScale * PIN_VIEW_FRACTION;
        steadyRing.scale.setScalar(base * 1.6);
        steadyRing.material.opacity = 0.95;

        const t = (now - pulseStart) / PULSE_MS;
        if (t < 1) {
          const e = easeOutCubic(t);
          pulseRing.visible = true;
          pulseRing.position.copy(steadyRing.position);
          pulseRing.scale.setScalar(base * (1.6 + 1.4 * e));
          pulseRing.material.opacity = 0.6 * (1 - e);
        } else {
          pulseRing.visible = false;
        }
      } else {
        pulseRing.visible = false;
      }

      if (glide) {
        const t = (now - glide.start) / GLIDE_MS;
        if (t >= 1) {
          controls.target.copy(glide.to);
          glide = null;
        } else {
          controls.target.lerpVectors(glide.from, glide.to, easeInOutCubic(t));
        }
      }

      reticle.visible = !!placementRef.current && reticleOn;
      if (reticle.visible) {
        const d = reticle.position.distanceTo(camera.position);
        reticle.scale.setScalar(d * fovScale * PIN_VIEW_FRACTION * 0.5);
      }
    };

    // Rebuild pin sprites from current props.
    const rebuildPins = () => {
      for (const child of [...spriteGroup.children]) {
        spriteGroup.remove(child);
        child.material.dispose();
      }
      for (const h of hotspotsRef.current || []) {
        const pin = makePin(h.color);
        pin.position.set(Number(h.position?.x) || 0, Number(h.position?.y) || 0, Number(h.position?.z) || 0);
        pin.userData.hotspot = h;
        pin.userData.shown = true;
        spriteGroup.add(pin);
      }
      if (pendingRef.current) {
        pendingPin = makePin('#C65A1A');
        pendingPin.material.opacity = 0.85;
        pendingPin.position.set(pendingRef.current.x, pendingRef.current.y, pendingRef.current.z);
        pendingPin.userData.isPending = true;
        spriteGroup.add(pendingPin);
      } else {
        pendingPin = null;
      }
      pinPass();
    };

    // ── Room fit: bounds from opacity-filtered percentile splat centres ─────
    // One sampling pass feeds two consumers: the PICK-CLOUD (~150k world-
    // space centres retained for surface-snapped placement) and the bounds
    // percentiles (a further subsample of the same points). Splats under 0.3
    // opacity are skipped — halo fuzz is translucent. Re-run live by the
    // Orient tool, so the pick-cloud always matches the shown orientation.
    let pickPoints = null; // Float32Array [x,y,z,...] — world space
    let fitMaxDim = 1;
    const refit = (allowReframe) => {
      mesh.updateMatrixWorld(true);
      const total = mesh.packedSplats?.numSplats || 0;
      const stride = total ? Math.max(1, Math.floor(total / 150000)) : 4;
      const pts = [];
      const v = new THREE.Vector3();
      let i = 0;
      mesh.forEachSplat((idx, center, scales, quat, opacity) => {
        if ((i++ % stride) !== 0) return;
        if (opacity < 0.3) return;
        v.copy(center).applyMatrix4(mesh.matrixWorld);
        pts.push(v.x, v.y, v.z);
      });
      pickPoints = new Float32Array(pts);
      // Bounds percentiles from a ~60k subsample of the retained points.
      const n = pts.length / 3;
      const pStride = Math.max(1, Math.floor(n / 60000));
      const xs = [], ys = [], zs = [];
      for (let j = 0; j < n; j += pStride) {
        xs.push(pts[j * 3]); ys.push(pts[j * 3 + 1]); zs.push(pts[j * 3 + 2]);
      }
      const q = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(p * (arr.length - 1))))];
      let bounds, median, eyeLift = 0.15;
      if (xs.length > 500) {
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); zs.sort((a, b) => a - b);
        bounds = new THREE.Box3(
          new THREE.Vector3(q(xs, 0.08), q(ys, 0.08), q(zs, 0.08)),
          new THREE.Vector3(q(xs, 0.92), q(ys, 0.92), q(zs, 0.92))
        );
        median = new THREE.Vector3(q(xs, 0.5), q(ys, 0.5), q(zs, 0.5));
        eyeLift = (q(ys, 0.75) - q(ys, 0.25)) * 0.1;
      } else {
        bounds = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
        median = bounds.getCenter(new THREE.Vector3());
      }
      const maxDim = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 0.001);
      fitMaxDim = maxDim;

      targetBox = shrunkBox(bounds, 0.7);   // orbit target stays well inside the room
      cameraBox = shrunkBox(bounds, 0.92);  // camera can go nearer the walls, never through
      controls.minDistance = maxDim * 0.03;
      controls.maxDistance = maxDim * 0.6;
      camera.near = maxDim * 0.002;
      camera.far = maxDim * 20;
      camera.updateProjectionMatrix();

      // Stored camera defaults are metric/origin-centred; real scans are
      // neither. When the stored framing is outside this scan's bounds,
      // anchor on the median splat (mid-room-mass however heavy the fuzz)
      // and look horizontally from eye level.
      if (allowReframe && (!cameraBox.containsPoint(camera.position) || !targetBox.containsPoint(controls.target))) {
        const size = bounds.getSize(new THREE.Vector3());
        const horizontalSpan = Math.max(size.x, size.z, 0.001);
        const dir = camera.position.clone().sub(controls.target);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();
        controls.target.copy(median);
        camera.position.copy(median)
          .addScaledVector(dir, horizontalSpan * 0.35)
          .setY(median.y + eyeLift);
      }
      clampView();
      console.log('[vessel-map] room fit', {
        samples: xs.length,
        min: bounds.min.toArray().map((n) => +n.toFixed(2)),
        max: bounds.max.toArray().map((n) => +n.toFixed(2)),
        median: median.toArray().map((n) => +n.toFixed(2)),
        camera: camera.position.toArray().map((n) => +n.toFixed(2)),
        target: controls.target.toArray().map((n) => +n.toFixed(2)),
      });
    };

    glRef.current = {
      rebuildPins,
      pulse: () => { pulseStart = performance.now(); },
      glideTo: (pos) => {
        const to = new THREE.Vector3(pos.x, pos.y, pos.z);
        if (targetBox) targetBox.clampPoint(to, to);
        glide = { from: controls.target.clone(), to, start: performance.now() };
      },
      // Orient tool: apply a rotation live, re-fit bounds, re-frame.
      setRotation: (r) => {
        if (!mesh.isInitialized) return;
        const nr = toVec3(r, { x: 0, y: 0, z: 0 });
        mesh.rotation.set(nr.x, nr.y, nr.z);
        refit(true);
      },
    };

    mesh.initialized.then(() => {
      if (disposed) return;
      refit(true);
      rebuildPins();
      emit({ status: 'ready' });
    }).catch((err) => {
      console.error('[vessel-map] splat load failed', err);
      emit({ status: 'error', message: err?.message || 'The scan file could not be loaded.' });
    });

    // ── Pointer interaction: hover, click-select, placement, pending drag ───
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    // Horizontal placement plane, built from the LIVE orbit target on every
    // ray test — always clamped inside the room, so pins drop at eye-focus
    // height for any scan.
    const placePlane = new THREE.Plane();
    const PLANE_UP = new THREE.Vector3(0, 1, 0);
    let downAt = null;
    let draggingPending = false;
    let hoveredId = null;

    const setPointer = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
    };

    const planeHit = () => {
      placePlane.setFromNormalAndCoplanarPoint(PLANE_UP, controls.target);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(placePlane, hit) ? hit : null;
    };

    // Surface pick: cone-cast the pick-cloud. Centres within an angular
    // radius of the ray (radius grows with distance, so picking feels the
    // same near and far) are clustered by ray-distance; the nearest cluster
    // with real density wins and the snap point is its centroid — a position
    // ON the splat surface. Returns null on a miss (sparse fuzz doesn't
    // count); callers fall back to the focus-plane placement.
    const PICK_TAN = Math.tan(THREE.MathUtils.degToRad(60 / 2)) * 2 * 0.012; // ~1.2% of view height
    const MIN_CLUSTER = 4;
    const surfacePick = () => {
      if (!pickPoints || pickPoints.length < 12) return null;
      const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
      const tMin = fitMaxDim * 0.01;
      const hits = [];
      for (let j = 0; j < pickPoints.length; j += 3) {
        const vx = pickPoints[j] - ro.x, vy = pickPoints[j + 1] - ro.y, vz = pickPoints[j + 2] - ro.z;
        const t = vx * rd.x + vy * rd.y + vz * rd.z;
        if (t < tMin) continue;
        const r = t * PICK_TAN;
        const d2 = vx * vx + vy * vy + vz * vz - t * t;
        if (d2 < r * r) hits.push({ t, j });
      }
      if (hits.length < MIN_CLUSTER) return null;
      hits.sort((a, b) => a.t - b.t);
      const gap = fitMaxDim * 0.03; // new cluster when the along-ray gap exceeds this
      let start = 0;
      for (let j = 1; j <= hits.length; j++) {
        if (j === hits.length || hits[j].t - hits[j - 1].t > gap) {
          const count = j - start;
          if (count >= MIN_CLUSTER) {
            // Snap to the cluster's FRONT SLICE, not its full centroid: a ray
            // grazing a surface (or passing through counter-front + wall in
            // one cluster) spans a long t-range, and a full centroid lands
            // mid-air inside the swath. First contact is the surface.
            const tFront = hits[start].t + fitMaxDim * 0.04;
            let sx = 0, sy = 0, sz = 0, n = 0;
            for (let k = start; k < j && hits[k].t <= tFront; k++) {
              const p = hits[k].j;
              sx += pickPoints[p]; sy += pickPoints[p + 1]; sz += pickPoints[p + 2];
              n++;
            }
            return new THREE.Vector3(sx / n, sy / n, sz / n);
          }
          start = j;
        }
      }
      return null;
    };

    // Surface first, focus plane as the fallback — placement's one rule.
    const placeHit = () => surfacePick() ?? planeHit();

    const selectablePins = () =>
      spriteGroup.children.filter((c) => !c.userData.isPending && c.userData.shown);

    const onPointerDown = (e) => {
      downAt = { x: e.clientX, y: e.clientY };
      if (placementRef.current && pendingPin) {
        setPointer(e);
        const hit = raycaster.intersectObject(pendingPin);
        if (hit.length > 0) {
          draggingPending = true;
          controls.enabled = false;
          renderer.domElement.setPointerCapture?.(e.pointerId);
        }
      }
    };

    const onPointerMove = (e) => {
      if (draggingPending && pendingPin) {
        // Drag-to-fine-tune re-raycasts along surfaces, not the plane.
        setPointer(e);
        const hit = placeHit();
        if (!hit) return;
        if (cameraBox) cameraBox.clampPoint(hit, hit); // dragged pins stay inside the room
        pendingPin.position.copy(hit);
        return;
      }
      // Pin mode: the reticle previews where a click would land.
      if (placementRef.current && !downAt) {
        setPointer(e);
        const hit = surfacePick();
        reticleOn = !!hit;
        if (hit) reticle.position.copy(hit);
        return;
      }
      // Hover: pointer cursor + label tag. Skipped while placing or dragging.
      if (downAt || placementRef.current) return;
      setPointer(e);
      const hits = raycaster.intersectObjects(selectablePins());
      const hot = hits.length > 0 ? hits[0].object.userData.hotspot : null;
      if ((hot?.id ?? null) !== hoveredId) {
        hoveredId = hot?.id ?? null;
        renderer.domElement.style.cursor = hot ? 'pointer' : '';
        callbacksRef.current.onHoverHotspot?.(hot, { x: e.clientX, y: e.clientY });
      }
    };

    const onPointerLeave = () => {
      reticleOn = false;
      if (hoveredId !== null) {
        hoveredId = null;
        renderer.domElement.style.cursor = '';
        callbacksRef.current.onHoverHotspot?.(null, { x: 0, y: 0 });
      }
    };

    const onPointerUp = (e) => {
      if (draggingPending && pendingPin) {
        draggingPending = false;
        controls.enabled = true;
        const p = pendingPin.position;
        callbacksRef.current.onPlacePending?.({ x: p.x, y: p.y, z: p.z });
        downAt = null;
        return;
      }
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > CLICK_SLOP_PX) return; // orbit drag, not a click

      setPointer(e);
      if (placementRef.current) {
        const hit = placeHit();
        if (hit) {
          if (cameraBox) cameraBox.clampPoint(hit, hit); // pins stay inside the room too
          callbacksRef.current.onPlacePending?.({ x: hit.x, y: hit.y, z: hit.z });
        }
        return;
      }
      const hits = raycaster.intersectObjects(selectablePins());
      callbacksRef.current.onSelectHotspot?.(hits.length > 0 ? hits[0].object.userData.hotspot : null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth, h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    renderer.setAnimationLoop(() => {
      controls.update();
      pinPass();
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      glRef.current = null;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      controls.removeEventListener('change', clampView);
      controls.dispose();
      for (const child of [...spriteGroup.children]) child.material.dispose();
      steadyRing.material.dispose();
      pulseRing.material.dispose();
      reticle.material.dispose();
      try {
        mesh.dispose();
        spark.dispose();
      } catch (err) {
        // Disposal during an in-flight load can throw inside Spark's worker
        // teardown; the GL context below is released regardless.
        console.warn('[vessel-map] spark dispose warning', err);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
    // Viewer identity is the file; framing/transform props belong to the same
    // scan row and arrive together with a new signedUrl.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedUrl]);

  // Pins react to prop changes without rebuilding the GL world.
  useEffect(() => {
    pendingRef.current = pendingPosition;
    glRef.current?.rebuildPins();
  }, [hotspots, pendingPosition]);

  // Selection: one ring pulse + target glide to the pin.
  useEffect(() => {
    selectedRef.current = selectedId;
    if (selectedId) {
      glRef.current?.pulse?.();
      const h = (hotspotsRef.current || []).find((x) => x.id === selectedId);
      if (h?.position) glRef.current?.glideTo?.(h.position);
    }
  }, [selectedId]);

  // Orient tool: rotation changes re-fit the room live, no reload.
  useEffect(() => {
    glRef.current?.setRotation?.(splatRotation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatRotation?.x, splatRotation?.y, splatRotation?.z]);

  return (
    <div
      ref={containerRef}
      className={`vm-canvas${placementMode ? ' vm-canvas-placing' : ''}`}
      aria-label="3D vessel scan viewer"
    />
  );
}
