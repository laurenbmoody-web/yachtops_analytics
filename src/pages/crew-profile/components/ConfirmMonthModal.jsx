import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { showToast } from '../../../utils/toast';
import { confirmMonth } from '../utils/horStorage';
import { getCurrentUser } from '../../../utils/authStorage';

const ConfirmMonthModal = ({ isOpen, onClose, month, onConfirm }) => {
  const [isAttested, setIsAttested] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!isAttested) {
      showToast('Please confirm the attestation checkbox', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const currentUser = getCurrentUser();
      const year = month?.getFullYear();
      const monthNum = month?.getMonth();

      const success = confirmMonth(currentUser?.id, year, monthNum, notes);

      if (success) {
        showToast('Month confirmed successfully', 'success');
        onConfirm?.();
        handleClose();
      } else {
        showToast('Failed to confirm month', 'error');
      }
    } catch (error) {
      console.error('Error confirming month:', error);
      showToast('Failed to confirm month', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsAttested(false);
    setNotes('');
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
            <h2 className="text-xl font-semibold text-foreground">Confirm Month</h2>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} color="var(--color-foreground)" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                You are confirming your Hours of Rest entries for <strong>{monthDisplay}</strong>.
              </p>
              <p className="text-sm text-muted-foreground">
                If corrections are needed later, Command may request updates.
              </p>
            </div>

            {/* Attestation Checkbox */}
            <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg border border-border">
              <Checkbox
                checked={isAttested}
                onCheckedChange={setIsAttested}
                id="attestation"
              />
              <label 
                htmlFor="attestation"
                className="text-sm text-foreground cursor-pointer flex-1"
              >
                I confirm these entries are accurate to the best of my knowledge.
              </label>
            </div>

            {/* Optional Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e?.target?.value)}
                placeholder="Add any additional notes or comments..."
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
              onClick={handleConfirm}
              disabled={!isAttested || isSubmitting}
            >
              {isSubmitting ? 'Confirming...' : 'Confirm Month'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ConfirmMonthModal;