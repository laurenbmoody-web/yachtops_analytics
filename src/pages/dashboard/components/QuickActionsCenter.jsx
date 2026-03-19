import React from 'react';
import Icon from '../../../components/AppIcon';

const QuickActionsCenter = ({ onAddInventory, onLogDelivery, onReportDefect, onCreateJob }) => {
  const actions = [
    { 
      label: 'Add inventory item', 
      icon: 'Plus', 
      onClick: onAddInventory,
      color: 'bg-primary/90 hover:bg-primary'
    },
    { 
      label: 'Log delivery', 
      icon: 'Package', 
      onClick: onLogDelivery,
      color: 'bg-primary/90 hover:bg-primary'
    },
    { 
      label: 'Report defect', 
      icon: 'AlertTriangle', 
      onClick: onReportDefect,
      color: 'bg-primary/90 hover:bg-primary'
    },
    { 
      label: 'Create job', 
      icon: 'CheckSquare', 
      onClick: onCreateJob,
      color: 'bg-primary/90 hover:bg-primary'
    }
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground mb-4">Quick actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions?.map((action, index) => (
          <button
            key={index}
            onClick={action?.onClick}
            className={`${action?.color} text-white rounded-lg p-4 transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2 font-medium text-sm`}
          >
            <Icon name={action?.icon} className="w-5 h-5" />
            {action?.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default QuickActionsCenter;