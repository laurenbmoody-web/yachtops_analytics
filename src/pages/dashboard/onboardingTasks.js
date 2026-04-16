import { MapPin, FolderTree, Upload, Users } from 'lucide-react';

// Extensible tasks array. `isDone(ctx)` derives completion from Supabase state.
// `key` is written to tenants.dismissed_tasks when the user skips.
export const ONBOARDING_TASKS = [
  {
    key: 'locations',
    label: 'Locations',
    title: 'Add your first location',
    icon: MapPin,
    href: '/locations-settings',
    isDone: (ctx) => (ctx.locationsCount ?? 0) > 0,
  },
  {
    key: 'folders',
    label: 'Inventory folders',
    title: 'Set up inventory folders',
    icon: FolderTree,
    href: '/inventory',
    isDone: (ctx) => (ctx.foldersCount ?? 0) > 0,
  },
  {
    key: 'import',
    label: 'Import inventory',
    title: 'Import your inventory',
    icon: Upload,
    href: '/smart-import-with-auto-assignment-engine',
    isDone: (ctx) => (ctx.inventoryItemsCount ?? 0) > 0,
  },
  {
    key: 'invite_crew',
    label: 'Invite crew',
    title: 'Invite your crew',
    icon: Users,
    href: '/crew-management',
    // >1 so the admin themselves doesn't count
    isDone: (ctx) => (ctx.crewCount ?? 0) > 1,
  },
  // Future:
  // { key: 'watch_schedule', label: 'Watch schedule', title: 'Set up the watch schedule', icon: Clock, href: '/watch', isDone: (ctx) => !!ctx.watchScheduleSet },
];

export function getNextTask(ctx, tenant) {
  const dismissed = new Set(tenant?.dismissed_tasks ?? []);
  return ONBOARDING_TASKS.find(
    (t) => !t.isDone(ctx) && !dismissed.has(t.key)
  );
}

export function getProgress(ctx) {
  const total = ONBOARDING_TASKS.length;
  const done = ONBOARDING_TASKS.filter((t) => t.isDone(ctx)).length;
  return { done, total };
}
