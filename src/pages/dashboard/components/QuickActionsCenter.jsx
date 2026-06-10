import React from 'react';
import { Plus, Package, Flag, ClipboardCheck } from 'lucide-react';

const QuickActionsCenter = ({ onAddInventory, onLogDelivery, onReportDefect, onCreateJob }) => {
  // Icon tint via CSS-var token classes so the button's hover inversion
  // (hover:text-card) still wins on hover. Flag (defect) in orange, rest navy.
  const actions = [
    { icon: Plus,           label: 'Add inventory item', onClick: onAddInventory, tint: 'ce-qa-navy' },
    { icon: Package,        label: 'Log delivery',        onClick: onLogDelivery,  tint: 'ce-qa-navy' },
    { icon: Flag,           label: 'Report defect',       onClick: onReportDefect, tint: 'ce-qa-orange' },
    { icon: ClipboardCheck, label: 'Create job',          onClick: onCreateJob,    tint: 'ce-qa-navy' },
  ];

  return (
    <div className="flex items-center justify-between px-1 pt-2 pb-10">
      {actions.map(({ icon: Icon, label, onClick, tint }) => (
        <div key={label} className="relative group">
          <button
            onClick={onClick}
            className={`
              w-[72px] h-[72px] rounded-full
              flex items-center justify-center
              bg-card ${tint}
              border-[1.5px] border-foreground border-b-[4px]
              shadow-sm
              transition-all duration-[250ms] ease-out
              hover:bg-foreground hover:text-card hover:border-foreground
              hover:shadow-lg hover:-translate-y-0.5
            `}
          >
            <Icon className="w-7 h-7" />
          </button>
          <span
            className="
              hidden group-hover:block
              absolute top-full left-1/2 -translate-x-1/2 mt-2.5
              whitespace-nowrap text-[11px] font-medium
              text-foreground bg-card
              px-2.5 py-1 rounded-md shadow-md
              pointer-events-none z-50
            "
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default QuickActionsCenter;
