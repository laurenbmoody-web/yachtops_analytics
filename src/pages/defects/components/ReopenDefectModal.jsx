import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ReopenDefectModal = ({ defect, onClose, onConfirm }) => {
  const [reopenNotes, setReopenNotes] = useState('');
  const [error, setError] = useState('');
  
  const handleSubmit = () => {
    if (!reopenNotes?.trim()) {
      setError('Re-open notes are required');
      return;
    }
    
    onConfirm({ reopenNotes: reopenNotes?.trim() });
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Re-open defect?</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted/50 rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              You are about to re-open: <span className="font-medium text-foreground">{defect?.title}</span>
            </p>
          </div>
          
          {/* Re-open Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Re-open notes <span className="text-error">*</span>
            </label>
            <textarea
              value={reopenNotes}
              onChange={(e) => {
                setReopenNotes(e?.target?.value);
                setError('');
              }}
              placeholder="Explain why this defect needs to be re-opened..."
              rows={4}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            {error && (
              <p className="text-xs text-error mt-1">{error}</p>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="border-t border-border px-6 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-smooth"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth"
          >
            Re-open
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReopenDefectModal;