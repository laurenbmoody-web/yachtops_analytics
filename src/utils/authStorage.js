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
  OPTIONAL_CREW: 'OPTIONAL_CREW',
  VIEW_ONLY: 'VIEW_ONLY'
};

// User status enum
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

// Vessel Configuration
export const VESSEL_NAME = 'M/Y Belongers';

// Storage keys
const ROLES_KEY = 'cargo.roles.v1';
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

// Seed roles data
const SEED_ROLES = [
  // BRIDGE
  { id: 'role-1', title: 'Captain', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-2', title: 'Relief Captain', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-61', title: 'Build Captain', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-62', title: 'Fleet Captain', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-63', title: 'Skipper', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-3', title: 'Purser', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-4', title: 'Assistant Purser', department: Department?.BRIDGE, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-5', title: 'Chief Officer / 1st Mate', department: Department?.BRIDGE, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-6', title: '2nd Officer', department: Department?.BRIDGE, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-7', title: '3rd Officer', department: Department?.BRIDGE, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-64', title: 'Navigator', department: Department?.BRIDGE, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-65', title: 'OOW', department: Department?.BRIDGE, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-66', title: 'Captain / Engineer', department: Department?.BRIDGE, tier: PermissionTier?.COMMAND, isActive: true },
  
  // INTERIOR
  { id: 'role-8', title: 'Chief Stewardess / Interior Manager', department: Department?.INTERIOR, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-9', title: 'Head of Service', department: Department?.INTERIOR, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-10', title: 'Head of Housekeeping', department: Department?.INTERIOR, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-11', title: '2nd Stewardess', department: Department?.INTERIOR, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-12', title: 'Senior Stewardess', department: Department?.INTERIOR, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-13', title: '3rd Stewardess', department: Department?.INTERIOR, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-14', title: 'Stewardess', department: Department?.INTERIOR, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-15', title: 'Junior Stewardess', department: Department?.INTERIOR, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-16', title: 'Butler', department: Department?.INTERIOR, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-17', title: 'Laundry Steward(ess)', department: Department?.INTERIOR, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-18', title: 'Housekeeping Steward(ess)', department: Department?.INTERIOR, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-19', title: 'Sole Steward(ess)', department: Department?.INTERIOR, tier: PermissionTier?.CHIEF, isActive: true },
  
  // DECK
  { id: 'role-20', title: 'Bosun', department: Department?.DECK, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-21', title: 'Lead Deckhand', department: Department?.DECK, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-22', title: 'Deckhand', department: Department?.DECK, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-23', title: 'Junior Deckhand', department: Department?.DECK, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-24', title: 'Deck/Stew', department: Department?.DECK, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-25', title: 'Deck/Engineer', department: Department?.DECK, tier: PermissionTier?.CREW, isActive: true },
  
  // ENGINEERING
  { id: 'role-26', title: 'Chief Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-27', title: 'Relief Chief Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-28', title: '1st Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-29', title: '2nd Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-30', title: '3rd Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-31', title: 'Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-32', title: 'Junior Engineer', department: Department?.ENGINEERING, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-33', title: 'Motorman', department: Department?.ENGINEERING, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-34', title: 'ETO', department: Department?.ENGINEERING, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-35', title: 'AV/IT Officer', department: Department?.ENGINEERING, tier: PermissionTier?.HOD, isActive: true },
  
  // GALLEY
  { id: 'role-36', title: 'Head Chef / Executive Chef', department: Department?.GALLEY, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-37', title: 'Sole Chef', department: Department?.GALLEY, tier: PermissionTier?.CHIEF, isActive: true },
  { id: 'role-38', title: 'Sous Chef / 2nd Chef', department: Department?.GALLEY, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-39', title: 'Chef de Partie / 3rd Chef', department: Department?.GALLEY, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-40', title: 'Crew Chef / Cook', department: Department?.GALLEY, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-41', title: 'Galley Assistant', department: Department?.GALLEY, tier: PermissionTier?.CREW, isActive: true },
  
  // SECURITY
  { id: 'role-42', title: 'SSO / Security Officer', department: Department?.SECURITY, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-43', title: 'CPO', department: Department?.SECURITY, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-44', title: 'PSO', department: Department?.SECURITY, tier: PermissionTier?.CREW, isActive: true },
  
  // SPA
  { id: 'role-45', title: 'Spa Manager', department: Department?.SPA, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-46', title: 'Spa Therapist / Steward(ess)', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-67', title: 'Spa Therapist', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-47', title: 'Masseur(euse)', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-68', title: 'Masseuse', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-69', title: 'Beauty Therapist', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-48', title: 'Hairdresser / Barber', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-49', title: 'Beautician', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-50', title: 'Personal Trainer', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-51', title: 'Yoga / Pilates Instructor', department: Department?.SPA, tier: PermissionTier?.CREW, isActive: true },
  
  // AVIATION
  { id: 'role-52', title: 'Helicopter Pilot', department: Department?.AVIATION, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-53', title: 'Co-Pilot', department: Department?.AVIATION, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-70', title: 'Sub-Pilot', department: Department?.AVIATION, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-71', title: 'Helicopter Mechanic', department: Department?.AVIATION, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-54', title: 'Flight Engineer', department: Department?.AVIATION, tier: PermissionTier?.CREW, isActive: true },
  { id: 'role-72', title: 'Aviation Engineer', department: Department?.AVIATION, tier: PermissionTier?.CREW, isActive: true },
  
  // SHORE_MANAGEMENT
  { id: 'role-73', title: 'Owner Rep', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-55', title: 'Yacht Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-74', title: 'Fleet Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-75', title: 'Operations Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-76', title: 'Charter Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-77', title: 'Accounts Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-78', title: 'Compliance Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-79', title: 'Crew Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-80', title: 'HR Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-81', title: 'Procurement Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-56', title: 'Technical Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-82', title: 'Management / Admin', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-57', title: 'Accounts / Finance Manager', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.COMMAND, isActive: true },
  { id: 'role-58', title: 'PA / EA', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.HOD, isActive: true },
  { id: 'role-59', title: 'Dayworker', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.OPTIONAL_CREW, isActive: true },
  { id: 'role-60', title: 'Delivery Crew', department: Department?.SHORE_MANAGEMENT, tier: PermissionTier?.OPTIONAL_CREW, isActive: true }
];

// Force re-initialize roles from SEED_ROLES (fixes any corrupted data)
export const forceReinitializeRoles = () => {
  try {
    localStorage.setItem(ROLES_KEY, JSON.stringify(SEED_ROLES));
    console.log('✅ Roles re-initialized from SEED_ROLES');
    return SEED_ROLES;
  } catch (error) {
    console.error('Error force re-initializing roles:', error);
    return SEED_ROLES;
  }
};

// Migration map for old department values to new Department enum values
const DEPARTMENT_MIGRATION_MAP = {
  'BRIDGE_COMMAND': Department?.BRIDGE,
  'SPA_WELLNESS': Department?.SPA,
  'MANAGEMENT_SHORE': Department?.SHORE_MANAGEMENT,
  'SHORE': Department?.SHORE_MANAGEMENT,
  'OPTIONAL_CREW': Department?.SHORE_MANAGEMENT, // Map OPTIONAL_CREW to SHORE_MANAGEMENT
  // Add any other legacy department values here
};

// Comprehensive migration function to fix mismatched department values
const migrateRoles = () => {
  try {
    const stored = localStorage.getItem(ROLES_KEY);
    if (!stored) return null;
    
    const existingRoles = JSON.parse(stored);
    let needsMigration = false;
    
    // Check if any roles have undefined, null, or mismatched departments
    const migratedRoles = existingRoles?.map(role => {
      let migratedRole = { ...role };
      
      // Case 1: Undefined or null department
      if (!role?.department || role?.department === 'undefined' || role?.department === 'null') {
        needsMigration = true;
        const seedRole = SEED_ROLES?.find(sr => sr?.id === role?.id || sr?.title === role?.title);
        if (seedRole) {
          migratedRole.department = seedRole?.department;
          migratedRole.tier = seedRole?.tier;
          console.log(`🔧 Migrated role "${role?.title}" from undefined to ${seedRole?.department}`);
        }
      }
      // Case 2: Department value exists in migration map (old value)
      else if (DEPARTMENT_MIGRATION_MAP?.[role?.department]) {
        needsMigration = true;
        const newDepartment = DEPARTMENT_MIGRATION_MAP?.[role?.department];
        migratedRole.department = newDepartment;
        console.log(`🔧 Migrated role "${role?.title}" from ${role?.department} to ${newDepartment}`);
      }
      // Case 3: Department value doesn't match any valid Department enum value
      else if (!Object.values(Department)?.includes(role?.department)) {
        needsMigration = true;
        const seedRole = SEED_ROLES?.find(sr => sr?.id === role?.id || sr?.title === role?.title);
        if (seedRole) {
          migratedRole.department = seedRole?.department;
          migratedRole.tier = seedRole?.tier;
          console.log(`🔧 Migrated role "${role?.title}" from invalid "${role?.department}" to ${seedRole?.department}`);
        }
      }
      
      return migratedRole;
    });
    
    if (needsMigration) {
      localStorage.setItem(ROLES_KEY, JSON.stringify(migratedRoles));
      console.log('✅ Role migration completed - localStorage now matches Department enum');
      return migratedRoles;
    }
    
    return existingRoles;
  } catch (error) {
    console.error('Error migrating roles:', error);
    // On error, force re-initialize from SEED_ROLES
    return forceReinitializeRoles();
  }
};

// Initialize roles in localStorage
export const initializeRoles = () => {
  const existing = localStorage.getItem(ROLES_KEY);
  if (!existing) {
    localStorage.setItem(ROLES_KEY, JSON.stringify(SEED_ROLES));
    return SEED_ROLES;
  }
  try {
    return JSON.parse(existing);
  } catch {
    console.error('initializeRoles: corrupt localStorage data, reinitializing');
    localStorage.setItem(ROLES_KEY, JSON.stringify(SEED_ROLES));
    return SEED_ROLES;
  }
};

// Load roles
export const loadRoles = () => {
  try {
    // First, try to migrate any existing roles with undefined departments
    const migrated = migrateRoles();
    if (migrated) {
      return migrated;
    }
    
    const stored = localStorage.getItem(ROLES_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return initializeRoles();
  } catch (error) {
    console.error('Error loading roles:', error);
    return SEED_ROLES;
  }
};

// Save roles
export const saveRoles = (roles) => {
  try {
    localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
  } catch (error) {
    console.error('Error saving roles:', error);
  }
};

// Create role
export const createRole = (roleData) => {
  const roles = loadRoles();
  
  // Check for duplicate title + department combination
  const duplicate = roles?.find(r => 
    r?.title?.toLowerCase()?.trim() === roleData?.title?.toLowerCase()?.trim() && 
    r?.department === roleData?.department
  );
  
  if (duplicate) {
    throw new Error('A role with this title already exists in this department');
  }
  
  const newRole = {
    id: crypto.randomUUID(),
    title: roleData?.title?.trim(),
    department: roleData?.department,
    permissionTier: roleData?.permissionTier,
    status: roleData?.status || 'ACTIVE',
    createdAt: new Date()?.toISOString()
  };
  roles?.push(newRole);
  saveRoles(roles);
  return newRole;
};

// Update role
export const updateRole = (roleId, updates) => {
  const roles = loadRoles();
  const index = roles?.findIndex(r => r?.id === roleId);
  if (index !== -1) {
    roles[index] = { ...roles?.[index], ...updates };
    saveRoles(roles);
    return roles?.[index];
  }
  return null;
};

// Get roles by department
export const getRolesByDepartment = (department) => {
  const roles = loadRoles();
  return roles?.filter(r => r?.department === department && r?.isActive);
};

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
    try {
      return JSON.parse(existing);
    } catch {
      console.error('initializeUsers: corrupt localStorage data, reinitializing');
    }
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
  const roles = loadRoles();
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
  const roles = loadRoles();
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
  const roles = loadRoles();
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

export const isViewOnly = (user) => {
  if (!user) return false;
  const tier = (
    user?.permission_tier ||
    user?.permissionTier ||
    user?.effectiveTier ||
    user?.tier ||
    ''
  )?.toUpperCase()?.trim();
  return tier === PermissionTier?.VIEW_ONLY;
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
export function getAllUsers() {
  return loadUsers();
}