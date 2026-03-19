// Defect Type Taxonomy Storage - Type and Sub-Type Management

import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../../utils/authStorage';

const DEFECT_TYPES_KEY = 'cargo_defect_types_v1';
const DEFECT_SUBTYPES_KEY = 'cargo_defect_subtypes_v1';
const TAXONOMY_INITIALIZED_KEY = 'cargo_defect_taxonomy_initialized';

// Preset Type List (Fixed)
export const PRESET_TYPES = [
  'Mechanical',
  'Plumbing',
  'Electrical',
  'Lighting',
  'Cosmetic / Interior Finish',
  'Safety Equipment',
  'Superstructure / Exterior',
  'HVAC / Refrigeration',
  'AV / IT',
  'Tender / Water Toys',
  'Galley Equipment',
  'Deck Gear / Mooring',
  'Windows / Doors / Seals',
  'Carpentry / Joinery',
  'Upholstery / Soft Furnishings',
  'Flooring / Tiles / Stone',
  'Paint / Varnish / Coatings',
  'Corrosion / Rust',
  'Other'
];

// Preset Sub-Type Lists by Type
export const PRESET_SUBTYPES = {
  'Mechanical': [
    'General',
    'Engine (main)',
    'Generator',
    'Gearbox / Drive',
    'Shaft / Prop',
    'Steering',
    'Stabilizers',
    'Thrusters',
    'Pumps',
    'Hydraulics',
    'Air compressor',
    'Watermaker',
    'Fuel system',
    'Oil system',
    'Exhaust',
    'Belts / pulleys',
    'Bearings',
    'Vibrations / noise',
    'Leak (oil/fuel)',
    'Other'
  ],
  'Plumbing': [
    'General',
    'Leak (fresh)',
    'Leak (grey)',
    'Leak (black)',
    'Leak (seawater)',
    'Leak Unknown',
    'Blockage / slow drain',
    'Toilet',
    'Shower',
    'Tap / mixer',
    'Pipe / fitting',
    'Seal / gasket',
    'Water pressure',
    'Hot water',
    'Bilge / sump',
    'Pumps (fresh/grey/black)',
    'Watermaker output',
    'Tank level sensor',
    'Odour issue',
    'Other'
  ],
  'Electrical': [
    'General',
    'Breaker / fuse',
    'Short / trip',
    'Battery / charger',
    'Shore power',
    'Inverter',
    'Generator electrical',
    'Switchboard / panel',
    'Socket / outlet',
    'Cable / connector',
    'Ground fault',
    'Sensor / relay',
    'Power fluctuation',
    'Control module',
    'Other'
  ],
  'Lighting': [
    'General',
    'Bulb / lamp out',
    'LED strip',
    'Switch / dimmer',
    'Driver / transformer',
    'Fixture / fitting',
    'Emergency lighting',
    'Exterior nav / deck lights',
    'Mood lighting scenes',
    'Flickering',
    'Loose connection',
    'Water ingress',
    'Other'
  ],
  'Cosmetic / Interior Finish': [
    'General',
    'Scratches',
    'Chips / dents',
    'Stains',
    'Water marks',
    'Cracks',
    'Loose trim',
    'Loose hardware',
    'Sealant / caulk',
    'Mirror / glass mark',
    'Wallpaper / panel damage',
    'Ceiling mark',
    'Join line / gap',
    'Other'
  ],
  'Safety Equipment': [
    'General',
    'Fire extinguisher',
    'Fire alarm / detector',
    'Smoke detector',
    'CO detector',
    'Emergency signage',
    'Escape lighting',
    'Lifejacket',
    'Liferaft',
    'EPIRB / PLB',
    'First aid / medical kit',
    'AED',
    'SCBA / breathing apparatus',
    'Fire hose / hydrant',
    'Sprinkler / mist',
    'Watertight door alarm',
    'Safety rails / guards',
    'Other'
  ],
  'Superstructure / Exterior': [
    'General',
    'Gelcoat damage',
    'Paint damage',
    'Teak / decking',
    'Sealant / caulk',
    'Railings',
    'Ladders / steps',
    'Hatches',
    'Water ingress',
    'Exterior furniture',
    'Loose fittings',
    'Corrosion / rust',
    'Windshield / hardtop',
    'Other'
  ],
  'HVAC / Refrigeration': [
    'General',
    'AC not cooling',
    'AC not heating',
    'Fan / blower',
    'Thermostat',
    'Duct / vent',
    'Condensation / drip',
    'Odour',
    'Noise',
    'Chiller',
    'Refrigerant leak',
    'Fridge',
    'Freezer',
    'Ice machine',
    'Wine fridge',
    'Other'
  ],
  'AV / IT': [
    'General',
    'Wi-Fi / access point',
    'Network switch',
    'TV / display',
    'Audio system',
    'Remote / control',
    'Apple TV / media box',
    'Satellite / antenna',
    'Cameras / CCTV',
    'Intercom',
    'Phone / VoIP',
    'Printer',
    'App / software glitch',
    'Other'
  ],
  'Tender / Water Toys': [
    'General',
    'Tender engine',
    'Fuel system',
    'Battery / electrics',
    'Steering / controls',
    'Tubes / inflatables',
    'Jet ski',
    'Seabob',
    'Paddleboard / kayak',
    'Dive gear',
    'Towables',
    'Trailer / davit interface',
    'Other'
  ],
  'Galley Equipment': [
    'General',
    'Oven',
    'Hob / cooktop',
    'Extractor / hood',
    'Dishwasher',
    'Fridge / freezer',
    'Ice machine',
    'Coffee machine',
    'Mixer / blender',
    'Small appliance',
    'Gas system',
    'Water filter',
    'Other'
  ],
  'Deck Gear / Mooring': [
    'General',
    'Winch',
    'Windlass',
    'Capstan',
    'Anchor chain',
    'Shackles / pins',
    'Lines / ropes',
    'Fenders',
    'Cranes / davits',
    'Passerelle',
    'Platforms',
    'Boarding ladder',
    'Other'
  ],
  'Windows / Doors / Seals': [
    'General',
    'Door alignment',
    'Door lock',
    'Door closer',
    'Sliding door track',
    'Window seal',
    'Hatch seal',
    'Leak / water ingress',
    'Rattle / vibration',
    'Handle / hardware',
    'Other'
  ],
  'Carpentry / Joinery': [
    'General',
    'Hinge',
    'Drawer runner',
    'Latch / catch',
    'Door / panel misalignment',
    'Loose cabinetry',
    'Veneer damage',
    'Warping',
    'Glue failure',
    'Other'
  ],
  'Upholstery / Soft Furnishings': [
    'General',
    'Tear',
    'Stain',
    'Loose seam',
    'Cushion foam',
    'Outdoor fabric',
    'Curtains / blinds',
    'Headboard / wall upholstery',
    'Other'
  ],
  'Flooring / Tiles / Stone': [
    'General',
    'Tile crack',
    'Grout damage',
    'Loose tile',
    'Stone chip',
    'Carpet stain',
    'Carpet tear',
    'Wood floor scratch',
    'Lifted edge',
    'Other'
  ],
  'Paint / Varnish / Coatings': [
    'General',
    'Varnish scratch',
    'Paint chip',
    'Blistering',
    'Peeling',
    'Fading',
    'Touch-up needed',
    'Other'
  ],
  'Corrosion / Rust': [
    'General',
    'Surface rust',
    'Pitting',
    'Corroded fastener',
    'Stainless tea staining',
    'Aluminium corrosion',
    'Paint breakdown causing corrosion',
    'Other'
  ],
  'Other': [
    'General'
  ]
};

