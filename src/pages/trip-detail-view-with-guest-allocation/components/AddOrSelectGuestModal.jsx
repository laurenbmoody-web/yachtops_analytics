import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import AddGuestModal from '../../guest-management-dashboard/components/AddGuestModal';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';

const AddOrSelectGuestModal = ({ isOpen, onClose, onSelectExisting, onCreateNew, currentTripGuests }) => {
  const [mode, setMode] = useState(null); // null, 'select', 'create'
  const [availableGuests, setAvailableGuests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddGuestModal, setShowAddGuestModal] = useState(false);

  useEffect(() => {
    if (isOpen && mode === 'select') {
      // Load guests that are not already active on this trip
      const allGuests = loadGuests()?.filter(g => !g?.isDeleted);
      const currentGuestIds = currentTripGuests?.filter(tg => tg?.isActive)?.map(tg => tg?.guestId) || [];
      const available = allGuests?.filter(g => !currentGuestIds?.includes(g?.id));
      setAvailableGuests(available);
    }
  }, [isOpen, mode, currentTripGuests]);

  const handleClose = () => {
    setMode(null);
    setSearchQuery('');
    onClose();
  };

  const handleSelectGuest = (guest) => {
    onSelectExisting(guest);
    handleClose();
  };

  const handleCreateNewGuest = (guestData) => {
    onCreateNew(guestData);
    setShowAddGuestModal(false);
    handleClose();
  };

  const filteredGuests = availableGuests?.filter(g => {
    const query = searchQuery?.toLowerCase();
    return (
      g?.firstName?.toLowerCase()?.includes(query) ||
      g?.lastName?.toLowerCase()?.includes(query) ||
      g?.contactEmail?.toLowerCase()?.includes(query)
    );
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-semibold text-foreground">
              {mode === null && 'Add Guest to Trip'}
              {mode === 'select' && 'Select Existing Guest'}
              {mode === 'create' && 'Create New Guest'}
            </h2>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-smooth"
            >
              <Icon name="X" size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {mode === null && (
              <div className="space-y-4">
                <p className="text-muted-foreground mb-6">
                  Choose how you'd like to add a guest to this trip:
                </p>
                <button
                  onClick={() => setMode('select')}
                  className="w-full p-6 bg-muted/50 hover:bg-muted border border-border rounded-xl transition-smooth text-left group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-smooth">
                      <Icon name="Users" size={24} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground mb-1">Select Existing Guest</h3>
                      <p className="text-sm text-muted-foreground">
                        Choose from guests already in your system and add them to this trip
                      </p>
                    </div>
                    <Icon name="ChevronRight" size={20} className="text-muted-foreground group-hover:text-foreground transition-smooth" />
                  </div>
                </button>

                <button
                  onClick={() => {
                    setMode('create');
                    setShowAddGuestModal(true);
                  }}
                  className="w-full p-6 bg-muted/50 hover:bg-muted border border-border rounded-xl transition-smooth text-left group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-smooth">
                      <Icon name="UserPlus" size={24} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground mb-1">Create New Guest</h3>
                      <p className="text-sm text-muted-foreground">
                        Add a new guest to your system and automatically add them to this trip
                      </p>
                    </div>
                    <Icon name="ChevronRight" size={20} className="text-muted-foreground group-hover:text-foreground transition-smooth" />
                  </div>
                </button>
              </div>
            )}

            {mode === 'select' && (
              <div className="space-y-4">
                <button
                  onClick={() => setMode(null)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
                >
                  <Icon name="ArrowLeft" size={16} />
                  Back to options
                </button>

                {/* Search */}
                <div className="relative">
                  <Icon name="Search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search guests by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e?.target?.value)}
                    className="w-full pl-10 pr-4 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Guest List */}
                {filteredGuests?.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredGuests?.map(guest => (
                      <button
                        key={guest?.id}
                        onClick={() => handleSelectGuest(guest)}
                        className="w-full p-4 bg-muted/50 hover:bg-muted border border-border rounded-lg transition-smooth text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                            {guest?.firstName?.[0]}{guest?.lastName?.[0]}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-foreground">
                              {guest?.firstName} {guest?.lastName}
                            </h4>
                            {guest?.contactEmail && (
                              <p className="text-sm text-muted-foreground">{guest?.contactEmail}</p>
                            )}
                          </div>
                          <Icon name="Plus" size={20} className="text-muted-foreground group-hover:text-primary transition-smooth" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Icon name="Users" size={48} className="text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchQuery ? 'No guests found matching your search' : 'No available guests to add'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {mode === null && (
            <div className="flex justify-end gap-3 p-6 border-t border-border">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
      {/* Add Guest Modal */}
      {showAddGuestModal && (
        <AddGuestModal
          isOpen={showAddGuestModal}
          onClose={() => {
            setShowAddGuestModal(false);
            setMode(null);
          }}
          onSave={handleCreateNewGuest}
          editingGuest={null}
        />
      )}
    </>
  );
};

export default AddOrSelectGuestModal;