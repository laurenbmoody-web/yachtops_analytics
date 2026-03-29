// Taxonomy Storage - 4-Level Hierarchy (L1 Operational Domain → L2 Category → L3 Subcategory → L4 Optional)
// ID-BASED RELATIONSHIPS ONLY - Names are display labels only

import { getCurrentUser, PermissionTier } from '../../../utils/authStorage';
import { logAudit, EntityType, AuditAction } from '../../../utils/auditLogger';

const TAXONOMY_L1_KEY = 'cargo_taxonomy_l1';
const TAXONOMY_L2_KEY = 'cargo_taxonomy_l2';
const TAXONOMY_L3_KEY = 'cargo_taxonomy_l3';
const TAXONOMY_L4_KEY = 'cargo_taxonomy_l4';
const PRESET_INITIALIZED_KEY = 'cargo_taxonomy_4level_initialized';
const MIGRATION_COMPLETED_KEY = 'cargo_taxonomy_3to4_migration';

// Add helper functions at top of file after imports
const hasCommandAccess = (user) => {
  const captainRoles = ['Captain', 'Relief Captain', 'Build Captain', 'Fleet Captain', 'Skipper', 'Captain / Engineer'];
  if (captainRoles?.includes(user?.roleTitle)) {
    return true;
  }
  return (
    user?.tier === PermissionTier?.COMMAND ||
    user?.effectiveTier === PermissionTier?.COMMAND ||
    user?.permissionTier === PermissionTier?.COMMAND ||
    user?.effectiveTier?.toUpperCase() === PermissionTier?.COMMAND ||
    user?.permissionTier?.toUpperCase() === PermissionTier?.COMMAND
  );
};

const hasChiefAccess = (user) => {
  return (
    hasCommandAccess(user) ||
    user?.tier === PermissionTier?.CHIEF ||
    user?.effectiveTier === PermissionTier?.CHIEF ||
    user?.permissionTier === PermissionTier?.CHIEF ||
    user?.effectiveTier?.toUpperCase() === PermissionTier?.CHIEF ||
    user?.permissionTier?.toUpperCase() === PermissionTier?.CHIEF
  );
};

// ============================================
// EXACT L1 + L2 PRESETS (LOCKED SPECIFICATION)
// ============================================

const PRESET_TAXONOMY = [
  {
    name: 'Vessel',
    sortOrder: 1,
    subcategoriesL2: [
      'Appliances',
      'Tools & Equipment',
      'Spare Parts',
      'Deck Stores',
      'Engineering Stores',
      'Interior Stores',
      'Navigation & Bridge Equipment',
      'Exterior Furniture & Fixtures',
      'Storage Units & Containers'
    ]
  },
  {
    name: 'Safety & Compliance',
    sortOrder: 2,
    subcategoriesL2: [
      'Medical',
      'LSA',
      'FFA',
      'PPE',
      'Emergency Equipment',
      'Compliance Documentation'
    ]
  },
  {
    name: 'Guest',
    sortOrder: 3,
    subcategoriesL2: [
      'Tableware',
      'Linens',
      'Toiletries',
      'Giveaways',
      'Guest Area Accessories',
      'Beach & Watersports Items',
      'Celebration & Event Items',
      'Kids Items',
      'Seasonal Decor'
    ]
  },
  {
    name: 'Crew',
    sortOrder: 4,
    subcategoriesL2: [
      'Uniforms',
      'Crew Linens',
      'Crew Tableware',
      'Crew Area Accessories',
      'Crew Toiletries',
      'Cabin Supplies',
      'Training Materials'
    ]
  },
  {
    name: 'Food & Beverage',
    sortOrder: 5,
    subcategoriesL2: [
      'Fridge',
      'Freezer',
      'Dry Store',
      'Pantry',
      'Drinks Store',
      'Galley Consumables',
      'Bar Consumables',
      'Bulk Provisioning'
    ]
  }
];

// ============================================
// INITIALIZATION WITH MIGRATION
// ============================================

