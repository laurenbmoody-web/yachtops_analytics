import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { showToast } from '../../../utils/toast';
import { createCorrectionRequest } from '../utils/horStorage';

const RequestCorrectionModal = ({ isOpen, onClose, crew, currentMonth }) => {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [message, setMessage] = useState('');
  const [selectedDates, setSelectedDates] = useState([]);
  const [showDatePicker, setShowDatePicker] = useState(false);

  if (!isOpen) return null;

  const getDaysInMonth = (date) => {
    const year = date?.getFullYear();
    const month = date?.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay?.getDate();
    const startingDayOfWeek = firstDay?.getDay();
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(selectedMonth);
  const monthName = selectedMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const handleDateToggle = (day) => {
    const dateStr = new Date(year, month, day)?.toISOString()?.split('T')?.[0];
    setSelectedDates(prev => {
      if (prev?.includes(dateStr)) {
        return prev?.filter(d => d !== dateStr);
      } else {
        return [...prev, dateStr];
      }
    });
  };

  const handleSend = () => {
    if (!message?.trim()) {
      showToast('Please enter a correction message', 'error');
      return;
    }

    createCorrectionRequest({
      crewId: crew?.id,
      crewName: crew?.fullName,
      month: selectedMonth,
      message,
      dates: selectedDates
    });

    showToast(`Correction request sent to ${crew?.fullName}`, 'success');
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl z-50 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Request Correction</h2>
              <p className="text-sm text-muted-foreground mt-1">{crew?.fullName} • {crew?.roleTitle}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-foreground" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Month Selector */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Month</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const newMonth = new Date(selectedMonth?.getFullYear(), selectedMonth?.getMonth() - 1, 1);
                    setSelectedMonth(newMonth);
                  }}
                  className="p-2 hover:bg-muted rounded-lg transition-smooth"
                >
                  <Icon name="ChevronLeft" size={18} className="text-foreground" />
                </button>
                <span className="flex-1 text-center text-sm font-medium text-foreground">{monthName}</span>
                <button
                  onClick={() => {
                    const newMonth = new Date(selectedMonth?.getFullYear(), selectedMonth?.getMonth() + 1, 1);
                    const today = new Date();
                    if (newMonth <= today) {
                      setSelectedMonth(newMonth);
                    }
                  }}
                  className="p-2 hover:bg-muted rounded-lg transition-smooth"
                >
                  <Icon name="ChevronRight" size={18} className="text-foreground" />
                </button>
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">What needs correcting? *</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e?.target?.value)}
                placeholder="Describe the correction needed..."
                rows={4}
                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            {/* Date Picker Toggle */}
            <div>
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Icon name={showDatePicker ? 'ChevronUp' : 'ChevronDown'} size={16} />
                {showDatePicker ? 'Hide' : 'Show'} specific dates (optional)
              </button>
            </div>

            {/* Date Picker */}
            {showDatePicker && (
              <div className="bg-muted/30 rounded-xl p-4">
                <div className="text-sm font-medium text-foreground mb-3">
                  Select specific dates ({selectedDates?.length} selected)
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {/* Day Headers */}
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S']?.map((day, index) => (
                    <div key={index} className="text-center text-xs font-semibold text-muted-foreground py-1">
                      {day}
                    </div>
                  ))}

                  {/* Empty cells */}
                  {Array.from({ length: startingDayOfWeek })?.map((_, index) => (
                    <div key={`empty-${index}`} />
                  ))}

                  {/* Calendar days */}
                  {Array.from({ length: daysInMonth })?.map((_, index) => {
                    const day = index + 1;
                    const dateStr = new Date(year, month, day)?.toISOString()?.split('T')?.[0];
                    const isSelected = selectedDates?.includes(dateStr);

                    return (
                      <button
                        key={day}
                        onClick={() => handleDateToggle(day)}
                        className={`aspect-square rounded-lg text-xs font-medium transition-smooth ${
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background hover:bg-muted text-foreground'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4 border-t border-border">
              <Button variant="outline" onClick={onClose} fullWidth>
                Cancel
              </Button>
              <Button onClick={handleSend} fullWidth>
                <Icon name="Send" size={18} />
                Send Request
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default RequestCorrectionModal;