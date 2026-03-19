// Locations Storage - Stock Location Management

const LOCATIONS_KEY = 'cargo_stock_locations';

// Initialize with default locations if none exist
const initializeDefaultLocations = () => {
  const existing = localStorage.getItem(LOCATIONS_KEY);
  if (!existing) {
    const defaultLocations = [
      { id: 'loc-default', name: 'Main Storage', isArchived: false, createdAt: new Date()?.toISOString() },
      { id: 'loc-deck', name: 'Deck Storage', isArchived: false, createdAt: new Date()?.toISOString() },
      { id: 'loc-galley', name: 'Galley Storage', isArchived: false, createdAt: new Date()?.toISOString() }
    ];
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(defaultLocations));
    return defaultLocations;
  }
  return JSON.parse(existing);
};

// Get all locations (excluding archived by default)
export const getAllLocations = (includeArchived = false) => {
  try {
    const locations = initializeDefaultLocations();
    if (includeArchived) {
      return locations;
    }
    return locations?.filter(loc => !loc?.isArchived);
  } catch (error) {
    console.error('Error loading locations:', error);
    return [];
  }
};

// Get location by ID
export const getLocationById = (locationId) => {
  const locations = getAllLocations(true);
  return locations?.find(loc => loc?.id === locationId);
};

// Create new location
export const createLocation = (name) => {
  try {
    const locations = getAllLocations(true);
    const newLocation = {
      id: `loc-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      name: name?.trim(),
      isArchived: false,
      createdAt: new Date()?.toISOString()
    };
    locations?.push(newLocation);
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
    return newLocation;
  } catch (error) {
    console.error('Error creating location:', error);
    return null;
  }
};

// Update location
export const updateLocation = (locationId, updates) => {
  try {
    const locations = getAllLocations(true);
    const index = locations?.findIndex(loc => loc?.id === locationId);
    if (index !== -1) {
      locations[index] = {
        ...locations?.[index],
        ...updates,
        updatedAt: new Date()?.toISOString()
      };
      localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error updating location:', error);
    return false;
  }
};

// Archive location (soft delete)
export const archiveLocation = (locationId) => {
  return updateLocation(locationId, { isArchived: true });
};

// Unarchive location
export const unarchiveLocation = (locationId) => {
  return updateLocation(locationId, { isArchived: false });
};

// Delete location permanently
export const deleteLocation = (locationId) => {
  try {
    const locations = getAllLocations(true);
    const filtered = locations?.filter(loc => loc?.id !== locationId);
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting location:', error);
    return false;
  }
};
