// Permission tiers that can access each widget group
export const WIDGET_PERMISSIONS = {
  ALL: ['COMMAND', 'CHIEF', 'HOD', 'CREW', 'OPTIONAL_CREW'],
  COMMAND_CHIEF: ['COMMAND', 'CHIEF'],
};

// Master widget catalogue
export const WIDGET_META = {
  teamJobs: {
    id: 'teamJobs',
    title: 'Team Jobs',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'left',
  },
  todaySnapshot: {
    id: 'todaySnapshot',
    title: "Today's Snapshot",
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'left',
  },
  recentActivity: {
    id: 'recentActivity',
    title: 'Recent Activity',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'left',
  },
  vesselView: {
    id: 'vesselView',
    title: 'Vessel View',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'center',
  },
  laundry: {
    id: 'laundry',
    title: 'Laundry Log',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'center',
  },
  quickActions: {
    id: 'quickActions',
    title: 'Quick Actions',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'center',
  },
  charterAccounts: {
    id: 'charterAccounts',
    title: 'Charter Accounts',
    allowedTiers: WIDGET_PERMISSIONS.COMMAND_CHIEF,
    defaultColumn: 'right',
  },
  ownerAccounts: {
    id: 'ownerAccounts',
    title: 'Owner Accounts',
    allowedTiers: WIDGET_PERMISSIONS.COMMAND_CHIEF,
    defaultColumn: 'right',
  },
  inventoryHealth: {
    id: 'inventoryHealth',
    title: 'Inventory Health',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'right',
  },
  provisioning: {
    id: 'provisioning',
    title: 'Provisioning',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'right',
  },
  pantry: {
    id: 'pantry',
    title: 'Pantry · Interior',
    allowedTiers: WIDGET_PERMISSIONS.ALL,
    defaultColumn: 'center',
  },
};

export const DEFAULT_LAYOUT = {
  left:   ['teamJobs', 'todaySnapshot', 'recentActivity'],
  center: ['vesselView', 'laundry', 'quickActions', 'pantry'],
  right:  ['charterAccounts', 'ownerAccounts', 'inventoryHealth', 'provisioning'],
};
