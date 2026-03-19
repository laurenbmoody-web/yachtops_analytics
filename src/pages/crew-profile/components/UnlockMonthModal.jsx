import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

import { showToast } from '../../../utils/toast';
import { getCurrentUser } from '../../../utils/authStorage';
import { unlockMonth } from '../utils/horStorage';

const UnlockMonthModal = ({ isOpen, onClose, month, onUnlock }) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleUnlock = async () => {
    if (!reason?.trim()) {
      showToast('Please provide a reason for unlocking', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const currentUser = getCurrentUser();
      const year = month?.getFullYear();
      const monthNum = month?.getMonth();

      const success = unlockMonth(year, monthNum, currentUser?.id, reason);

      if (success) {
        showToast('Month unlocked successfully', 'success');
        onUnlock?.();
        handleClose();
      } else {
        showToast('Failed to unlock month', 'error');
      }
    } catch (error) {
      console.error('Error unlocking month:', error);
      showToast('Failed to unlock month', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  const monthDisplay = month?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal */}
        <div 
          className="bg-card rounded-lg shadow-xl max-w-md w-full"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-semibold text-foreground">Unlock Month</h2>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} color="var(--color-foreground)" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <Icon name="AlertTriangle" size={20} color="#dc2626" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">
                  Unlock {monthDisplay}?
                </p>
                <p className="text-xs text-red-700 mt-1">
                  This will allow crew to edit their entries again. This action will be logged in the audit trail.
                </p>
              </div>
            </div>

            {/* Mandatory Reason */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Reason for unlocking <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e?.target?.value)}
                placeholder="Explain why this month needs to be unlocked..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                rows={3}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUnlock}
              disabled={!reason?.trim() || isSubmitting}
            >
              {isSubmitting ? 'Unlocking...' : 'Unlock Month'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default UnlockMonthModal;