// Hotspot layers — the five buckets a pin can belong to. Pin colour derives
// from the layer (not free choice): inventory navy, defect danger, safety
// terracotta, job_helper/general neutral greys. `color` on scan_hotspots is
// denormalised from here at insert time.
export const LAYERS = [
  { key: 'inventory',  label: 'Inventory',  color: '#1C1B3A' },
  { key: 'defect',     label: 'Defects',    color: '#A32D2D' },
  { key: 'safety',     label: 'Safety',     color: '#C65A1A' },
  { key: 'job_helper', label: 'Job helper', color: '#6B7280' },
  { key: 'general',    label: 'General',    color: '#8B8478' },
];

const BY_KEY = Object.fromEntries(LAYERS.map((l) => [l.key, l]));

export const layerColor = (key) => (BY_KEY[key] || BY_KEY.general).color;
export const layerLabel = (key) => (BY_KEY[key] || BY_KEY.general).label;

// Which layers physically hold stock — i.e. get the "What's inside" panel and
// can be an item's location. Inventory obviously; Safety too (a manifest of
// safety equipment is useful). Defects / Job helper / General are annotations,
// not storage, so they don't.
export const layerHoldsStock = (key) => key === 'inventory' || key === 'safety';
