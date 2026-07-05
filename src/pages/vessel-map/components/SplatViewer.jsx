// SplatViewer — plain three.js + @sparkjsdev/spark Gaussian-splat viewer.
// No React Three Fiber: one effect owns the whole GL lifecycle (scene,
// camera, renderer, SparkRenderer, SplatMesh, OrbitControls) and tears it
// all down on unmount so route changes never leak GL contexts or workers.
//
// Camera containment: users must never see outside the scanned room. On
// load we take the mesh's world-space bounding box (splat centers only —
// the full box includes the fuzzy exterior artefacts we're hiding) and
// derive everything from it: near/far planes, OrbitControls min/max
// distance, and two shrunken clamp boxes (orbit target stays well inside
// the room, camera slightly less so). The clamp runs on every controls
// change, so no combination of zoom/pan/orbit can fly through a wall.
// Nothing is hardcoded — every scan differs in size.
//
// Hotspots render as camera-facing circular sprites (depthTest off so pins
// read through the splat fuzz). Spark splats don't raycast natively, so
// placement mode intersects the pointer ray with a horizontal plane at the
// scan's camera_target height; the pending pin can be dragged on that
// plane to fine-tune before saving.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const CLICK_SLOP_PX = 6; // pointer travel under this = click, over = orbit drag

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

