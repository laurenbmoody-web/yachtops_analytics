import React from 'react';
import Icon from '../../../components/AppIcon';
import { LaundryStatus, LaundryPriority, updateLaundryStatus } from '../utils/laundryStorage';

const LaundryItemRow = ({ item, onUpdate }) => {
  const handleStatusUpdate = (newStatus) => {
    updateLaundryStatus(item?.id, newStatus);
    onUpdate?.();
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case LaundryStatus?.IN_PROGRESS:
        return 'bg-warning/10 text-warning';
      case LaundryStatus?.READY_TO_DELIVER:
        return 'bg-primary/10 text-primary';
      case LaundryStatus?.DELIVERED:
        return 'bg-success/10 text-success';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };
  
  const getStatusLabel = (status) => {
    switch (status) {
      case LaundryStatus?.IN_PROGRESS:
        return 'In Progress';
      case LaundryStatus?.READY_TO_DELIVER:
        return 'Ready to Deliver';
      case LaundryStatus?.DELIVERED:
        return 'Delivered';
      default:
        return status;
    }
  };
  
  const getOwnerTypeBadge = (ownerType) => {
    const normalizedType = (ownerType || 'unknown')?.toLowerCase();
    switch (normalizedType) {
      case 'guest':
        return { label: 'Guest', color: 'bg-blue-500/10 text-blue-600' };
      case 'crew':
        return { label: 'Crew', color: 'bg-purple-500/10 text-purple-600' };
      default:
        return { label: 'Unknown', color: 'bg-gray-500/10 text-gray-600' };
    }
  };
  
  const ownerBadge = getOwnerTypeBadge(item?.ownerType);
  
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-smooth">
      <div className="flex gap-4">
        {/* Photo Thumbnail */}
        <div className="flex-shrink-0">
          {item?.photo ? (
            <img
              src={item?.photo}
              alt={item?.description}
              className="w-20 h-20 object-cover rounded-lg"
            />
          ) : (
            <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
              <Icon name="Image" size={32} className="text-muted-foreground" />
            </div>
          )}
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title Row */}
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground truncate">
                {item?.description || 'No description'}
              </h3>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${ownerBadge?.color}`}>
                  {ownerBadge?.label}
                </span>
                {item?.ownerName && (
                  <>
                    <span>•</span>
                    <span className="font-medium">{item?.ownerName}</span>
                  </>
                )}
                {item?.area && (
                  <>
                    <span>•</span>
                    <span>{item?.area}</span>
                  </>
                )}
              </div>
              
              {/* Tags */}
              {item?.tags && item?.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {item?.tags?.map((tag, index) => (
                    <span
                      key={index}
                      className="px-2 py-0.5 bg-muted text-muted-foreground rounded text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            {/* Status & Priority */}
            <div className="flex flex-col items-end gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(item?.status)}`}>
                {getStatusLabel(item?.status)}
              </span>
              {item?.priority === LaundryPriority?.URGENT && (
                <span className="px-2 py-0.5 bg-error/10 text-error rounded text-xs font-medium flex items-center gap-1">
                  <Icon name="AlertCircle" size={12} />
                  Urgent
                </span>
              )}
            </div>
          </div>
          
          {/* Quick Actions */}
          <div className="flex items-center gap-2 mt-3">
            {item?.status === LaundryStatus?.IN_PROGRESS && (
              <button
                onClick={() => handleStatusUpdate(LaundryStatus?.READY_TO_DELIVER)}
                className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-smooth flex items-center gap-1"
              >
                <Icon name="CheckCircle" size={14} />
                Ready to Deliver
              </button>
            )}
            
            {item?.status === LaundryStatus?.READY_TO_DELIVER && (
              <button
                onClick={() => handleStatusUpdate(LaundryStatus?.DELIVERED)}
                className="px-3 py-1.5 bg-success text-white rounded-lg text-sm font-medium hover:bg-success/90 transition-smooth flex items-center gap-1"
              >
                <Icon name="Package" size={14} />
                Mark Delivered
              </button>
            )}
            
            {item?.status === LaundryStatus?.DELIVERED && item?.deliveredAt && (
              <span className="text-xs text-muted-foreground">
                Delivered: {new Date(item.deliveredAt)?.toLocaleString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LaundryItemRow;