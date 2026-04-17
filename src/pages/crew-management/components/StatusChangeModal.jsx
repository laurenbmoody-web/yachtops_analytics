import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { CREW_STATUSES, getStatusDotClass } from '../../../utils/crewStatus';

const StatusChangeModal = ({ isOpen, onClose, onConfirm, memberName, currentStatus, saving }) => {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || 'active');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedStatus(currentStatus || 'active');
      setNotes('');
    }
  }, [isOpen, currentStatus]);

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-sm w-full p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">Change Status</h3>
            {memberName && (
              <p className="text-sm text-muted-foreground mt-0.5">{memberName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={saving}
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Status selector */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">New Status</label>
            <div className="space-y-1.5">
              {CREW_STATUSES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSelectedStatus(s.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    selectedStatus === s.value
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStatusDotClass(s.value)}`} />
                  <span className="font-medium">{s.label}</span>
                  {s.value === currentStatus && (
                    <span className="ml-auto text-xs text-muted-foreground italic">current</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1 block">
              Note{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. 'Returning 15 May — crew changeover'"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selectedStatus, notes)}
            disabled={saving || selectedStatus === currentStatus}
            className="flex-1"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default StatusChangeModal;
