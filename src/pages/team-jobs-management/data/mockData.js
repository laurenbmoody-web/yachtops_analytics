// Mock data for Jobs system

export const mockBoards = [
  {
    id: 'interior',
    name: 'Interior',
    members: ['user-1', 'user-2', 'user-3', 'user-4'],
    color: '#3B82F6'
  },
  {
    id: 'turnaround',
    name: 'Turnaround',
    members: ['user-1', 'user-2', 'user-3'],
    color: '#10B981'
  },
  {
    id: 'guest-prep',
    name: 'Guest Prep',
    members: ['user-1', 'user-2', 'user-4'],
    color: '#F59E0B'
  },
  {
    id: 'deck',
    name: 'Deck',
    members: ['user-5', 'user-6'],
    color: '#06B6D4'
  }
];

export const mockTasks = [
  {
    id: 'task-1',
    type: 'task',
    title: 'Restock minibar',
    description: 'Restock all guest cabin minibars with premium beverages',
    board: 'interior',
    assignees: ['user-1'],
    dueDate: new Date()?.toISOString(),
    priority: 'high',
    status: 'pending',
    checklist: [
      { id: 'c1', text: 'Check inventory levels', completed: false },
      { id: 'c2', text: 'Prepare cart with items', completed: false },
      { id: 'c3', text: 'Restock all cabins', completed: false }
    ],
    notes: [],
    attachments: [],
    activity: []
  },
  {
    id: 'task-2',
    type: 'task',
    title: 'Review guest cabins',
    description: 'Complete inspection of all guest cabins before charter',
    board: 'interior',
    assignees: ['user-2'],
    dueDate: new Date(Date.now() + 86400000)?.toISOString(),
    priority: 'medium',
    status: 'pending',
    checklist: [],
    notes: [],
    attachments: [],
    activity: []
  },
  {
    id: 'task-3',
    type: 'task',
    title: 'Polish silverware',
    description: 'Polish all silverware for guest dining',
    board: 'interior',
    assignees: [],
    dueDate: new Date(Date.now() + 172800000)?.toISOString(),
    priority: 'low',
    status: 'pending',
    checklist: [],
    notes: [],
    attachments: [],
    activity: []
  },
  {
    id: 'task-4',
    type: 'task',
    title: 'Prepare welcome amenities',
    description: 'Set up welcome amenities in all guest cabins',
    board: 'guest-prep',
    assignees: ['user-1', 'user-4'],
    dueDate: new Date()?.toISOString(),
    priority: 'high',
    status: 'pending',
    checklist: [],
    notes: [],
    attachments: [],
    activity: []
  },
  {
    id: 'task-5',
    type: 'task',
    title: 'Deep clean galley',
    description: 'Complete deep clean of galley area',
    board: 'turnaround',
    assignees: ['user-2', 'user-3'],
    dueDate: new Date(Date.now() + 86400000)?.toISOString(),
    priority: 'medium',
    status: 'pending',
    checklist: [],
    notes: [],
    attachments: [],
    activity: []
  }
];

export const mockDutySets = [
  {
    id: 'dutyset-1',
    type: 'dutyset',
    name: 'Crew Mess',
    board: 'interior',
    assignees: ['user-1'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds1-t1', text: 'Wipe down tables and chairs', frequency: 'daily', completed: false },
      { id: 'ds1-t2', text: 'Vacuum floor', frequency: 'daily', completed: false },
      { id: 'ds1-t3', text: 'Clean coffee machine', frequency: 'daily', completed: false },
      { id: 'ds1-t4', text: 'Deep clean refrigerator', frequency: 'weekly-wednesday', completed: false },
      { id: 'ds1-t5', text: 'Polish all surfaces', frequency: 'weekly-friday', completed: false }
    ],
    notes: [],
    activity: []
  },
  {
    id: 'dutyset-2',
    type: 'dutyset',
    name: "Captain\'s Cabin",
    board: 'interior',
    assignees: ['user-2'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds2-t1', text: 'Make bed with fresh linens', frequency: 'daily', completed: false },
      { id: 'ds2-t2', text: 'Dust all surfaces', frequency: 'daily', completed: false },
      { id: 'ds2-t3', text: 'Empty trash', frequency: 'daily', completed: false },
      { id: 'ds2-t4', text: 'Clean bathroom thoroughly', frequency: 'daily', completed: false },
      { id: 'ds2-t5', text: 'Vacuum and mop floor', frequency: 'weekly-monday', completed: false }
    ],
    notes: [],
    activity: []
  },
  {
    id: 'dutyset-3',
    type: 'dutyset',
    name: 'Pantries',
    board: 'interior',
    assignees: ['user-3'],
    dueDate: new Date()?.toISOString(),
    completed: false,
    tasks: [
      { id: 'ds3-t1', text: 'Wipe down counters', frequency: 'daily', completed: false },
      { id: 'ds3-t2', text: 'Organize supplies', frequency: 'daily', completed: false },
      { id: 'ds3-t3', text: 'Check expiration dates', frequency: 'weekly-tuesday', completed: false },
      { id: 'ds3-t4', text: 'Deep clean shelves', frequency: 'monthly-1', completed: false }
    ],
    notes: [],
    activity: []
  }
];

export const crewMembers = [
  { id: 'user-1', name: 'Sarah Johnson', avatar: 'https://i.pravatar.cc/150?img=1', role: 'crew', department: 'Interior' },
  { id: 'user-2', name: 'Mark Stevens', avatar: 'https://i.pravatar.cc/150?img=2', role: 'crew', department: 'Interior' },
  { id: 'user-3', name: 'Lisa Chen', avatar: 'https://i.pravatar.cc/150?img=3', role: 'crew', department: 'Interior' },
  { id: 'user-4', name: 'Tom Wilson', avatar: 'https://i.pravatar.cc/150?img=4', role: 'crew', department: 'Deck' },
  { id: 'user-5', name: 'Mike Roberts', avatar: 'https://i.pravatar.cc/150?img=5', role: 'crew', department: 'Deck' },
  { id: 'user-6', name: 'John Davis', avatar: 'https://i.pravatar.cc/150?img=6', role: 'crew', department: 'Engineering' }
];