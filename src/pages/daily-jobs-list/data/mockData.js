export const crewMembers = [
  {
    id: 'user-1',
    name: 'Sarah Mitchell',
    role: 'Chief Stew',
    avatar: 'https://i.pravatar.cc/150?img=47',
    alt: 'Professional headshot of Sarah Mitchell, Chief Stew, wearing white uniform'
  },
  {
    id: 'user-2',
    name: 'Emma Thompson',
    role: 'Interior Crew',
    avatar: 'https://i.pravatar.cc/150?img=48',
    alt: 'Professional headshot of Emma Thompson, Interior Crew member, wearing white uniform'
  },
  {
    id: 'user-3',
    name: 'James Wilson',
    role: 'Interior Crew',
    avatar: 'https://i.pravatar.cc/150?img=12',
    alt: 'Professional headshot of James Wilson, Interior Crew member, wearing white uniform'
  },
  {
    id: 'user-4',
    name: 'Olivia Brown',
    role: 'Interior Crew',
    avatar: 'https://i.pravatar.cc/150?img=49',
    alt: 'Professional headshot of Olivia Brown, Interior Crew member, wearing white uniform'
  }
];

export const mockDutySets = [
  {
    id: 'dutyset-1',
    type: 'dutyset',
    name: 'Crew Mess',
    assignees: ['user-2'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds1-t1', name: 'Wipe down all surfaces', frequency: 'daily', completed: false },
      { id: 'ds1-t2', name: 'Restock coffee station', frequency: 'daily', completed: false },
      { id: 'ds1-t3', name: 'Empty trash bins', frequency: 'daily', completed: false },
      { id: 'ds1-t4', name: 'Deep clean refrigerator', frequency: 'weekly-wednesday', completed: false },
      { id: 'ds1-t5', name: 'Inventory check', frequency: 'monthly-1', completed: false }
    ]
  },
  {
    id: 'dutyset-2',
    type: 'dutyset',
    name: "Captain\'s Cabin",
    assignees: ['user-2'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds2-t1', name: 'Make bed with fresh linens', frequency: 'daily', completed: false },
      { id: 'ds2-t2', name: 'Vacuum and dust', frequency: 'daily', completed: false },
      { id: 'ds2-t3', name: 'Restock bathroom amenities', frequency: 'daily', completed: false },
      { id: 'ds2-t4', name: 'Polish fixtures', frequency: 'weekly-wednesday', completed: false }
    ]
  },
  {
    id: 'dutyset-3',
    type: 'dutyset',
    name: 'Pantries',
    assignees: ['user-3'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds3-t1', name: 'Check expiration dates', frequency: 'daily', completed: false },
      { id: 'ds3-t2', name: 'Organize shelves', frequency: 'daily', completed: false },
      { id: 'ds3-t3', name: 'Wipe down surfaces', frequency: 'daily', completed: false },
      { id: 'ds3-t4', name: 'Deep clean and reorganize', frequency: 'weekly-wednesday', completed: false }
    ]
  },
  {
    id: 'dutyset-4',
    type: 'dutyset',
    name: 'Bridge',
    assignees: ['user-3'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds4-t1', name: 'Dust all surfaces', frequency: 'daily', completed: false },
      { id: 'ds4-t2', name: 'Clean windows', frequency: 'daily', completed: false },
      { id: 'ds4-t3', name: 'Polish instruments', frequency: 'weekly-wednesday', completed: false }
    ]
  },
  {
    id: 'dutyset-5',
    type: 'dutyset',
    name: 'Stairs',
    assignees: ['user-4'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds5-t1', name: 'Vacuum all stairs', frequency: 'daily', completed: false },
      { id: 'ds5-t2', name: 'Wipe handrails', frequency: 'daily', completed: false },
      { id: 'ds5-t3', name: 'Polish brass fixtures', frequency: 'weekly-wednesday', completed: false }
    ]
  },
  {
    id: 'dutyset-6',
    type: 'dutyset',
    name: 'Laundry',
    assignees: ['user-4'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds6-t1', name: 'Process guest laundry', frequency: 'daily', completed: false },
      { id: 'ds6-t2', name: 'Fold and organize linens', frequency: 'daily', completed: false },
      { id: 'ds6-t3', name: 'Clean machines', frequency: 'weekly-wednesday', completed: false },
      { id: 'ds6-t4', name: 'Inventory linen stock', frequency: 'monthly-1', completed: false }
    ]
  }
];

export const mockTasks = [
  {
    id: 'task-1',
    type: 'task',
    title: 'Restock minibar',
    description: 'Restock all guest cabin minibars with premium beverages',
    assignees: ['user-2'],
    dueDate: new Date()?.toISOString(),
    priority: 'high',
    status: 'pending'
  },
  {
    id: 'task-2',
    type: 'task',
    title: 'Prepare welcome amenities',
    description: 'Set up welcome amenities in all guest cabins',
    assignees: ['user-3', 'user-4'],
    dueDate: new Date()?.toISOString(),
    priority: 'high',
    status: 'pending'
  },
  {
    id: 'task-3',
    type: 'task',
    title: 'Polish silverware',
    description: 'Polish all silverware for guest dining',
    assignees: [],
    dueDate: new Date()?.toISOString(),
    priority: 'low',
    status: 'pending'
  },
  {
    id: 'task-4',
    type: 'task',
    title: 'Arrange flowers',
    description: 'Fresh flower arrangements for main salon and guest cabins',
    assignees: ['all-interior'],
    dueDate: new Date()?.toISOString(),
    priority: 'medium',
    status: 'pending'
  }
];

export const mockCustomBoards = [
  {
    id: 'board-additional',
    name: 'Additional Jobs',
    description: 'Custom tasks for your team',
    type: 'interior',
    cards: []
  }
];