import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { updateCrewOnboardStatus, CREW_STATUS, getCurrentVessel } from '../utils/seaTimeStorage';
import { loadUsers } from '../../../utils/authStorage';
import { showToast } from '../../../utils/toast';

const ManageCrewAssignmentModal = ({ isOpen, onClose, onSuccess }) => {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [formData, setFormData] = useState({
    status: CREW_STATUS?.ACTIVE,
    fromDate: new Date()?.toISOString()?.split('T')?.[0],
    toDate: '',
    capacityServed: '',
    watchEligible: false
  });

  if (!isOpen) return null;

  const users = loadUsers();
  const vessel = getCurrentVessel();

  const handleSubmit = (e) => {
    e?.preventDefault();

    if (!selectedUserId || !formData?.capacityServed) {
      showToast('Please select a crew member and enter capacity served', 'error');
      return;
    }

    if (!vessel) {
      showToast('No vessel found', 'error');
      return;
    }

    try {
      updateCrewOnboardStatus(selectedUserId, vessel?.id, formData);
      showToast('Crew assignment updated', 'success');
      onSuccess?.();
      handleClose();
    } catch (error) {
      showToast('Failed to update crew assignment', 'error');
    }
  };

  const handleClose = () => {
    setSelectedUserId('');
    setFormData({
      status: CREW_STATUS?.ACTIVE,
      fromDate: new Date()?.toISOString()?.split('T')?.[0],
      toDate: '',
      capacityServed: '',
      watchEligible: false
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
              <Icon name="Users" size={24} className="text-primary" />
              <h2 className="text-xl font-semibold text-foreground">Manage Crew Assignment</h2>
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
                Crew Member <span className="text-red-500">*</span>
              </label>
              <Select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e?.target?.value)}
              >
                <option value="">Select crew member</option>
                {users?.map(user => (
                  <option key={user?.id} value={user?.id}>
                    {user?.fullName} - {user?.roleTitle}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Status <span className="text-red-500">*</span>
              </label>
              <Select
                value={formData?.status}
                onChange={(e) => setFormData({ ...formData, status: e?.target?.value })}
              >
                <option value={CREW_STATUS?.ACTIVE}>Active</option>
                <option value={CREW_STATUS?.INACTIVE}>Inactive</option>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                From Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={formData?.fromDate}
                onChange={(e) => setFormData({ ...formData, fromDate: e?.target?.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                To Date (optional)
              </label>
              <Input
                type="date"
                value={formData?.toDate}
                onChange={(e) => setFormData({ ...formData, toDate: e?.target?.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Capacity Served <span className="text-red-500">*</span>
              </label>
              <Input
                value={formData?.capacityServed}
                onChange={(e) => setFormData({ ...formData, capacityServed: e?.target?.value })}
                placeholder="e.g., Deck Cadet, OOW, AB, Engineer"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={formData?.watchEligible}
                onChange={(e) => setFormData({ ...formData, watchEligible: e?.target?.checked })}
              />
              <label className="text-sm text-foreground">
                Watch Eligible
              </label>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4">
              <Button type="button" onClick={handleClose} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                Save Assignment
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default ManageCrewAssignmentModal;