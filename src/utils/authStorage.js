// Global constants for departments and permission tiers
export const DEPARTMENTS = [
  "Bridge",
  "Interior",
  "Deck",
  "Engineering",
  "Galley",
  "Spa",
  "Security",
  "Aviation",
  "Shore / Management"
];

export const PERMISSION_TIERS = [
  "Command",
  "Chief",
  "HOD",
  "Crew",
  "Optional Crew"
];

// Department enum
export const Department = {
  BRIDGE: 'BRIDGE',
  INTERIOR: 'INTERIOR',
  DECK: 'DECK',
  ENGINEERING: 'ENGINEERING',
  GALLEY: 'GALLEY',
  SPA: 'SPA',
  SECURITY: 'SECURITY',
  AVIATION: 'AVIATION',
  SHORE_MANAGEMENT: 'SHORE_MANAGEMENT'
};

// PermissionTier enum
export const PermissionTier = {
  COMMAND: 'COMMAND',
  CHIEF: 'CHIEF',
  HOD: 'HOD',
  CREW: 'CREW',
  OPTIONAL_CREW: 'OPTIONAL_CREW'
};

// User status enum
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

// Vessel Configuration
export const VESSEL_NAME = 'M/Y Belongers';

// Storage keys
const USERS_KEY = 'cargo.users.v1';
const CURRENT_USER_KEY = 'cargo.currentUser.v1';

// Alternative storage keys that might be used by mobile app or other platforms
const LEGACY_USERS_KEYS = [
  'cargo_users',
  'cargo-users',
  'users',
  'cargo.users',
  'cargoUsers',
  'cargo_users_v1'
];

// Roles are stored in the database (public.roles for the global catalog +
// public.tenant_custom_roles per-tenant). They are NOT in localStorage —
// components that need role data query Supabase directly (see RoleManagement,
// InviteCrewModal, the onboarding invite step, and PendingInvitesSection).

