import React, { useState } from 'react';
import { format, isSameDay, parseISO, isWithinInterval, startOfDay } from 'date-fns';
import Icon from '../../../components/AppIcon';

import EditEventModal from './EditEventModal';
import { useAuth } from '../../../contexts/AuthContext';

const DayDetailPanel = ({ selectedDate, events, onClose, onEventChange }) => {
  const { currentUser, isCommand, isChief } = useAuth();
  const [editingEvent, setEditingEvent] = useState(null);

  const eventsForSelectedDate = selectedDate
    ? events?.filter(event => {
        if (!event?.startDate) return false;
        try {
          const eventStart = startOfDay(parseISO(event?.startDate));
          const eventEnd = event?.endDate ? startOfDay(parseISO(event?.endDate)) : eventStart;
          const selectedDay = startOfDay(selectedDate);
          
          // Check if selected date falls within event range
          return isSameDay(eventStart, selectedDay) || 
                 isSameDay(eventEnd, selectedDay) ||
                 isWithinInterval(selectedDay, { start: eventStart, end: eventEnd });
        } catch {
          return false;
        }
      })?.sort((a, b) => {
        const timeA = parseISO(a?.startDate)?.getTime();
        const timeB = parseISO(b?.startDate)?.getTime();
        return timeA - timeB;
      })
    : [];

  const canEditEvent = (event) => {
    if (event?.isPrivate && event?.createdBy !== currentUser?.id) return false;
    if (isCommand) return true;
    return event?.createdBy === currentUser?.id;
  };

  const getCategoryColor = (category) => {
    const colors = {
      'Contractor': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      'Charter': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      'Owner': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      'Yacht Show': 'bg-green-500/10 text-green-600 border-green-500/20',
      'Guest Movement': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
      'Maintenance Window': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      'Other': 'bg-gray-500/10 text-gray-600 border-gray-500/20'
    };
    return colors?.[category] || colors?.['Other'];
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 h-full flex flex-col sticky top-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {format(selectedDate, 'EEEE')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {format(selectedDate, 'MMMM d, yyyy')}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-muted rounded-lg transition-smooth"
          title="Close day detail"
        >
          <Icon name="X" size={18} className="text-muted-foreground" />
        </button>
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {eventsForSelectedDate?.length === 0 ? (
          <div className="text-center py-8">
            <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No events scheduled</p>
          </div>
        ) : (
          eventsForSelectedDate?.map((event) => (
            <div
              key={event?.id}
              className="p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-smooth"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-foreground">{event?.title}</h4>
                    {event?.isPrivate && (
                      <Icon name="Lock" size={14} className="text-muted-foreground" title="Private" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon name="Clock" size={12} />
                    <span>
                      {event?.endDate && !isSameDay(parseISO(event?.startDate), parseISO(event?.endDate)) ? (
                        // Multi-day event: show date range
                        `${format(parseISO(event?.startDate), 'MMM d')} – ${format(parseISO(event?.endDate), 'MMM d')}`
                      ) : (
                        // Single-day event: show time
                        `${format(parseISO(event?.startDate), 'h:mm a')}${event?.endDate ? ` - ${format(parseISO(event?.endDate), 'h:mm a')}` : ''}`
                      )}
                    </span>
                  </div>
                </div>
                {canEditEvent(event) && (
                  <button
                    onClick={() => setEditingEvent(event)}
                    className="p-1 hover:bg-muted rounded transition-smooth"
                    title="Edit event"
                  >
                    <Icon name="Edit" size={14} className="text-muted-foreground" />
                  </button>
                )}
              </div>

              {event?.description && (
                <p className="text-sm text-muted-foreground mb-2">{event?.description}</p>
              )}

              {event?.category && (
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-1 rounded border ${getCategoryColor(event?.category)}`}>
                    {event?.category}
                  </span>
                </div>
              )}

              {event?.location && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon name="MapPin" size={12} />
                  <span>{event?.location}</span>
                </div>
              )}

              {(isCommand || isChief) && event?.visibility && (
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon name="Eye" size={12} />
                    <span>Visible to: {Array.isArray(event?.visibility) ? event?.visibility?.join(', ') : event?.visibility}</span>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Edit Event Modal */}
      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSuccess={() => {
            setEditingEvent(null);
            onEventChange();
          }}
        />
      )}
    </div>
  );
};

export default DayDetailPanel;