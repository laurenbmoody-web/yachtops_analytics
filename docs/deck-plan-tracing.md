# Deck-plan room tracing (+ AI assist) — scope & phases

_Goal: let crew define a vessel's rooms by tracing them on the uploaded General
Arrangement (GA) drawing — true room outlines (curves, not just points) — with
an AI pass that auto-splits decks, reads room names (OCR), and proposes room
outlines to refine. Competitive parity target: IDEA / PinPoint room setup, done
better (real footprints on a real GA)._

## Why
Today rooms are created in the hierarchy list, then dragged onto the plan as a
single point (`vessel_locations.plan_x/plan_y`). That's a point per room, built
list-first. Tracing gives each room its **true footprint** on the GA, which
unlocks: point-in-polygon (a map pin's room derived from where it sits),
corridor shapes, per-space area/coverage, and a far faster **plan-first** setup.

## Data model
- **`vessel_locations.plan_shape` (jsonb)** — a traced outline for a space,
  normalized 0..1 to its **deck crop** (same coordinate space as `plan_x/plan_y`):
  ```json
  { "closed": true,
    "nodes": [ { "x": 0.12, "y": 0.34 },
               { "x": 0.5, "y": 0.2, "h1": {"x":..,"y":..}, "h2": {"x":..,"y":..} } ] }
  ```
  `h1`/`h2` are optional cubic-Bézier handles per node (incoming / outgoing);
  absent = straight segment. Supports polygons AND smooth curves in one format.
- `plan_x/plan_y` stays as the fallback point + label anchor (centroid of the
  shape when one exists). A room can be a **point**, an **outline**, or both.
- Passages/corridors (no-scan connectors) reuse this + a later `is_passage`
  flag; links stay in `vessel_space_links`.

## Feasibility (tested on a real Benetti B.Now 50M GA, 2 sheets / 4 decks)
- **Auto deck-split**: easy — the sheet labels decks (SUN/UPPER/MAIN/LOWER).
- **Read room names (OCR)**: excellent — ~40 room labels read cleanly.
- **Detect / place rooms**: good — colour-filled cabins aid segmentation.
- **Precise curved outlines**: partial — rendered GA (textures/furniture, no
  crisp walls) → AI proposes rough shapes, human tightens the curves.
- Net: AI does ~70–80% (decks, names, placement, rough outlines); human refines.

## Phases (land each on main)
- **P1a — Foundation (this):** `plan_shape` column + `setSpaceShape` storage +
  this doc. No UI yet.
- **P1b — Tracing editor:** on a framed deck, a "Trace" mode — click to lay
  nodes, close the shape, drag nodes; then Bézier handles for curves. Plus the
  quick **drop-point** mode. Render outlines on the plan (scanned/not-scanned
  fill), label at centroid. Save via `setSpaceShape`. Reuses the existing
  frame/crop + coordinate space.
- **P1c — Plan-first room creation:** create a room by tracing/dropping directly
  on the plan (no pre-built list entry), alongside the current tray-drag flow.
- **P2 — AI assist (edge function):** GA PDF → per-deck images → vision model
  reads names + locates rooms → colour/CV segmentation proposes outlines →
  curve-fit → land proposals in the editor for the crew to refine. Start with
  the sure wins (deck-split + names + rough placement), push outline precision
  as far as segmentation allows.
- **P3 — Downstream:** point-in-polygon room resolution for map pins; per-space
  area/coverage; passage/corridor rendering (named transition) tie-in.

## Build notes
- Editor works in the deck-crop's normalized space so shapes travel with the
  crop (reframing a deck keeps rooms aligned).
- Curve rendering: build an SVG path from nodes (`C` segments where handles
  exist, `L` otherwise); `closed` adds `Z`.
- AI lives in an edge function (never ship model calls client-side); reuse the
  `vessel-scans` bucket + `pdfToPngBlob` rasteriser already in the repo.
