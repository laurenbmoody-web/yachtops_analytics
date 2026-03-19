import React from 'react';
import Icon from '../../../components/AppIcon';
import { MaritalStatus, getMaritalStatusDisplay } from '../utils/guestStorage';

const GuestListItem = ({ guest, isSelected, onClick }) => {
  const getMaritalIcon = (status) => {
    switch (status) {
      case MaritalStatus?.MARRIED:
      case MaritalStatus?.PARTNERED:
        return 'Heart';
      case MaritalStatus?.SINGLE:
        return 'User';
      case MaritalStatus?.DIVORCED:
      case MaritalStatus?.WIDOWED:
        return 'UserX';
      default:
        return 'User';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 rounded-xl border transition-all text-left ${
        isSelected
          ? 'bg-primary/10 border-primary' :'bg-card border-border hover:border-primary/50'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex-shrink-0">
          {guest?.photo?.dataUrl ? (
            <img
              src={guest?.photo?.dataUrl}
              alt={`${guest?.firstName} ${guest?.lastName}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-primary/20">
              <Icon name="User" size={24} className="text-primary" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">
              {guest?.firstName} {guest?.lastName}
            </h3>
            {guest?.isActiveOnTrip && (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-700 dark:text-green-400 rounded-full flex-shrink-0">
                Active
              </span>
            )}
            {guest?.maritalStatus && guest?.maritalStatus !== MaritalStatus?.UNKNOWN && (
              <Icon
                name={getMaritalIcon(guest?.maritalStatus)}
                size={14}
                className="text-muted-foreground flex-shrink-0"
                title={getMaritalStatusDisplay(guest?.maritalStatus)}
              />
            )}
          </div>
          {(guest?.cabinLocationLabel || guest?.cabinAllocated) && (
            <p className="text-sm text-muted-foreground truncate">
              {guest?.cabinLocationLabel || guest?.cabinAllocated}
            </p>
          )}
        </div>

        {/* Selection Indicator */}
        {isSelected && (
          <Icon name="ChevronRight" size={20} className="text-primary flex-shrink-0" />
        )}
      </div>
    </button>
  );
};

export default GuestListItem;