export const initializePresetTaxonomy = () => {
  const isInitialized = localStorage.getItem(PRESET_INITIALIZED_KEY);
  if (isInitialized) return;

  const taxonomyL1 = [];
  const taxonomyL2 = [];
  const taxonomyL3 = [];

  PRESET_TAXONOMY?.forEach((l1, l1Index) => {
    const l1Id = `l1-${Date.now()}-${l1Index}`;
    taxonomyL1?.push({
      id: l1Id,
      name: l1?.name,
      sortOrder: l1?.sortOrder,
      isArchived: false,
      createdAt: new Date()?.toISOString()
    });

    l1?.subcategoriesL2?.forEach((l2Name, l2Index) => {
      const l2Id = `l2-${Date.now()}-${l1Index}-${l2Index}`;
      taxonomyL2?.push({
        id: l2Id,
        l1Id: l1Id,
        name: l2Name,
        sortOrder: l2Index,
        isArchived: false,
        createdAt: new Date()?.toISOString()
      });

      // Create "General" L3 fallback under every L2
      taxonomyL3?.push({
        id: `l3-${Date.now()}-${l1Index}-${l2Index}-general`,
        l1Id: l1Id,
        l2Id: l2Id,
        name: 'General',
        sortOrder: 0,
        isArchived: false,
        createdAt: new Date()?.toISOString()
      });
    });
  });

  localStorage.setItem(TAXONOMY_L1_KEY, JSON.stringify(taxonomyL1));
  localStorage.setItem(TAXONOMY_L2_KEY, JSON.stringify(taxonomyL2));
  localStorage.setItem(TAXONOMY_L3_KEY, JSON.stringify(taxonomyL3));
  localStorage.setItem(TAXONOMY_L4_KEY, JSON.stringify([]));
  localStorage.setItem(PRESET_INITIALIZED_KEY, 'true');
};

// ============================================
// MIGRATION FROM OLD 3-LEVEL TO NEW 4-LEVEL
// ============================================

export const migrateOldTaxonomyToNew = () => {
  const migrationCompleted = localStorage.getItem(MIGRATION_COMPLETED_KEY);
  if (migrationCompleted) return { migrated: 0, message: 'Migration already completed' };

  // Initialize new taxonomy first
  initializePresetTaxonomy();

  // Get old items
  const oldItemsRaw = localStorage.getItem('cargo_inventory_items');
  if (!oldItemsRaw) {
    localStorage.setItem(MIGRATION_COMPLETED_KEY, 'true');
    return { migrated: 0, message: 'No items to migrate' };
  }

  const oldItems = JSON.parse(oldItemsRaw);
  const newL1 = getAllTaxonomyL1();
  const newL2 = getAllTaxonomyL2();
  const newL3 = getAllTaxonomyL3();

  let migratedCount = 0;

  // Migration mapping: Try to map old categories to new structure
  const oldToNewMapping = {
    'Tableware': { l1: 'Guest', l2: 'Tableware' },
    'Food & Beverage': { l1: 'Food & Beverage', l2: 'Dry Store' },
    'Appliances': { l1: 'Vessel', l2: 'Appliances' },
    'Tools & Equipment': { l1: 'Vessel', l2: 'Tools & Equipment' },
    'Spare Parts': { l1: 'Vessel', l2: 'Spare Parts' },
    'Uniforms': { l1: 'Crew', l2: 'Uniforms' },
    'Crew Bedding & Linen': { l1: 'Crew', l2: 'Crew Linens' },
    'Safety & Compliance': { l1: 'Safety & Compliance', l2: 'Emergency Equipment' },
    'Medical': { l1: 'Safety & Compliance', l2: 'Medical' },
    'Guest Amenities': { l1: 'Guest', l2: 'Guest Area Accessories' }
  };

  const updatedItems = oldItems?.map(item => {
    // If item already has l1Id/l2Id/l3Id (new format), keep it
    if (item?.l1Id && item?.l2Id && item?.l3Id) {
      return item;
    }

    // Try to migrate from old categoryL1Id/categoryL2Id/categoryL3Id
    const oldL1Raw = localStorage.getItem('cargo_inventory_categories_l1');
    const oldL1 = oldL1Raw ? JSON.parse(oldL1Raw) : [];
    const oldL1Category = oldL1?.find(cat => cat?.id === item?.categoryL1Id);

    if (oldL1Category) {
      const mapping = oldToNewMapping?.[oldL1Category?.name];
      if (mapping) {
        const targetL1 = newL1?.find(l => l?.name === mapping?.l1);
        const targetL2 = newL2?.find(l => l?.name === mapping?.l2 && l?.l1Id === targetL1?.id);
        const targetL3 = newL3?.find(l => l?.name === 'General' && l?.l2Id === targetL2?.id);

        if (targetL1 && targetL2 && targetL3) {
          migratedCount++;
          return {
            ...item,
            l1Id: targetL1?.id,
            l2Id: targetL2?.id,
            l3Id: targetL3?.id,
            l4Id: null,
            // Keep old IDs for reference
            _oldCategoryL1Id: item?.categoryL1Id,
            _oldCategoryL2Id: item?.categoryL2Id,
            _oldCategoryL3Id: item?.categoryL3Id
          };
        }
      }
    }

    // Fallback: Assign to Vessel → Spare Parts → General
    const fallbackL1 = newL1?.find(l => l?.name === 'Vessel');
    const fallbackL2 = newL2?.find(l => l?.name === 'Spare Parts' && l?.l1Id === fallbackL1?.id);
    const fallbackL3 = newL3?.find(l => l?.name === 'General' && l?.l2Id === fallbackL2?.id);

    if (fallbackL1 && fallbackL2 && fallbackL3) {
      migratedCount++;
      return {
        ...item,
        l1Id: fallbackL1?.id,
        l2Id: fallbackL2?.id,
        l3Id: fallbackL3?.id,
        l4Id: null,
        _migrationNote: 'Auto-assigned to Vessel > Spare Parts > General'
      };
    }

    return item;
  });

  localStorage.setItem('cargo_inventory_items', JSON.stringify(updatedItems));
  localStorage.setItem(MIGRATION_COMPLETED_KEY, 'true');

  return {
    migrated: migratedCount,
    message: `Migrated ${migratedCount} items to new 4-level taxonomy`
  };
};

