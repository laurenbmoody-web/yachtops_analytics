// Location Storage Utility

const LOCATION_STORAGE_KEY = 'cargo_locations';

// Get all locations
export const getAllLocations = () => {
  try {
    const data = localStorage.getItem(LOCATION_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading locations:', error);
    return [];
  }
};

// Get single location by ID
export const getLocationById = (locationId) => {
  const locations = getAllLocations();
  return locations?.find(loc => loc?.id === locationId);
};

// Get location by name
export const getLocationByName = (name) => {
  const locations = getAllLocations();
  return locations?.find(loc => loc?.name?.toLowerCase() === name?.toLowerCase());
};

// Save location (add or update)
export const saveLocation = (locationData) => {
  try {
    const locations = getAllLocations();
    const timestamp = new Date()?.toISOString();
    
    if (locationData?.id) {
      // Update existing location
      const index = locations?.findIndex(loc => loc?.id === locationData?.id);
      if (index !== -1) {
        locations[index] = {
          ...locationData,
          updatedAt: timestamp
        };
      }
    } else {
      // Check if location with same name exists
      const existing = getLocationByName(locationData?.name);
      if (existing) {
        return existing; // Return existing location instead of creating duplicate
      }
      
      // Add new location
      const newLocation = {
        ...locationData,
        id: `loc-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      locations?.push(newLocation);
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(locations));
      return newLocation;
    }
    
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(locations));
    return locationData;
  } catch (error) {
    console.error('Error saving location:', error);
    return null;
  }
};

// Delete location
export const deleteLocation = (locationId) => {
  try {
    const locations = getAllLocations();
    const filtered = locations?.filter(loc => loc?.id !== locationId);
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting location:', error);
    return false;
  }
};

// Search locations
export const searchLocations = (query) => {
  const locations = getAllLocations();
  const lowerQuery = query?.toLowerCase();
  
  return locations?.filter(loc => {
    return (
      loc?.name?.toLowerCase()?.includes(lowerQuery) ||
      loc?.type?.toLowerCase()?.includes(lowerQuery) ||
      loc?.description?.toLowerCase()?.includes(lowerQuery)
    );
  });
};