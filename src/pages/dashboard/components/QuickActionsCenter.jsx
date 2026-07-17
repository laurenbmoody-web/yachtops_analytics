import React from 'react';
import { Package, Truck, AlertTriangle, ClipboardCheck } from 'lucide-react';
import './QuickActionsCenter.css';

const QuickActionsCenter = ({ onAddInventory, onLogDelivery, onReportDefect, onCreateJob }) => {
  // Refined circles on the cool dashboard ground — caption always shown, and
  // the terracotta accent reserved for Report defect.
  const actions = [
    { icon: Package,        cap: 'Inventory', label: 'Add inventory item', onClick: onAddInventory },
    { icon: Truck,          cap: 'Delivery',  label: 'Log delivery',       onClick: onLogDelivery },
    { icon: AlertTriangle,  cap: 'Defect',    label: 'Report defect',      onClick: onReportDefect, defect: true },
    { icon: ClipboardCheck, cap: 'Job',       label: 'Create job',         onClick: onCreateJob },
  ];

  return (
    <div className="qac-row">
      {actions.map(({ icon: Icon, cap, label, onClick, defect }) => (
        <div key={cap} className={`qac-item${defect ? ' is-defect' : ''}`}>
          <button type="button" className="qac-btn" onClick={onClick} aria-label={label} title={label}>
            <Icon strokeWidth={1.75} />
          </button>
          <span className="qac-cap">{cap}</span>
        </div>
      ))}
    </div>
  );
};

export default QuickActionsCenter;