// ============================================
// TAXONOMY L1 (OPERATIONAL DOMAIN) - CRUD
// ============================================

export const getAllTaxonomyL1 = () => {
  initializePresetTaxonomy();
  try {
    const data = localStorage.getItem(TAXONOMY_L1_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    return taxonomy?.filter(t => !t?.isArchived)?.sort((a, b) => a?.sortOrder - b?.sortOrder);
  } catch (error) {
    console.error('Error loading taxonomy L1:', error);
    return [];
  }
};

export const getTaxonomyL1ById = (l1Id) => {
  const taxonomy = getAllTaxonomyL1();
  return taxonomy?.find(t => t?.id === l1Id);
};

export const createTaxonomyL1 = (name) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser)) {
    console.error('Only Command can create L1 categories');
    return null;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L1_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const maxSort = Math.max(0, ...taxonomy?.map(t => t?.sortOrder || 0));

    const newL1 = {
      id: `l1-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      name: name,
      sortOrder: maxSort + 1,
      isArchived: false,
      createdAt: new Date()?.toISOString()
    };

    taxonomy?.push(newL1);
    localStorage.setItem(TAXONOMY_L1_KEY, JSON.stringify(taxonomy));
    
    // Log audit event
    logAudit({
      entityType: EntityType?.CATEGORY,
      entityId: newL1?.id,
      entityName: `L1: ${newL1?.name}`,
      action: AuditAction?.CREATED,
      changes: []
    });
    
    return newL1;
  } catch (error) {
    console.error('Error creating taxonomy L1:', error);
    return null;
  }
};

export const renameTaxonomyL1 = (l1Id, newName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser)) {
    console.error('Only Command can rename L1 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L1_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l1Id);

    if (index !== -1) {
      const oldName = taxonomy?.[index]?.name;
      taxonomy[index].name = newName;
      taxonomy[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L1_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      if (oldName !== newName) {
        logAudit({
          entityType: EntityType?.CATEGORY,
          entityId: l1Id,
          entityName: `L1: ${newName}`,
          action: AuditAction?.UPDATED,
          changes: [{ field: 'name', before: oldName, after: newName }]
        });
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error renaming taxonomy L1:', error);
    return false;
  }
};

// ============================================
// TAXONOMY L2 (CATEGORY) - CRUD
// ============================================

export const getAllTaxonomyL2 = () => {
  initializePresetTaxonomy();
  try {
    const data = localStorage.getItem(TAXONOMY_L2_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    return taxonomy?.filter(t => !t?.isArchived)?.sort((a, b) => a?.sortOrder - b?.sortOrder);
  } catch (error) {
    console.error('Error loading taxonomy L2:', error);
    return [];
  }
};

export const getTaxonomyL2ByL1 = (l1Id) => {
  const allL2 = getAllTaxonomyL2();
  return allL2?.filter(t => t?.l1Id === l1Id);
};

export const getTaxonomyL2ById = (l2Id) => {
  const taxonomy = getAllTaxonomyL2();
  return taxonomy?.find(t => t?.id === l2Id);
};

export const createTaxonomyL2 = (l1Id, name) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can create L2 categories');
    return null;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L2_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const l2InSameL1 = taxonomy?.filter(t => t?.l1Id === l1Id);
    const maxSort = Math.max(0, ...l2InSameL1?.map(t => t?.sortOrder || 0));

    const newL2 = {
      id: `l2-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      l1Id: l1Id,
      name: name,
      sortOrder: maxSort + 1,
      isArchived: false,
      createdAt: new Date()?.toISOString()
    };

    taxonomy?.push(newL2);
    localStorage.setItem(TAXONOMY_L2_KEY, JSON.stringify(taxonomy));

    // Auto-create "General" L3 under this new L2
    createTaxonomyL3(l1Id, newL2?.id, 'General');
    
    // Log audit event
    const l1 = getTaxonomyL1ById(l1Id);
    logAudit({
      entityType: EntityType?.CATEGORY,
      entityId: newL2?.id,
      entityName: `L2: ${l1?.name} → ${newL2?.name}`,
      action: AuditAction?.CREATED,
      changes: []
    });

    return newL2;
  } catch (error) {
    console.error('Error creating taxonomy L2:', error);
    return null;
  }
};