/**
 * Initialize preset taxonomy if not already done
 */
const initializePresets = () => {
  const initialized = localStorage.getItem(TAXONOMY_INITIALIZED_KEY);
  if (initialized) return;
  
  // Initialize types
  const types = PRESET_TYPES?.map((type, index) => ({
    id: crypto.randomUUID(),
    name: type,
    isCustom: false,
    sortOrder: index,
    createdAt: new Date()?.toISOString()
  }));
  
  localStorage.setItem(DEFECT_TYPES_KEY, JSON.stringify(types));
  
  // Initialize subtypes
  const subtypes = [];
  types?.forEach(type => {
    const presetSubs = PRESET_SUBTYPES?.[type?.name] || ['General'];
    presetSubs?.forEach((subName, index) => {
      subtypes?.push({
        id: crypto.randomUUID(),
        name: subName,
        typeId: type?.id,
        typeName: type?.name,
        isCustom: false,
        sortOrder: index,
        createdAt: new Date()?.toISOString()
      });
    });
  });
  
  localStorage.setItem(DEFECT_SUBTYPES_KEY, JSON.stringify(subtypes));
  localStorage.setItem(TAXONOMY_INITIALIZED_KEY, 'true');
};

/**
 * Load all types
 * @returns {Array} Array of type objects
 */