// Migrate users from alternative storage keys to standardized key
const migrateUsersFromLegacyKeys = () => {
  try {
    const standardUsers = localStorage.getItem(USERS_KEY);
    let mergedUsers = standardUsers ? JSON.parse(standardUsers) : [];
    let foundLegacyData = false;

    LEGACY_USERS_KEYS?.forEach(legacyKey => {
      const legacyData = localStorage.getItem(legacyKey);
      if (legacyData) {
        try {
          const legacyUsers = JSON.parse(legacyData);
          if (Array.isArray(legacyUsers) && legacyUsers?.length > 0) {
            foundLegacyData = true;
            console.log(`🔄 Found ${legacyUsers?.length} users in legacy key: ${legacyKey}`);
            
            legacyUsers?.forEach(legacyUser => {
              const existingUser = mergedUsers?.find(u => u?.email === legacyUser?.email);
              if (!existingUser) {
                const migratedUser = {
                  ...legacyUser,
                  id: legacyUser?.id || `user-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
                  status: legacyUser?.status || UserStatus?.ACTIVE,
                  createdAt: legacyUser?.createdAt || new Date()?.toISOString()
                };
                mergedUsers?.push(migratedUser);
                console.log(`✅ Migrated user: ${migratedUser?.fullName} (${migratedUser?.email})`);
              } else {
                console.log(`⏭️  Skipped duplicate user: ${legacyUser?.email}`);
              }
            });
          }
        } catch (parseError) {
          console.warn(`⚠️  Could not parse legacy key ${legacyKey}:`, parseError);
        }
      }
    });

    if (foundLegacyData && mergedUsers?.length > 0) {
      localStorage.setItem(USERS_KEY, JSON.stringify(mergedUsers));
      console.log(`✅ Migration complete: ${mergedUsers?.length} total users in ${USERS_KEY}`);
      return mergedUsers;
    }

    return mergedUsers?.length > 0 ? mergedUsers : null;
  } catch (error) {
    console.error('❌ Error migrating users from legacy keys:', error);
    return null;
  }
};

// Initialize users with default COMMAND user
const initializeUsers = () => {
  const migratedUsers = migrateUsersFromLegacyKeys();
  if (migratedUsers && migratedUsers?.length > 0) {
    return migratedUsers;
  }

  const existing = localStorage.getItem(USERS_KEY);
  if (existing) {
    return JSON.parse(existing);
  }

  const defaultUser = {
    id: 'user-captain-1',
    fullName: 'Captain',
    email: 'captain@cargo.local',
    password: 'cargo123',
    department: Department?.BRIDGE,
    roleId: 'role-1',
    roleTitle: 'Captain',
    tierOverride: null,
    effectiveTier: PermissionTier?.COMMAND,
    status: UserStatus?.ACTIVE,
    createdAt: new Date()?.toISOString()
  };
  const users = [defaultUser];
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  console.log('✅ Initialized default Captain user');
  return users;
};

// Load users
export const loadUsers = () => {
  try {
    // ALWAYS attempt migration first to merge any legacy data
    const migrated = migrateUsersFromLegacyKeys();
    if (migrated && migrated?.length > 0) {
      return migrated;
    }
    
    const stored = localStorage.getItem(USERS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return initializeUsers();
  } catch (error) {
    console.error('Error loading users:', error);
    return initializeUsers();
  }
};

// Save users
export const saveUsers = (users) => {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (error) {
    console.error('Error saving users:', error);
  }
};

// Create user
export const createUser = (userData) => {
  const users = loadUsers();
  const roles = [];
  const role = roles?.find(r => r?.id === userData?.roleId);
  
  // Resolve effective tier
  const tierOverride = userData?.tierOverride || null;
  const effectiveTier = tierOverride || role?.tier || PermissionTier?.CREW;
  
  const newUser = {
    id: `user-${Date.now()}`,
    fullName: userData?.fullName,
    email: userData?.email,
    password: userData?.password,
    department: userData?.department,
    roleId: userData?.roleId,
    roleTitle: role?.title || 'Unknown Role',
    tierOverride: tierOverride,
    effectiveTier: effectiveTier,
    status: userData?.status || UserStatus?.ACTIVE,
    createdAt: new Date()?.toISOString()
  };
  
  users?.push(newUser);
  saveUsers(users);
  return newUser;
};

// Update user
export const updateUser = (userId, updates) => {
  const users = loadUsers();
  const roles = [];
  const index = users?.findIndex(u => u?.id === userId);
  if (index !== -1) {
    const updatedData = { ...users?.[index], ...updates };
    
    // If roleId changed, update roleTitle and recalculate effectiveTier
    if (updates?.roleId) {
      const role = roles?.find(r => r?.id === updates?.roleId);
      if (role) {
        updatedData.roleTitle = role?.title;
        // Recalculate effectiveTier
        updatedData.effectiveTier = updatedData?.tierOverride || role?.tier;
      }
    }
    
    // If tierOverride changed, recalculate effectiveTier
    if (updates?.tierOverride !== undefined) {
      const role = roles?.find(r => r?.id === updatedData?.roleId);
      updatedData.effectiveTier = updates?.tierOverride || role?.tier || PermissionTier?.CREW;
    }
    
    users[index] = updatedData;
    saveUsers(users);
    return users?.[index];
  }
  return null;
};

// Authenticate user
export const authenticateUser = (email, password) => {
  const users = loadUsers();
  const user = users?.find(u => u?.email === email && u?.password === password);
  
  if (!user) {
    return { success: false, error: 'Invalid email or password' };
  }
  
  if (user?.status !== UserStatus?.ACTIVE) {
    return { success: false, error: 'User account is inactive' };
  }
  
  return { success: true, user };
};

// Get current user
export const getCurrentUser = () => {
  try {
    const stored = localStorage.getItem(CURRENT_USER_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  } catch (error) {
    console.error('Error loading current user:', error);
    return null;
  }
};

// Set current user
export const setCurrentUser = (user) => {
  try {
    if (user) {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CURRENT_USER_KEY);
    }
  } catch (error) {
    console.error('Error saving current user:', error);
  }
};

// Clear current user (logout)
export const clearCurrentUser = () => {
  localStorage.removeItem(CURRENT_USER_KEY);
};

// Get user with role details
export const getUserWithRole = (userId) => {
  const users = loadUsers();
  const roles = [];
  const user = users?.find(u => u?.id === userId);
  
  if (!user) return null;
  
  const role = roles?.find(r => r?.id === user?.roleId);
  return { ...user, role };
};

// Permission helpers
export const hasCommandAccess = (user) => {
  if (!user) return false;
  // IMPORTANT: isCommand must be determined from permission tier field ONLY.
  // Do NOT use roleTitle / role name for this check.
  const tier = (
    user?.permission_tier ||   // snake_case from Supabase DB / tenant_members
    user?.permissionTier ||    // camelCase variant
    user?.effectiveTier ||     // legacy localStorage field
    user?.tier ||              // legacy localStorage field
    ''
  )?.toUpperCase()?.trim();
  return tier === PermissionTier?.COMMAND;
};

export const hasChiefAccess = (user) => {
  if (hasCommandAccess(user)) return true;
  const tier = (
    user?.permission_tier ||
    user?.permissionTier ||
    user?.effectiveTier ||
    user?.tier ||
    ''
  )?.toUpperCase()?.trim();
  return tier === PermissionTier?.CHIEF;
};

export const hasHODAccess = (user) => {
  if (hasCommandAccess(user) || hasChiefAccess(user)) return true;
  const tier = (
    user?.permission_tier ||
    user?.permissionTier ||
    user?.effectiveTier ||
    user?.tier ||
    ''
  )?.toUpperCase()?.trim();
  return tier === PermissionTier?.HOD;
};

export const canAccessDepartment = (user, department) => {
  if (hasCommandAccess(user)) return true;
  return user?.department === department;
};

// Department display names
export const getDepartmentDisplayName = (department) => {
  const mapping = {
    'AVIATION': 'Aviation',
    'BRIDGE': 'Bridge',
    'DECK': 'Deck',
    'ENGINEERING': 'Engineering',
    'GALLEY': 'Galley',
    'INTERIOR': 'Interior',
    'SECURITY': 'Security',
    'SHORE_MANAGEMENT': 'Shore/Management',
    'SPA': 'Spa'
  };
  return mapping?.[department] || department;
};

// Tier display names
export const getTierDisplayName = (tier) => {
  const names = {
    [PermissionTier?.COMMAND]: 'Command',
    [PermissionTier?.CHIEF]: 'Chief',
    [PermissionTier?.HOD]: 'Head of Department',
    [PermissionTier?.CREW]: 'Crew',
    [PermissionTier?.OPTIONAL_CREW]: 'Optional Crew'
  };
  return names?.[tier] || tier;
};
function getAllUsers(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: getAllUsers is not implemented yet.', args);
  return null;
}

export { getAllUsers };