export const renameTaxonomyL2 = (l2Id, newName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can rename L2 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L2_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l2Id);

    if (index !== -1) {
      const oldName = taxonomy?.[index]?.name;
      const l1Id = taxonomy?.[index]?.l1Id;
      taxonomy[index].name = newName;
      taxonomy[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L2_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      if (oldName !== newName) {
        const l1 = getTaxonomyL1ById(l1Id);
        logAudit({
          entityType: EntityType?.CATEGORY,
          entityId: l2Id,
          entityName: `L2: ${l1?.name} → ${newName}`,
          action: AuditAction?.UPDATED,
          changes: [{ field: 'name', before: oldName, after: newName }]
        });
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error renaming taxonomy L2:', error);
    return false;
  }
};

export const archiveTaxonomyL2 = (l2Id) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can archive L2 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L2_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l2Id);

    if (index !== -1) {
      const l1Id = taxonomy?.[index]?.l1Id;
      const name = taxonomy?.[index]?.name;
      taxonomy[index].isArchived = true;
      taxonomy[index].archivedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L2_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      const l1 = getTaxonomyL1ById(l1Id);
      logAudit({
        entityType: EntityType?.CATEGORY,
        entityId: l2Id,
        entityName: `L2: ${l1?.name} → ${name}`,
        action: AuditAction?.ARCHIVED,
        changes: []
      });
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error archiving taxonomy L2:', error);
    return false;
  }
};

