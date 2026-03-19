import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { getComplianceStatus, getMonthCalendarData, detectBreaches } from '../utils/horStorage';

const CrewHORDrawer = ({ isOpen, onClose, crew, currentMonth, onMonthChange, onNudge, onRequestCorrection }) => {
  const [horData, setHorData] = useState(null);
  const [localMonth, setLocalMonth] = useState(currentMonth);

  useEffect(() => {
    if (isOpen && crew) {
      loadHORData();
    }
  }, [isOpen, crew, localMonth]);

  const loadHORData = () => {
    if (!crew?.id) return;
    
    const complianceStatus = getComplianceStatus(crew?.id);
    const calendarData = getMonthCalendarData(crew?.id, localMonth?.getFullYear(), localMonth?.getMonth());
    const breaches = detectBreaches(crew?.id);
    
    setHorData({
      last24HoursRest: complianceStatus?.last24HoursRest,
      last7DaysRest: complianceStatus?.last7DaysRest,
      isCompliant: complianceStatus?.isCompliant,
      calendarData,
      breaches
    });
  };

  const handleMonthChange = (direction) => {
    const newMonth = new Date(localMonth?.getFullYear(), localMonth?.getMonth() + direction, 1);
    const today = new Date();
    if (newMonth > today) return;
    setLocalMonth(newMonth);
  };

  if (!isOpen) return null;

  const last24HoursRest = horData?.last24HoursRest || 24;
  const last7DaysRest = horData?.last7DaysRest || 168;
  const isCompliant = horData?.isCompliant !== false;
  const breaches = horData?.breaches || [];
  const calendarData = horData?.calendarData || [];

  const getDaysInMonth = (date) => {
    const year = date?.getFullYear();
    const month = date?.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay?.getDate();
    const startingDayOfWeek = firstDay?.getDay();
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(localMonth);
  const monthName = localMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-3xl bg-background z-50 shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div>
              <h2 className="text-xl font-semibold text-foreground">{crew?.fullName} — HOR</h2>
              <p className="text-sm text-muted-foreground mt-1">{crew?.roleTitle} • {crew?.department}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-foreground" />
            </button>
          </div>

          {/* Command Tools */}
          <div className="p-6 border-b border-border bg-muted/20">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => onNudge(crew)}
              >
                <Icon name="Bell" size={16} />
                Nudge to Complete
              </Button>
              <Button
                variant="outline"
                onClick={() => onRequestCorrection(crew)}
              >
                <Icon name="AlertCircle" size={16} />
                Request Correction
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 space-y-6">
            {/* Month Selector */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => handleMonthChange(-1)}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="ChevronLeft" size={18} className="text-foreground" />
              </button>
              <span className="text-sm font-medium text-foreground min-w-[140px] text-center">{monthName}</span>
              <button
                onClick={() => handleMonthChange(1)}
                className="p-2 hover:bg-muted rounded-lg transition-smooth"
              >
                <Icon name="ChevronRight" size={18} className="text-foreground" />
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Last 24 Hours Rest */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Last 24 Hours Rest</h4>
                <div className="text-2xl font-bold text-foreground mb-2">{last24HoursRest} hrs</div>
                <div className="flex items-center gap-2">
                  <Icon 
                    name={last24HoursRest >= 10 ? 'CheckCircle' : 'AlertCircle'} 
                    size={14} 
                    className={last24HoursRest >= 10 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <span className={`text-xs font-medium ${
                    last24HoursRest >= 10 
                      ? 'text-green-600 dark:text-green-400' :'text-red-600 dark:text-red-400'
                  }`}>
                    {last24HoursRest >= 10 ? 'Compliant' : 'Breach'}
                  </span>
                </div>
              </div>

              {/* Last 7 Days Rest */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Last 7 Days Rest</h4>
                <div className="text-2xl font-bold text-foreground mb-2">{last7DaysRest} hrs</div>
                <div className="flex items-center gap-2">
                  <Icon 
                    name={last7DaysRest >= 77 ? 'CheckCircle' : 'AlertCircle'} 
                    size={14} 
                    className={last7DaysRest >= 77 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <span className={`text-xs font-medium ${
                    last7DaysRest >= 77 
                      ? 'text-green-600 dark:text-green-400' :'text-red-600 dark:text-red-400'
                  }`}>
                    {last7DaysRest >= 77 ? 'Compliant' : 'Breach'}
                  </span>
                </div>
              </div>

              {/* Compliance Status */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Compliance Status</h4>
                <div className="flex items-center justify-center h-[calc(100%-1.5rem)]">
                  <span className={`inline-block px-4 py-2 rounded-full text-sm font-bold ${
                    isCompliant 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'}
                  </span>
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h4 className="text-lg font-semibold text-foreground mb-4">Calendar</h4>
              
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-2">
                {/* Day Headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']?.map((day, index) => (
                  <div key={index} className="text-center text-xs font-semibold text-muted-foreground py-2">
                    {day}
                  </div>
                ))}

                {/* Empty cells */}
                {Array.from({ length: startingDayOfWeek })?.map((_, index) => (
                  <div key={`empty-${index}`} className="aspect-square" />
                ))}

                {/* Calendar days */}
                {Array.from({ length: daysInMonth })?.map((_, index) => {
                  const day = index + 1;
                  const dayData = calendarData?.find(d => d?.day === day);
                  const restHours = dayData?.restHours || 24;
                  const status = dayData?.status || 'compliant';

                  let bgColor = 'bg-green-100 dark:bg-green-900/30';
                  let textColor = 'text-green-800 dark:text-green-400';
                  if (status === 'breach') {
                    bgColor = 'bg-red-100 dark:bg-red-900/30';
                    textColor = 'text-red-800 dark:text-red-400';
                  } else if (status === 'warning') {
                    bgColor = 'bg-amber-100 dark:bg-amber-900/30';
                    textColor = 'text-amber-800 dark:text-amber-400';
                  } else if (status === 'pending') {
                    bgColor = 'bg-blue-100 dark:bg-blue-900/30';
                    textColor = 'text-blue-800 dark:text-blue-400';
                  }

                  return (
                    <div
                      key={day}
                      className={`${bgColor} rounded-lg p-3 text-center`}
                    >
                      <div className="text-xs font-semibold text-foreground mb-1">{day}</div>
                      <div className={`text-sm font-bold ${textColor}`}>{restHours?.toFixed(1)} hrs</div>
                      {status === 'pending' && (
                        <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-1">Pending</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-6 mt-6 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800" />
                  <span className="text-xs text-muted-foreground">Compliant</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800" />
                  <span className="text-xs text-muted-foreground">Warning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800" />
                  <span className="text-xs text-muted-foreground">Breach</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800" />
                  <span className="text-xs text-muted-foreground">Pending</span>
                </div>
              </div>
            </div>

            {/* Breaches List */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h4 className="text-lg font-semibold text-foreground mb-4">Breaches</h4>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {breaches?.length > 0 ? (
                  breaches?.map(breach => (
                    <div key={breach?.id} className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Icon name="AlertCircle" size={18} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1">
                            {breach?.displayName || breach?.type}
                          </div>
                          {breach?.helperText && (
                            <div className="text-xs text-muted-foreground mb-2">
                              {breach?.helperText}
                            </div>
                          )}
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            Episode: {breach?.episodeStartDisplay || breach?.windowStart} → {breach?.episodeEndDisplay || breach?.windowEnd}
                          </div>
                          {breach?.affectedShipDates && breach?.affectedShipDates?.length > 0 && (
                            <div className="text-xs text-muted-foreground mb-1">
                              Affected dates: {breach?.affectedShipDates?.join(', ')}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">{breach?.note}</div>
                          {breach?.code && (
                            <div className="text-[10px] text-muted-foreground/70 mt-1">
                              Code: {breach?.code}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <Icon name="CheckCircle" size={32} className="text-green-600 dark:text-green-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No breaches recorded</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CrewHORDrawer;