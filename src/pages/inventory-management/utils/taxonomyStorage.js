// Taxonomy Storage Utility - 3-Level Hierarchy
// Level 1: Category (required)
// Level 2: SubcategoryL2 (required)
// Level 3: SubcategoryL3 (optional)

import { getCurrentUser } from '../../../utils/authStorage';
import { enforceDepartmentScopeForInventory } from '../../../utils/departmentScopeEnforcement';
import { getDepartmentScope } from '../../../utils/departmentScopeStorage';

const CATEGORIES_KEY = 'cargo_taxonomy_categories';
const SUBCATEGORIES_L2_KEY = 'cargo_taxonomy_subcategories_l2';
const SUBCATEGORIES_L3_KEY = 'cargo_taxonomy_subcategories_l3';
const PRESET_INITIALIZED_KEY = 'cargo_taxonomy_preset_initialized';

// ============================================
// CATEGORY (Level 1) CRUD
// ============================================

export const getAllCategories = () => {
  try {
    const data = localStorage.getItem(CATEGORIES_KEY);
    const categories = data ? JSON.parse(data) : [];
    return categories?.filter(cat => !cat?.isArchived);
  } catch (error) {
    console.error('Error loading categories:', error);
    return [];
  }
};

export const getCategoryById = (categoryId) => {
  const categories = getAllCategories();
  return categories?.find(cat => cat?.id === categoryId);
};