export const setTaxonomyL2IsAlcohol = (l2Id, isAlcohol) => {
  try {
    const data = localStorage.getItem(TAXONOMY_L2_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l2Id);
    if (index !== -1) {
      taxonomy[index] = { ...taxonomy[index], isAlcohol, updatedAt: new Date()?.toISOString() };
      localStorage.setItem(TAXONOMY_L2_KEY, JSON.stringify(taxonomy));
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error setting isAlcohol on L2:', error);
    return false;
  }
};

// ============================================
// TAXONOMY L3 (SUBCATEGORY) - CRUD
// ============================================

export const getAllTaxonomyL3 = () => {
  initializePresetTaxonomy();
  try {
    const data = localStorage.getItem(TAXONOMY_L3_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    return taxonomy?.filter(t => !t?.isArchived)?.sort((a, b) => a?.sortOrder - b?.sortOrder);
  } catch (error) {
    console.error('Error loading taxonomy L3:', error);
    return [];
  }
};

export const getTaxonomyL3ByL2 = (l2Id) => {
  const allL3 = getAllTaxonomyL3();
  return allL3?.filter(t => t?.l2Id === l2Id);
};

export const getTaxonomyL3ById = (l3Id) => {
  const taxonomy = getAllTaxonomyL3();
  return taxonomy?.find(t => t?.id === l3Id);
};

export const createTaxonomyL3 = (l1Id, l2Id, name) => {
  const currentUser = getCurrentUser();
  const effectiveTier = (currentUser?.effectiveTier || currentUser?.permissionTier || currentUser?.tier || '')?.toUpperCase();
  if (effectiveTier !== PermissionTier?.COMMAND &&
      effectiveTier !== PermissionTier?.CHIEF &&
      effectiveTier !== PermissionTier?.HOD &&
      !hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command, Chief, and HOD can create L3 categories');
    return null;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L3_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const l3InSameL2 = taxonomy?.filter(t => t?.l2Id === l2Id);
    const maxSort = Math.max(0, ...l3InSameL2?.map(t => t?.sortOrder || 0));

    const newL3 = {
      id: `l3-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      l1Id: l1Id,
      l2Id: l2Id,
      name: name,
      sortOrder: maxSort + 1,
      isArchived: false,
      createdAt: new Date()?.toISOString()
    };

    taxonomy?.push(newL3);
    localStorage.setItem(TAXONOMY_L3_KEY, JSON.stringify(taxonomy));
    
    // Log audit event (skip for auto-created "General" to reduce noise)
    if (name !== 'General') {
      const l1 = getTaxonomyL1ById(l1Id);
      const l2 = getTaxonomyL2ById(l2Id);
      logAudit({
        entityType: EntityType?.CATEGORY,
        entityId: newL3?.id,
        entityName: `L3: ${l1?.name} → ${l2?.name} → ${newL3?.name}`,
        action: AuditAction?.CREATED,
        changes: []
      });
    }
    
    return newL3;
  } catch (error) {
    console.error('Error creating taxonomy L3:', error);
    return null;
  }
};

export const renameTaxonomyL3 = (l3Id, newName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can rename L3 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L3_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l3Id);

    if (index !== -1) {
      const oldName = taxonomy?.[index]?.name;
      const l1Id = taxonomy?.[index]?.l1Id;
      const l2Id = taxonomy?.[index]?.l2Id;
      taxonomy[index].name = newName;
      taxonomy[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L3_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      if (oldName !== newName) {
        const l1 = getTaxonomyL1ById(l1Id);
        const l2 = getTaxonomyL2ById(l2Id);
        logAudit({
          entityType: EntityType?.CATEGORY,
          entityId: l3Id,
          entityName: `L3: ${l1?.name} → ${l2?.name} → ${newName}`,
          action: AuditAction?.UPDATED,
          changes: [{ field: 'name', before: oldName, after: newName }]
        });
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error renaming taxonomy L3:', error);
    return false;
  }
};

export const archiveTaxonomyL3 = (l3Id) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can archive L3 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L3_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l3Id);

    if (index !== -1) {
      const l1Id = taxonomy?.[index]?.l1Id;
      const l2Id = taxonomy?.[index]?.l2Id;
      const name = taxonomy?.[index]?.name;
      taxonomy[index].isArchived = true;
      taxonomy[index].archivedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L3_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      const l1 = getTaxonomyL1ById(l1Id);
      const l2 = getTaxonomyL2ById(l2Id);
      logAudit({
        entityType: EntityType?.CATEGORY,
        entityId: l3Id,
        entityName: `L3: ${l1?.name} → ${l2?.name} → ${name}`,
        action: AuditAction?.ARCHIVED,
        changes: []
      });
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error archiving taxonomy L3:', error);
    return false;
  }
};

// ============================================
// TAXONOMY L4 (OPTIONAL) - CRUD
// ============================================

export const getAllTaxonomyL4 = () => {
  initializePresetTaxonomy();
  try {
    const data = localStorage.getItem(TAXONOMY_L4_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    return taxonomy?.filter(t => !t?.isArchived)?.sort((a, b) => a?.sortOrder - b?.sortOrder);
  } catch (error) {
    console.error('Error loading taxonomy L4:', error);
    return [];
  }
};

export const getTaxonomyL4ByL3 = (l3Id) => {
  const allL4 = getAllTaxonomyL4();
  return allL4?.filter(t => t?.l3Id === l3Id);
};

export const getTaxonomyL4ById = (l4Id) => {
  const taxonomy = getAllTaxonomyL4();
  return taxonomy?.find(t => t?.id === l4Id);
};

export const createTaxonomyL4 = (l1Id, l2Id, l3Id, name) => {
  const currentUser = getCurrentUser();
  const effectiveTier = (currentUser?.effectiveTier || currentUser?.permissionTier || currentUser?.tier || '')?.toUpperCase();
  if (effectiveTier !== PermissionTier?.COMMAND &&
      effectiveTier !== PermissionTier?.CHIEF &&
      effectiveTier !== PermissionTier?.HOD &&
      !hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command, Chief, and HOD can create L4 categories');
    return null;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L4_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const l4InSameL3 = taxonomy?.filter(t => t?.l3Id === l3Id);
    const maxSort = Math.max(0, ...l4InSameL3?.map(t => t?.sortOrder || 0));

    const newL4 = {
      id: `l4-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      l1Id: l1Id,
      l2Id: l2Id,
      l3Id: l3Id,
      name: name,
      sortOrder: maxSort + 1,
      isArchived: false,
      createdAt: new Date()?.toISOString()
    };

    taxonomy?.push(newL4);
    localStorage.setItem(TAXONOMY_L4_KEY, JSON.stringify(taxonomy));
    
    // Log audit event
    const l1 = getTaxonomyL1ById(l1Id);
    const l2 = getTaxonomyL2ById(l2Id);
    const l3 = getTaxonomyL3ById(l3Id);
    logAudit({
      entityType: EntityType?.CATEGORY,
      entityId: newL4?.id,
      entityName: `L4: ${l1?.name} → ${l2?.name} → ${l3?.name} → ${newL4?.name}`,
      action: AuditAction?.CREATED,
      changes: []
    });
    
    return newL4;
  } catch (error) {
    console.error('Error creating taxonomy L4:', error);
    return null;
  }
};

export const renameTaxonomyL4 = (l4Id, newName) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can rename L4 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L4_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l4Id);

    if (index !== -1) {
      const oldName = taxonomy?.[index]?.name;
      const l1Id = taxonomy?.[index]?.l1Id;
      const l2Id = taxonomy?.[index]?.l2Id;
      const l3Id = taxonomy?.[index]?.l3Id;
      taxonomy[index].name = newName;
      taxonomy[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L4_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      if (oldName !== newName) {
        const l1 = getTaxonomyL1ById(l1Id);
        const l2 = getTaxonomyL2ById(l2Id);
        const l3 = getTaxonomyL3ById(l3Id);
        logAudit({
          entityType: EntityType?.CATEGORY,
          entityId: l4Id,
          entityName: `L4: ${l1?.name} → ${l2?.name} → ${l3?.name} → ${newName}`,
          action: AuditAction?.UPDATED,
          changes: [{ field: 'name', before: oldName, after: newName }]
        });
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error renaming taxonomy L4:', error);
    return false;
  }
};

export const archiveTaxonomyL4 = (l4Id) => {
  const currentUser = getCurrentUser();
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser)) {
    console.error('Only Command and Chief can archive L4 categories');
    return false;
  }

  try {
    const data = localStorage.getItem(TAXONOMY_L4_KEY);
    const taxonomy = data ? JSON.parse(data) : [];
    const index = taxonomy?.findIndex(t => t?.id === l4Id);

    if (index !== -1) {
      const l1Id = taxonomy?.[index]?.l1Id;
      const l2Id = taxonomy?.[index]?.l2Id;
      const l3Id = taxonomy?.[index]?.l3Id;
      const name = taxonomy?.[index]?.name;
      taxonomy[index].isArchived = true;
      taxonomy[index].archivedAt = new Date()?.toISOString();
      localStorage.setItem(TAXONOMY_L4_KEY, JSON.stringify(taxonomy));
      
      // Log audit event
      const l1 = getTaxonomyL1ById(l1Id);
      const l2 = getTaxonomyL2ById(l2Id);
      const l3 = getTaxonomyL3ById(l3Id);
      logAudit({
        entityType: EntityType?.CATEGORY,
        entityId: l4Id,
        entityName: `L4: ${l1?.name} → ${l2?.name} → ${l3?.name} → ${name}`,
        action: AuditAction?.ARCHIVED,
        changes: []
      });
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error archiving taxonomy L4:', error);
    return false;
  }
};

// ============================================
// ITEM COUNT HELPERS
// ============================================

export const getItemCountForL1 = (l1Id) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    return items?.filter(item => item?.l1Id === l1Id)?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL2 = (l2Id) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    return items?.filter(item => item?.l2Id === l2Id)?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL3 = (l3Id) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    return items?.filter(item => item?.l3Id === l3Id)?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL4 = (l4Id) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    return items?.filter(item => item?.l4Id === l4Id)?.length;
  } catch (error) {
    return 0;
  }
};

