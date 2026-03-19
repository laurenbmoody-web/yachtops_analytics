// Team members data model and localStorage persistence

const STORAGE_KEY = 'cargo.teamMembers.v1';

/**
 * Team Member Type Definition:
 * {
 *   id: string (unique),
 *   name: string,
 *   role: "CHIEF_STEW" | "CREW" | "HOD",
 *   department: string,
 *   avatar: string (URL)
 * }
 */

const defaultTeamMembers = [
  {
    id: 'user-chief-1',
    name: 'Emma Richardson',
    role: 'CHIEF_STEW',
    department: 'Interior',
    avatar: 'https://i.pravatar.cc/150?img=1'
  },
  {
    id: 'user-2',
    name: 'Sophie Martinez',
    role: 'CREW',
    department: 'Interior',
    position: '2nd Stew',
    avatar: 'https://i.pravatar.cc/150?img=5'
  },
  {
    id: 'user-3',
    name: 'Olivia Chen',
    role: 'CREW',
    department: 'Interior',
    position: '3rd Stew',
    avatar: 'https://i.pravatar.cc/150?img=9'
  },
  {
    id: 'user-4',
    name: 'James Wilson',
    role: 'CREW',
    department: 'Interior',
    position: 'Laundry',
    avatar: 'https://i.pravatar.cc/150?img=12'
  },
  {
    id: 'user-5',
    name: 'Michael Torres',
    role: 'CREW',
    department: 'Deck',
    position: 'Deckhand',
    avatar: 'https://i.pravatar.cc/150?img=15'
  },
  {
    id: 'user-6',
    name: 'David Anderson',
    role: 'CREW',
    department: 'Service',
    position: 'Service Crew',
    avatar: 'https://i.pravatar.cc/150?img=33'
  }
];

/**
 * Load team members from localStorage
 * @returns {Array} Array of team member objects
 */
export const loadTeamMembers = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    
    // Initialize with default team
    saveTeamMembers(defaultTeamMembers);
    return defaultTeamMembers;
  } catch (error) {
    console.error('Error loading team members:', error);
    return defaultTeamMembers;
  }
};

/**
 * Save team members to localStorage
 * @param {Array} teamMembers - Array of team member objects
 */
export const saveTeamMembers = (teamMembers) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(teamMembers));
  } catch (error) {
    console.error('Error saving team members:', error);
  }
};

/**
 * Get team member by ID
 * @param {string} id - Team member ID
 * @returns {Object|null} Team member object or null
 */
export const getTeamMember = (id) => {
  const members = loadTeamMembers();
  return members?.find(m => m?.id === id) || null;
};

/**
 * Get interior team members only
 * @returns {Array} Array of interior team members
 */
export const getInteriorTeam = () => {
  const members = loadTeamMembers();
  return members?.filter(m => m?.department === 'Interior') || [];
};