export const saveCategory = (categoryData) => {
  try {
    const categories = getAllCategories();
    const timestamp = new Date()?.toISOString();
    
    if (categoryData?.id) {
      // Update existing
      const index = categories?.findIndex(cat => cat?.id === categoryData?.id);
      if (index !== -1) {
        categories[index] = { ...categoryData, updatedAt: timestamp };
      }
    } else {
      // Create new
      const newCategory = {
        id: `cat-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        name: categoryData?.name,
        icon: categoryData?.icon || 'Package',
        sortOrder: categoryData?.sortOrder || categories?.length,
        department: categoryData?.department || 'INTERIOR',
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      categories?.push(newCategory);
    }
    
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    return true;
  } catch (error) {
    console.error('Error saving category:', error);
    return false;
  }
};

export const deleteCategory = (categoryId) => {
  try {
    const categories = getAllCategories();
    const index = categories?.findIndex(cat => cat?.id === categoryId);
    if (index !== -1) {
      categories[index].isArchived = true;
      categories[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    }
    return true;
  } catch (error) {
    console.error('Error deleting category:', error);
    return false;
  }
};

// ============================================
// SUBCATEGORY L2 CRUD
// ============================================

export const getAllSubcategoriesL2 = () => {
  try {
    const data = localStorage.getItem(SUBCATEGORIES_L2_KEY);
    const subcategories = data ? JSON.parse(data) : [];
    return subcategories?.filter(sub => !sub?.isArchived);
  } catch (error) {
    console.error('Error loading subcategories L2:', error);
    return [];
  }
};

export const getSubcategoriesL2ByCategory = (categoryId) => {
  const allL2 = getAllSubcategoriesL2();
  return allL2?.filter(sub => sub?.categoryId === categoryId);
};

export const getSubcategoryL2ById = (subcategoryL2Id) => {
  const subcategories = getAllSubcategoriesL2();
  return subcategories?.find(sub => sub?.id === subcategoryL2Id);
};

export const saveSubcategoryL2 = (subcategoryData) => {
  try {
    const subcategories = getAllSubcategoriesL2();
    const timestamp = new Date()?.toISOString();
    
    if (subcategoryData?.id) {
      // Update existing
      const index = subcategories?.findIndex(sub => sub?.id === subcategoryData?.id);
      if (index !== -1) {
        subcategories[index] = { ...subcategoryData, updatedAt: timestamp };
      }
    } else {
      // Create new
      const newSubcategory = {
        id: `subl2-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        categoryId: subcategoryData?.categoryId,
        name: subcategoryData?.name,
        sortOrder: subcategoryData?.sortOrder || subcategories?.filter(s => s?.categoryId === subcategoryData?.categoryId)?.length,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      subcategories?.push(newSubcategory);
      localStorage.setItem(SUBCATEGORIES_L2_KEY, JSON.stringify(subcategories));
      return newSubcategory;
    }
    
    localStorage.setItem(SUBCATEGORIES_L2_KEY, JSON.stringify(subcategories));
    return subcategoryData;
  } catch (error) {
    console.error('Error saving subcategory L2:', error);
    return null;
  }
};

export const deleteSubcategoryL2 = (subcategoryL2Id) => {
  try {
    const subcategories = getAllSubcategoriesL2();
    const index = subcategories?.findIndex(sub => sub?.id === subcategoryL2Id);
    if (index !== -1) {
      subcategories[index].isArchived = true;
      subcategories[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(SUBCATEGORIES_L2_KEY, JSON.stringify(subcategories));
    }
    return true;
  } catch (error) {
    console.error('Error deleting subcategory L2:', error);
    return false;
  }
};

// ============================================
// SUBCATEGORY L3 CRUD
// ============================================

export const getAllSubcategoriesL3 = () => {
  try {
    const data = localStorage.getItem(SUBCATEGORIES_L3_KEY);
    const subcategories = data ? JSON.parse(data) : [];
    return subcategories?.filter(sub => !sub?.isArchived);
  } catch (error) {
    console.error('Error loading subcategories L3:', error);
    return [];
  }
};

export const getSubcategoriesL3ByL2 = (subcategoryL2Id) => {
  const allL3 = getAllSubcategoriesL3();
  return allL3?.filter(sub => sub?.subcategoryL2Id === subcategoryL2Id);
};

export const getSubcategoryL3ById = (subcategoryL3Id) => {
  const subcategories = getAllSubcategoriesL3();
  return subcategories?.find(sub => sub?.id === subcategoryL3Id);
};

export const saveSubcategoryL3 = (subcategoryData) => {
  try {
    const subcategories = getAllSubcategoriesL3();
    const timestamp = new Date()?.toISOString();
    
    if (subcategoryData?.id) {
      // Update existing
      const index = subcategories?.findIndex(sub => sub?.id === subcategoryData?.id);
      if (index !== -1) {
        subcategories[index] = { ...subcategoryData, updatedAt: timestamp };
      }
    } else {
      // Create new
      const newSubcategory = {
        id: `subl3-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        categoryId: subcategoryData?.categoryId,
        subcategoryL2Id: subcategoryData?.subcategoryL2Id,
        name: subcategoryData?.name,
        sortOrder: subcategoryData?.sortOrder || subcategories?.filter(s => s?.subcategoryL2Id === subcategoryData?.subcategoryL2Id)?.length,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      subcategories?.push(newSubcategory);
      localStorage.setItem(SUBCATEGORIES_L3_KEY, JSON.stringify(subcategories));
      return newSubcategory;
    }
    
    localStorage.setItem(SUBCATEGORIES_L3_KEY, JSON.stringify(subcategories));
    return subcategoryData;
  } catch (error) {
    console.error('Error saving subcategory L3:', error);
    return null;
  }
};

export const deleteSubcategoryL3 = (subcategoryL3Id) => {
  try {
    const subcategories = getAllSubcategoriesL3();
    const index = subcategories?.findIndex(sub => sub?.id === subcategoryL3Id);
    if (index !== -1) {
      subcategories[index].isArchived = true;
      subcategories[index].updatedAt = new Date()?.toISOString();
      localStorage.setItem(SUBCATEGORIES_L3_KEY, JSON.stringify(subcategories));
    }
    return true;
  } catch (error) {
    console.error('Error deleting subcategory L3:', error);
    return false;
  }
};

// ============================================
// ITEM COUNT HELPERS
// ============================================

export const getItemCountForCategory = (categoryId) => {
  try {
    const itemsData = localStorage.getItem('cargo_inventory_items');
    const items = itemsData ? JSON.parse(itemsData) : [];
    return items?.filter(item => item?.categoryId === categoryId)?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForSubcategoryL2 = (categoryId, subcategoryL2Id) => {
  try {
    const itemsData = localStorage.getItem('cargo_inventory_items');
    const items = itemsData ? JSON.parse(itemsData) : [];
    return items?.filter(item => 
      item?.categoryId === categoryId && 
      item?.subcategoryL2Id === subcategoryL2Id
    )?.length;
  } catch (error) {
    return 0;
  }
};

export const getItemCountForSubcategoryL3 = (categoryId, subcategoryL2Id, subcategoryL3Id) => {
  try {
    const itemsData = localStorage.getItem('cargo_inventory_items');
    const items = itemsData ? JSON.parse(itemsData) : [];
    return items?.filter(item => 
      item?.categoryId === categoryId && 
      item?.subcategoryL2Id === subcategoryL2Id &&
      item?.subcategoryL3Id === subcategoryL3Id
    )?.length;
  } catch (error) {
    return 0;
  }
};

// ============================================
// PRESET TAXONOMY CREATION
// ============================================

export const createPresetTaxonomy = () => {
  try {
    // Check if already initialized
    const initialized = localStorage.getItem(PRESET_INITIALIZED_KEY);
    if (initialized === 'true') {
      console.log('Preset taxonomy already initialized');
      return false;
    }

    const timestamp = new Date()?.toISOString();
    const allCategories = [];
    const allL2Subs = [];
    const allL3Subs = [];
    
    // ============================================
    // 1. TABLEWARE
    // ============================================
    const tablewareId = 'cat-tableware-preset';
    allCategories?.push({
      id: tablewareId,
      name: 'Tableware',
      icon: 'Utensils',
      sortOrder: 0,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    // Guest
    const guestId = 'subl2-tableware-guest';
    allL2Subs?.push({ id: guestId, categoryId: tablewareId, name: 'Guest', sortOrder: 0 });
    allL3Subs?.push(
      { id: 'subl3-tableware-guest-holloware', categoryId: tablewareId, subcategoryL2Id: guestId, name: 'Holloware', sortOrder: 0 },
      { id: 'subl3-tableware-guest-flatware', categoryId: tablewareId, subcategoryL2Id: guestId, name: 'Flatware', sortOrder: 1 },
      { id: 'subl3-tableware-guest-crockery', categoryId: tablewareId, subcategoryL2Id: guestId, name: 'Crockery', sortOrder: 2 },
      { id: 'subl3-tableware-guest-tablelinen', categoryId: tablewareId, subcategoryL2Id: guestId, name: 'Table Linen', sortOrder: 3 },
      { id: 'subl3-tableware-guest-tabledecorations', categoryId: tablewareId, subcategoryL2Id: guestId, name: 'Table Decorations', sortOrder: 4 }
    );
    
    // Crew
    const crewId = 'subl2-tableware-crew';
    allL2Subs?.push({ id: crewId, categoryId: tablewareId, name: 'Crew', sortOrder: 1 });
    allL3Subs?.push(
      { id: 'subl3-tableware-crew-holloware', categoryId: tablewareId, subcategoryL2Id: crewId, name: 'Holloware', sortOrder: 0 },
      { id: 'subl3-tableware-crew-flatware', categoryId: tablewareId, subcategoryL2Id: crewId, name: 'Flatware', sortOrder: 1 },
      { id: 'subl3-tableware-crew-crockery', categoryId: tablewareId, subcategoryL2Id: crewId, name: 'Crockery', sortOrder: 2 },
      { id: 'subl3-tableware-crew-tablelinen', categoryId: tablewareId, subcategoryL2Id: crewId, name: 'Table Linen', sortOrder: 3 }
    );
    
    // ============================================
    // 2. FOOD & BEVERAGE
    // ============================================
    const foodBevId = 'cat-foodbeverage-preset';
    allCategories?.push({
      id: foodBevId,
      name: 'Food & Beverage',
      icon: 'Coffee',
      sortOrder: 1,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-foodbev-fridge', categoryId: foodBevId, name: 'Fridge', sortOrder: 0 },
      { id: 'subl2-foodbev-freezer', categoryId: foodBevId, name: 'Freezer', sortOrder: 1 },
      { id: 'subl2-foodbev-drystore', categoryId: foodBevId, name: 'Dry Store', sortOrder: 2 },
      { id: 'subl2-foodbev-pantry', categoryId: foodBevId, name: 'Pantry', sortOrder: 3 },
      { id: 'subl2-foodbev-crewmess', categoryId: foodBevId, name: 'Crew Mess', sortOrder: 4 }
    );
    
    // Drinks Store with L3
    const drinksStoreId = 'subl2-foodbev-drinksstore';
    allL2Subs?.push({ id: drinksStoreId, categoryId: foodBevId, name: 'Drinks Store', sortOrder: 5 });
    allL3Subs?.push(
      { id: 'subl3-foodbev-drinks-alcohol', categoryId: foodBevId, subcategoryL2Id: drinksStoreId, name: 'Alcohol', sortOrder: 0 },
      { id: 'subl3-foodbev-drinks-softdrinks', categoryId: foodBevId, subcategoryL2Id: drinksStoreId, name: 'Soft Drinks', sortOrder: 1 },
      { id: 'subl3-foodbev-drinks-water', categoryId: foodBevId, subcategoryL2Id: drinksStoreId, name: 'Water', sortOrder: 2 }
    );
    
    // ============================================
    // 3. APPLIANCES
    // ============================================
    const appliancesId = 'cat-appliances-preset';
    allCategories?.push({
      id: appliancesId,
      name: 'Appliances',
      icon: 'Microwave',
      sortOrder: 2,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-appliances-interior', categoryId: appliancesId, name: 'Interior', sortOrder: 0 },
      { id: 'subl2-appliances-galley', categoryId: appliancesId, name: 'Galley', sortOrder: 1 },
      { id: 'subl2-appliances-deckexterior', categoryId: appliancesId, name: 'Deck / Exterior', sortOrder: 2 },
      { id: 'subl2-appliances-laundry', categoryId: appliancesId, name: 'Laundry', sortOrder: 3 },
      { id: 'subl2-appliances-avelectronics', categoryId: appliancesId, name: 'AV / Electronics', sortOrder: 4 }
    );
    
    // ============================================
    // 4. TOOLS & EQUIPMENT
    // ============================================
    const toolsEquipId = 'cat-toolsequipment-preset';
    allCategories?.push({
      id: toolsEquipId,
      name: 'Tools & Equipment',
      icon: 'Wrench',
      sortOrder: 3,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-tools-handtools', categoryId: toolsEquipId, name: 'Hand Tools', sortOrder: 0 },
      { id: 'subl2-tools-powertools', categoryId: toolsEquipId, name: 'Power Tools', sortOrder: 1 },
      { id: 'subl2-tools-cleaningequipment', categoryId: toolsEquipId, name: 'Cleaning Equipment', sortOrder: 2 },
      { id: 'subl2-tools-measuringtools', categoryId: toolsEquipId, name: 'Measuring Tools', sortOrder: 3 },
      { id: 'subl2-tools-general', categoryId: toolsEquipId, name: 'General', sortOrder: 4 }
    );
    
    // ============================================
    // 5. SPARE PARTS
    // ============================================
    const sparePartsId = 'cat-spareparts-preset';
    allCategories?.push({
      id: sparePartsId,
      name: 'Spare Parts',
      icon: 'Cog',
      sortOrder: 4,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-spare-engine', categoryId: sparePartsId, name: 'Engine', sortOrder: 0 },
      { id: 'subl2-spare-electrical', categoryId: sparePartsId, name: 'Electrical', sortOrder: 1 },
      { id: 'subl2-spare-plumbing', categoryId: sparePartsId, name: 'Plumbing', sortOrder: 2 },
      { id: 'subl2-spare-hvac', categoryId: sparePartsId, name: 'HVAC', sortOrder: 3 },
      { id: 'subl2-spare-pumpsfilters', categoryId: sparePartsId, name: 'Pumps & Filters', sortOrder: 4 },
      { id: 'subl2-spare-general', categoryId: sparePartsId, name: 'General', sortOrder: 5 }
    );
    
    // ============================================
    // 6. UNIFORMS
    // ============================================
    const uniformsId = 'cat-uniforms-preset';
    allCategories?.push({
      id: uniformsId,
      name: 'Uniforms',
      icon: 'Shirt',
      sortOrder: 5,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    // Uniforms with L3 presets
    const uniformDepts = [
      { id: 'subl2-uniforms-interior', name: 'Interior', sortOrder: 0 },
      { id: 'subl2-uniforms-deck', name: 'Deck', sortOrder: 1 },
      { id: 'subl2-uniforms-engineering', name: 'Engineering', sortOrder: 2 },
      { id: 'subl2-uniforms-galley', name: 'Galley', sortOrder: 3 }
    ];
    
    uniformDepts?.forEach(dept => {
      allL2Subs?.push({ id: dept?.id, categoryId: uniformsId, name: dept?.name, sortOrder: dept?.sortOrder });
      allL3Subs?.push(
        { id: `${dept?.id}-daily`, categoryId: uniformsId, subcategoryL2Id: dept?.id, name: 'Daily', sortOrder: 0 },
        { id: `${dept?.id}-formal`, categoryId: uniformsId, subcategoryL2Id: dept?.id, name: 'Formal', sortOrder: 1 },
        { id: `${dept?.id}-outerwear`, categoryId: uniformsId, subcategoryL2Id: dept?.id, name: 'Outerwear', sortOrder: 2 },
        { id: `${dept?.id}-footwear`, categoryId: uniformsId, subcategoryL2Id: dept?.id, name: 'Footwear', sortOrder: 3 }
      );
    });
    
    // ============================================
    // 7. CREW BEDDING & LINEN
    // ============================================
    const crewBeddingId = 'cat-crewbeddinglinen-preset';
    allCategories?.push({
      id: crewBeddingId,
      name: 'Crew Bedding & Linen',
      icon: 'Bed',
      sortOrder: 6,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-crewbedding-sheets', categoryId: crewBeddingId, name: 'Sheets', sortOrder: 0 },
      { id: 'subl2-crewbedding-duvets', categoryId: crewBeddingId, name: 'Duvets', sortOrder: 1 },
      { id: 'subl2-crewbedding-towels', categoryId: crewBeddingId, name: 'Towels', sortOrder: 2 },
      { id: 'subl2-crewbedding-mattressprotectors', categoryId: crewBeddingId, name: 'Mattress Protectors', sortOrder: 3 },
      { id: 'subl2-crewbedding-pillowscovers', categoryId: crewBeddingId, name: 'Pillows & Covers', sortOrder: 4 }
    );
    
    // ============================================
    // 8. SAFETY & COMPLIANCE
    // ============================================
    const safetyComplianceId = 'cat-safetycompliance-preset';
    allCategories?.push({
      id: safetyComplianceId,
      name: 'Safety & Compliance',
      icon: 'Shield',
      sortOrder: 7,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-safety-firesafety', categoryId: safetyComplianceId, name: 'Fire Safety', sortOrder: 0 },
      { id: 'subl2-safety-lifesaving', categoryId: safetyComplianceId, name: 'Life-Saving Appliances', sortOrder: 1 },
      { id: 'subl2-safety-ppe', categoryId: safetyComplianceId, name: 'PPE', sortOrder: 2 },
      { id: 'subl2-safety-signagedocs', categoryId: safetyComplianceId, name: 'Signage & Documentation', sortOrder: 3 }
    );
    
    // ============================================
    // 9. MEDICAL
    // ============================================
    const medicalId = 'cat-medical-preset';
    allCategories?.push({
      id: medicalId,
      name: 'Medical',
      icon: 'Heart',
      sortOrder: 8,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-medical-firstaid', categoryId: medicalId, name: 'First Aid', sortOrder: 0 },
      { id: 'subl2-medical-medications', categoryId: medicalId, name: 'Medications', sortOrder: 1 },
      { id: 'subl2-medical-equipment', categoryId: medicalId, name: 'Medical Equipment', sortOrder: 2 },
      { id: 'subl2-medical-ppehygiene', categoryId: medicalId, name: 'PPE / Hygiene', sortOrder: 3 }
    );
    
    // ============================================
    // 10. GUEST AMENITIES
    // ============================================
    const guestAmenitiesId = 'cat-guestamenities-preset';
    allCategories?.push({
      id: guestAmenitiesId,
      name: 'Guest Amenities',
      icon: 'Gift',
      sortOrder: 9,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    
    allL2Subs?.push(
      { id: 'subl2-guestamenities-toiletries', categoryId: guestAmenitiesId, name: 'Toiletries', sortOrder: 0 },
      { id: 'subl2-guestamenities-slippersrobes', categoryId: guestAmenitiesId, name: 'Slippers & Robes', sortOrder: 1 },
      { id: 'subl2-guestamenities-beachitems', categoryId: guestAmenitiesId, name: 'Beach Items', sortOrder: 2 },
      { id: 'subl2-guestamenities-cabinaccessories', categoryId: guestAmenitiesId, name: 'Cabin Accessories', sortOrder: 3 },
      { id: 'subl2-guestamenities-guestgiveaways', categoryId: guestAmenitiesId, name: 'Guest Giveaways', sortOrder: 4 },
      { id: 'subl2-guestamenities-decoraccessories', categoryId: guestAmenitiesId, name: 'Decor & Accessories', sortOrder: 5 }
    );

    // Guest Giveaways L3 subcategories (now under Guest Amenities)
    allL3Subs?.push(
      { id: 'subl3-guestgiveaways-brandedgifts', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-guestgiveaways', name: 'Branded Gifts', sortOrder: 0 },
      { id: 'subl3-guestgiveaways-childrenspacks', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-guestgiveaways', name: "Children's Packs", sortOrder: 1 },
      { id: 'subl3-guestgiveaways-eventgifts', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-guestgiveaways', name: 'Event Gifts', sortOrder: 2 }
    );

    // Decor & Accessories L3 subcategories (now under Guest Amenities)
    allL3Subs?.push(
      { id: 'subl3-decor-decorativeitems', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-decoraccessories', name: 'Decorative Items', sortOrder: 0 },
      { id: 'subl3-decor-flowersvases', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-decoraccessories', name: 'Flowers & Vases', sortOrder: 1 },
      { id: 'subl3-decor-cushionsthrows', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-decoraccessories', name: 'Cushions & Throws', sortOrder: 2 },
      { id: 'subl3-decor-seasonaldecor', categoryId: guestAmenitiesId, subcategoryL2Id: 'subl2-guestamenities-decoraccessories', name: 'Seasonal Decor', sortOrder: 3 }
    );
    
    // ============================================
    // SAVE ALL DATA
    // ============================================
    
    // Save all categories
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(allCategories));
    
    // Save all L2 subcategories with timestamps
    const allL2SubsWithTimestamps = allL2Subs?.map(sub => ({
      ...sub,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    localStorage.setItem(SUBCATEGORIES_L2_KEY, JSON.stringify(allL2SubsWithTimestamps));
    
    // Save all L3 subcategories with timestamps
    const allL3SubsWithTimestamps = allL3Subs?.map(sub => ({
      ...sub,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    localStorage.setItem(SUBCATEGORIES_L3_KEY, JSON.stringify(allL3SubsWithTimestamps));
    
    // Mark as initialized
    localStorage.setItem(PRESET_INITIALIZED_KEY, 'true');
    
    console.log('Preset taxonomy created successfully with 12 Level 1 categories');
    return true;
  } catch (error) {
    console.error('Error creating preset taxonomy:', error);
    return false;
  }
};

export const isPresetInitialized = () => {
  return localStorage.getItem(PRESET_INITIALIZED_KEY) === 'true';
};

// ============================================
// DEPARTMENT SCOPE FILTERING
// ============================================

const getCategoryDepartment = (category) => {
  return category?.department || 'INTERIOR';
};

export const getCategoriesWithDepartmentScope = () => {
  const allCategories = getAllCategories();
  const currentUser = getCurrentUser();
  const requestedScope = getDepartmentScope();
  
  return enforceDepartmentScopeForInventory(
    allCategories,
    getCategoryDepartment,
    currentUser,
    requestedScope
  );
};