import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { addVesselServiceLogEntry, VESSEL_STATUS, getCurrentVessel } from '../utils/seaTimeStorage';
import { showToast } from '../../../utils/toast';
import { getCurrentUser } from '../../../utils/authStorage';

const AddVesselLogModal = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    fromDateTime: '',
    toDateTime: '',
    status: VESSEL_STATUS?.UNDERWAY,
    miles: '',
    notes: ''
  });

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e?.preventDefault();

    if (!formData?.fromDateTime || !formData?.toDateTime) {
      showToast('Please fill in start and end date/time', 'error');
      return;
    }

    if (new Date(formData.fromDateTime) > new Date(formData.toDateTime)) {
      showToast('End date/time must be after start date/time', 'error');
      return;
    }

    try {
      const vessel = getCurrentVessel();
      if (!vessel) {
        showToast('No vessel found', 'error');
        return;
      }

      const currentUser = getCurrentUser();
      addVesselServiceLogEntry(vessel?.id, formData, currentUser?.fullName || 'Command');
      showToast('Vessel service log entry added', 'success');
      onSuccess?.();
      handleClose();
    } catch (error) {
      showToast('Failed to add vessel log entry', 'error');
    }
  };

  const handleClose = () => {
    setFormData({
      fromDateTime: '',
      toDateTime: '',
      status: VESSEL_STATUS?.UNDERWAY,
      miles: '',
      notes: ''
    });
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal */}
        <div
          className="bg-background border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-background border-b border-border p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icon name="Plus" size={24} className="text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Add Vessel Log Period</h2>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-accent rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                From Date/Time <span className="text-red-500">*</span>
              </label>
              <Input
                type="datetime-local"
                value={formData?.fromDateTime}
                onChange={(e) => setFormData({ ...formData, fromDateTime: e?.target?.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                To Date/Time <span className="text-red-500">*</span>
              </label>
              <Input
                type="datetime-local"
                value={formData?.toDateTime}
                onChange={(e) => setFormData({ ...formData, toDateTime: e?.target?.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Status <span className="text-red-500">*</span>
              </label>
              <Select
                value={formData?.status}
                onChange={(e) => setFormData({ ...formData, status: e?.target?.value })}
              >
                <option value={VESSEL_STATUS?.UNDERWAY}>Underway</option>
                <option value={VESSEL_STATUS?.ANCHOR}>At Anchor</option>
                <option value={VESSEL_STATUS?.IN_PORT}>In Port</option>
                <option value={VESSEL_STATUS?.IN_YARD}>In Yard</option>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Miles (optional)
              </label>
              <Input
                type="number"
                value={formData?.miles}
                onChange={(e) => setFormData({ ...formData, miles: e?.target?.value })}
                placeholder="Enter miles covered"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Notes
              </label>
              <textarea
                value={formData?.notes}
                onChange={(e) => setFormData({ ...formData, notes: e?.target?.value })}
                placeholder="Add any notes about this period..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[100px]"
              />
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
              <p className="text-xs text-blue-600 dark:text-blue-400">
                This log entry will automatically populate sea service days for all active crew members.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4">
              <Button type="button" onClick={handleClose} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                Add Log Entry
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default AddVesselLogModal;