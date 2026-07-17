import React from 'react';
import { Package, Truck, ClipboardCheck } from 'lucide-react';
import './QuickActionsCenter.css';

// Defect icon — a navy triangle with a terracotta "!" so the one attention
// action carries a single accent without colouring the whole circle.
const DefectIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" stroke="#C65A1A" />
    <path d="M12 17h.01" stroke="#C65A1A" />
  </svg>
);

const QuickActionsCenter = ({ onAddInventory, onLogDelivery, onReportDefect, onCreateJob }) => {
  // Uniform navy circles; a caption always shown beneath each.
  const actions = [
    { icon: Package,        cap: 'Inventory', label: 'Add inventory item', onClick: onAddInventory },
    { icon: Truck,          cap: 'Delivery',  label: 'Log delivery',       onClick: onLogDelivery },
    { icon: DefectIcon,     cap: 'Defect',    label: 'Report defect',      onClick: onReportDefect },
    { icon: ClipboardCheck, cap: 'Job',       label: 'Create job',         onClick: onCreateJob },
  ];

  return (
    <div className="qac-row">
      {actions.map(({ icon: Icon, cap, label, onClick }) => (
        <div key={cap} className="qac-item">
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
