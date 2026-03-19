import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';


import TaskDetailModal from '../team-jobs-board-management/components/TaskDetailModal';

const TaskDetailAssignment = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get task from navigation state or use mock data
  const task = location?.state?.task || {
    id: 't1',
    title: 'Restock minibar - Suite 1',
    description: 'Restock all guest cabin minibars with premium beverages',
    assignedTo: ['Mark'],
    assignedBy: 'Chief Stew',
    board: 'interior',
    column: 'today',
    priority: 'high',
    dueDate: new Date(),
    dueTime: '14:00',
    status: 'open',
    completedBy: null,
    completedAt: null,
    notes: [],
    attachments: [],
    checklist: [
      { id: 'c1', text: 'Check inventory', completed: false },
      { id: 'c2', text: 'Restock beverages', completed: false },
      { id: 'c3', text: 'Update log', completed: false }
    ],
    activityLog: [
      { id: 'a1', user: 'Chief Stew', action: 'created task', timestamp: new Date(Date.now() - 3600000) }
    ]
  };
  
  const handleClose = () => {
    navigate('/team-jobs-management');
  };
  
  const handleComplete = (taskId, completedBy) => {
    // In production, this would update the task in the backend
    navigate('/team-jobs-management');
  };
  
  const handleUpdate = (updatedTask) => {
    // In production, this would update the task in the backend
    navigate('/team-jobs-management');
  };
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        <TaskDetailModal
          task={task}
          onClose={handleClose}
          onComplete={handleComplete}
          onUpdate={handleUpdate}
          currentUser="Mark"
          userRole="crew"
        />
      </main>
    </div>
  );
};

export default TaskDetailAssignment;