const makePin = (color, size) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: discTexture(color),
    depthTest: false,
    transparent: true,
  }));
  sprite.scale.setScalar(size);
  sprite.renderOrder = 10;
  return sprite;
};

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
  splatRotation,          // scan row jsonb {x,y,z} radians
  splatScale,             // scan row numeric
  hotspots,               // [{id, label, position:{x,y,z}, color}] — pre-filtered by layer
  placementMode,
  pendingPosition,        // {x,y,z} | null — the not-yet-saved pin
  onPlacePending,         // (pos) => void — click/drag placed the pending pin
  onSelectHotspot,        // (hotspot | null) => void
  onLoadState,            // ({status, progress?, message?}) => void
}) {
  const containerRef = useRef(null);
  const glRef = useRef(null);        // everything the main effect builds
  const hotspotsRef = useRef(hotspots);
  const placementRef = useRef(placementMode);
  const pendingRef = useRef(pendingPosition);
  const callbacksRef = useRef({ onPlacePending, onSelectHotspot, onLoadState });

  hotspotsRef.current = hotspots;
  placementRef.current = placementMode;
  callbacksRef.current = { onPlacePending, onSelectHotspot, onLoadState };

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

    // Pins render at a CONSTANT on-screen size (like map markers): every
    // frame each sprite is scaled by its distance to the camera, so a pin is
    // the same ~3.5% of view height whether you're across the room or nose
    // up to it. World-fixed sizing made pins balloon when zoomed close and
    // vanish when far, on any scan whose units aren't metric.
    const PIN_VIEW_FRACTION = 0.035;
    const resizePins = () => {
      const fovScale = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      for (const pin of spriteGroup.children) {
        const d = pin.position.distanceTo(camera.position);
        pin.scale.setScalar(d * fovScale * PIN_VIEW_FRACTION * (pin.userData.isPending ? 1.25 : 1));
      }
    };

    // Clamp boxes, derived from the loaded mesh — null until load completes.
    let targetBox = null;
    let cameraBox = null;
    const clampView = () => {
      if (!targetBox) return;
      targetBox.clampPoint(controls.target, controls.target);
      cameraBox.clampPoint(camera.position, camera.position);
    };
    controls.addEventListener('change', clampView);

    // Rebuild pin sprites from current props — called by the effect below too.
    const rebuildPins = () => {
      for (const child of [...spriteGroup.children]) {
        spriteGroup.remove(child);
        child.material.dispose();
      }
      for (const h of hotspotsRef.current || []) {
        const pin = makePin(h.color, 0.0001); // real scale set per-frame by resizePins
        pin.position.set(Number(h.position?.x) || 0, Number(h.position?.y) || 0, Number(h.position?.z) || 0);
        pin.userData.hotspot = h;
        spriteGroup.add(pin);
      }
      if (pendingRef.current) {
        pendingPin = makePin('#C65A1A', 0.0001);
        pendingPin.material.opacity = 0.85;
        pendingPin.position.set(pendingRef.current.x, pendingRef.current.y, pendingRef.current.z);
        pendingPin.userData.isPending = true;
        spriteGroup.add(pendingPin);
      } else {
        pendingPin = null;
      }
      resizePins();
    };

    glRef.current = { rebuildPins: () => rebuildPins() };

    mesh.initialized.then(() => {
      if (disposed) return;
      mesh.updateMatrixWorld(true);

      // Room bounds from the 2nd–98th percentile of splat positions, not the
      // raw min/max. Real captures always carry stray outlier splats (window
      // bleed, reflections, sky holes) that inflate the raw box — and every
      // derived number (opening distance, zoom limits, wall clamps) inherits
      // the inflation, so the view opens too far out and the camera can
      // wander into the fuzz. Sampled 1-in-8 for speed; falls back to the
      // raw box if the mesh is tiny.
      const xs = [], ys = [], zs = [];
      const v = new THREE.Vector3();
      let sampleIdx = 0;
      mesh.forEachSplat((idx, center) => {
        if ((sampleIdx++ & 7) !== 0) return;
        v.copy(center).applyMatrix4(mesh.matrixWorld);
        xs.push(v.x); ys.push(v.y); zs.push(v.z);
      });
      const q = (arr, p) => arr[Math.max(0, Math.min(arr.length - 1, Math.floor(p * (arr.length - 1))))];
      let bounds;
      let median = null;
      if (xs.length > 500) {
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); zs.sort((a, b) => a - b);
        // Vertical axis trimmed harder (5–95%) than horizontal (2–98%):
        // capture noise skews strongly upward — sky and window bleed above
        // the ceiling — and an inflated Y-top starts the camera in the fuzz.
        bounds = new THREE.Box3(
          new THREE.Vector3(q(xs, 0.02), q(ys, 0.05), q(zs, 0.02)),
          new THREE.Vector3(q(xs, 0.98), q(ys, 0.95), q(zs, 0.98))
        );
        median = new THREE.Vector3(q(xs, 0.5), q(ys, 0.5), q(zs, 0.5));
      } else {
        bounds = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
        median = bounds.getCenter(new THREE.Vector3());
      }
      const maxDim = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 0.001);

      targetBox = shrunkBox(bounds, 0.7);   // orbit target stays well inside the room
      cameraBox = shrunkBox(bounds, 0.92);  // camera can go nearer the walls, never through
      controls.minDistance = maxDim * 0.03;
      controls.maxDistance = maxDim * 0.6;  // coarse zoom-out bound; cameraBox is the hard wall
      camera.near = maxDim * 0.002;
      camera.far = maxDim * 20;
      camera.updateProjectionMatrix();

      // The stored camera_position/camera_target default to metric,
      // origin-centred values — real scans are usually neither. If either
      // lies outside this scan's bounds the stored framing is meaningless:
      // reframe to the room. Anchor on the MEDIAN splat position — unlike
      // any bounding-box centre it sits mid-room-mass regardless of how much
      // exterior fuzz the capture carries — and look horizontally from a
      // touch above it (eye level), never from up in the noise.
      if (!cameraBox.containsPoint(camera.position) || !targetBox.containsPoint(controls.target)) {
        const size = bounds.getSize(new THREE.Vector3());
        const horizontalSpan = Math.max(size.x, size.z, 0.001);
        const dir = camera.position.clone().sub(controls.target);
        dir.y = 0; // horizontal look — a lifted direction opens above the ceiling
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();
        controls.target.copy(median);
        camera.position.copy(median)
          .addScaledVector(dir, horizontalSpan * 0.35)
          .setY(median.y + size.y * 0.08);
      }

      clampView();
      console.log('[vessel-map] room bounds', {
        min: bounds.min.toArray().map((n) => +n.toFixed(2)),
        max: bounds.max.toArray().map((n) => +n.toFixed(2)),
        median: median.toArray().map((n) => +n.toFixed(2)),
        camera: camera.position.toArray().map((n) => +n.toFixed(2)),
        target: controls.target.toArray().map((n) => +n.toFixed(2)),
      });
      rebuildPins();
      emit({ status: 'ready' });
    }).catch((err) => {
      console.error('[vessel-map] splat load failed', err);
      emit({ status: 'error', message: err?.message || 'The scan file could not be loaded.' });
    });

    // ── Pointer interaction: click-select, placement click, pending drag ────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    // Horizontal placement plane. Built from the LIVE orbit target on every
    // ray test — the target is always clamped inside the room, so pins drop
    // at eye-focus height for any scan. (A plane fixed at the stored
    // camera_target height sits arbitrarily close to the camera on scans
    // whose coordinates aren't origin-centred — the pin then lands right in
    // front of the lens and fills the screen.)
    const placePlane = new THREE.Plane();
    const PLANE_UP = new THREE.Vector3(0, 1, 0);
    let downAt = null;
    let draggingPending = false;

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
      if (!draggingPending || !pendingPin) return;
      setPointer(e);
      const hit = planeHit();
      if (!hit) return;
      if (cameraBox) cameraBox.clampPoint(hit, hit); // dragged pins stay inside the room
      pendingPin.position.copy(hit);
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
        const hit = planeHit();
        if (hit) {
          if (cameraBox) cameraBox.clampPoint(hit, hit); // pins stay inside the room too
          callbacksRef.current.onPlacePending?.({ x: hit.x, y: hit.y, z: hit.z });
        }
        return;
      }
      const hits = raycaster.intersectObjects(spriteGroup.children.filter((c) => !c.userData.isPending));
      callbacksRef.current.onSelectHotspot?.(hits.length > 0 ? hits[0].object.userData.hotspot : null);
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth, h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    renderer.setAnimationLoop(() => {
      controls.update();
      resizePins();
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
      controls.removeEventListener('change', clampView);
      controls.dispose();
      for (const child of [...spriteGroup.children]) child.material.dispose();
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

  return (
    <div
      ref={containerRef}
      className={`vm-canvas${placementMode ? ' vm-canvas-placing' : ''}`}
      aria-label="3D vessel scan viewer"
    />
  );
}