// DEPARTMENT-AWARE COUNT HELPERS (for Command scope filtering)
// ============================================

export const getItemCountForL1WithDepartment = (l1Id, departmentScope) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    let filtered = items?.filter(item => item?.l1Id === l1Id);
    
    // Apply department filter if not 'ALL'
    if (departmentScope && departmentScope !== 'ALL') {
      filtered = filtered?.filter(item => item?.usageDepartment?.toUpperCase() === departmentScope);
    }
    
    return filtered?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL2WithDepartment = (l2Id, departmentScope) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    let filtered = items?.filter(item => item?.l2Id === l2Id);
    
    // Apply department filter if not 'ALL'
    if (departmentScope && departmentScope !== 'ALL') {
      filtered = filtered?.filter(item => item?.usageDepartment?.toUpperCase() === departmentScope);
    }
    
    return filtered?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL3WithDepartment = (l3Id, departmentScope) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    let filtered = items?.filter(item => item?.l3Id === l3Id);
    
    // Apply department filter if not 'ALL'
    if (departmentScope && departmentScope !== 'ALL') {
      filtered = filtered?.filter(item => item?.usageDepartment?.toUpperCase() === departmentScope);
    }
    
    return filtered?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForL4WithDepartment = (l4Id, departmentScope) => {
  try {
    const data = localStorage.getItem('cargo_inventory_items');
    const items = data ? JSON.parse(data) : [];
    let filtered = items?.filter(item => item?.l4Id === l4Id);
    
    // Apply department filter if not 'ALL'
    if (departmentScope && departmentScope !== 'ALL') {
      filtered = filtered?.filter(item => item?.usageDepartment?.toUpperCase() === departmentScope);
    }
    
    return filtered?.length;
  } catch (error) {
    return 0;
  }
};

