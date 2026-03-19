import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { showToast } from '../../../utils/toast';
import { getCurrentUser } from '../../../utils/authStorage';
import { lockMonth } from '../utils/horStorage';

const LockMonthModal = ({ isOpen, onClose, month, onLock }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleLock = async () => {
    setIsSubmitting(true);

    try {
      const currentUser = getCurrentUser();
      const year = month?.getFullYear();
      const monthNum = month?.getMonth();

      const success = lockMonth(year, monthNum, currentUser?.id);

      if (success) {
        showToast('Month locked successfully for all crew', 'success');
        onLock?.();
        onClose();
      } else {
        showToast('Failed to lock month', 'error');
      }
    } catch (error) {
      console.error('Error locking month:', error);
      showToast('Failed to lock month', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const monthDisplay = month?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal */}
        <div 
          className="bg-card rounded-lg shadow-xl max-w-md w-full"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-semibold text-foreground">Lock Month</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} color="var(--color-foreground)" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <Icon name="Lock" size={20} color="#ca8a04" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-900">
                  Lock {monthDisplay} for all crew?
                </p>
                <p className="text-xs text-yellow-700 mt-1">
                  This will prevent all crew members from editing their HOR entries for this month. This action is typically performed for audit finalization.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-foreground">
                Once locked:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                <li>All crew entries for this month become read-only</li>
                <li>Month status changes to "Locked" for all crew</li>
                <li>Audit exports will include locked status</li>
                <li>You can unlock later if needed (with audit trail)</li>
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleLock}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Locking...' : 'Lock Month'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default LockMonthModal;