export const loadAllTypes = () => {
  initializePresets();
  try {
    const stored = localStorage.getItem(DEFECT_TYPES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading defect types:', error);
    return [];
  }
};

/**
 * Load all subtypes
 * @returns {Array} Array of subtype objects
 */
export const loadAllSubtypes = () => {
  initializePresets();
  try {
    const stored = localStorage.getItem(DEFECT_SUBTYPES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading defect subtypes:', error);
    return [];
  }
};

/**
 * Get subtypes for a specific type
 * @param {string} typeName - Type name
 * @returns {Array} Array of subtype objects
 */
export const getSubtypesForType = (typeName) => {
  const allSubtypes = loadAllSubtypes();
  return allSubtypes?.filter(sub => sub?.typeName === typeName);
};

/**
 * Add custom type (Command/Chief only)
 * @param {string} typeName - New type name
 * @returns {Object|null} New type object or null if not allowed
 */
export const addCustomType = (typeName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    return null;
  }
  
  const types = loadAllTypes();
  
  // Check if already exists (case-insensitive)
  const exists = types?.some(t => t?.name?.toLowerCase() === typeName?.toLowerCase());
  if (exists) {
    return null;
  }
  
  const newType = {
    id: crypto.randomUUID(),
    name: typeName?.trim(),
    isCustom: true,
    sortOrder: types?.length,
    createdAt: new Date()?.toISOString(),
    createdBy: currentUser?.fullName || currentUser?.name
  };
  
  types?.push(newType);
  localStorage.setItem(DEFECT_TYPES_KEY, JSON.stringify(types));
  
  // Add default subtypes for new custom type
  const subtypes = loadAllSubtypes();
  subtypes?.push({
    id: crypto.randomUUID(),
    name: 'General',
    typeId: newType?.id,
    typeName: newType?.name,
    isCustom: false,
    sortOrder: 0,
    createdAt: new Date()?.toISOString()
  });
  subtypes?.push({
    id: crypto.randomUUID(),
    name: 'Other',
    typeId: newType?.id,
    typeName: newType?.name,
    isCustom: false,
    sortOrder: 1,
    createdAt: new Date()?.toISOString()
  });
  localStorage.setItem(DEFECT_SUBTYPES_KEY, JSON.stringify(subtypes));
  
  return newType;
};

/**
 * Add custom subtype (Command/Chief only)
 * @param {string} typeName - Parent type name
 * @param {string} subtypeName - New subtype name
 * @returns {Object|null} New subtype object or null if not allowed
 */
export const addCustomSubtype = (typeName, subtypeName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    return null;
  }
  
  const types = loadAllTypes();
  const type = types?.find(t => t?.name === typeName);
  if (!type) return null;
  
  const subtypes = loadAllSubtypes();
  
  // Check if already exists for this type (case-insensitive)
  const exists = subtypes?.some(
    sub => sub?.typeName === typeName && sub?.name?.toLowerCase() === subtypeName?.toLowerCase()
  );
  if (exists) {
    return null;
  }
  
  const newSubtype = {
    id: crypto.randomUUID(),
    name: subtypeName?.trim(),
    typeId: type?.id,
    typeName: type?.name,
    isCustom: true,
    sortOrder: subtypes?.filter(s => s?.typeName === typeName)?.length,
    createdAt: new Date()?.toISOString(),
    createdBy: currentUser?.fullName || currentUser?.name
  };
  
  subtypes?.push(newSubtype);
  localStorage.setItem(DEFECT_SUBTYPES_KEY, JSON.stringify(subtypes));
  
  return newSubtype;
};

/**
 * Check if user can add custom types/subtypes
 * @param {Object} user - User object
 * @returns {boolean}
 */
export const canAddCustom = (user = null) => {
  const currentUser = user || getCurrentUser();
  return hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
};