// ============================================
// PERMISSION HELPERS
// ============================================

export const canCreateL1 = () => {
  const currentUser = getCurrentUser();
  return hasCommandAccess(currentUser);
};

export const canCreateL2L3L4 = () => {
  const currentUser = getCurrentUser();
  const effectiveTier = (currentUser?.effectiveTier || currentUser?.permissionTier || currentUser?.tier || '')?.toUpperCase();
  return hasCommandAccess(currentUser) || hasChiefAccess(currentUser) ||
         effectiveTier === PermissionTier?.HOD;
};

export const canRenameL3 = () => {
  const currentUser = getCurrentUser();
  return hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
};

// ============================================
// LEGACY COMPATIBILITY (for old code)
// ============================================

// Map old function names to new ones
export const getAllCategoriesL1 = getAllTaxonomyL1;
export const getCategoryL1ById = getTaxonomyL1ById;
export const getCategoriesL2ByL1 = getTaxonomyL2ByL1;
export const getCategoryL2ById = getTaxonomyL2ById;
export const getCategoriesL3ByL2 = getTaxonomyL3ByL2;
export const getCategoryL3ById = getTaxonomyL3ById;
export const getItemCountForCategoryL1 = getItemCountForL1;
export const getItemCountForCategoryL2 = getItemCountForL2;
export const getItemCountForCategoryL3 = getItemCountForL3;
export const createCategoryL2 = createTaxonomyL2;
export const createCategoryL3 = createTaxonomyL3;
export const canCreateCategories = canCreateL2L3L4;
function migrateGuestCategories(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: migrateGuestCategories is not implemented yet.', args);
  return null;
}

export { migrateGuestCategories };
function createCategoryL1(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: createCategoryL1 is not implemented yet.', args);
  return null;
}

export { createCategoryL1 };
function archiveCategoryL2(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: archiveCategoryL2 is not implemented yet.', args);
  return null;
}

export { archiveCategoryL2 };
function archiveCategoryL3(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: archiveCategoryL3 is not implemented yet.', args);
  return null;
}

export { archiveCategoryL3 };
function renameCategoryL1(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: renameCategoryL1 is not implemented yet.', args);
  return null;
}

export { renameCategoryL1 };
function renameCategoryL2(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: renameCategoryL2 is not implemented yet.', args);
  return null;
}

export { renameCategoryL2 };
function renameCategoryL3(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: renameCategoryL3 is not implemented yet.', args);
  return null;
}

export { renameCategoryL3 };
function getCategoryL4ById(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: getCategoryL4ById is not implemented yet.', args);
  return null;
}

export { getCategoryL4ById };
function getCategoriesL4ByL3(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: getCategoriesL4ByL3 is not implemented yet.', args);
  return null;
}

export { getCategoriesL4ByL3 };