import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, startOfWeek, endOfWeek } from 'date-fns';

const SeaTimeCalendar = ({ userId, currentMonth, onMonthChange, onDateSelect, calendarData }) => {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const handlePrevMonth = () => {
    onMonthChange(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    onMonthChange(addMonths(currentMonth, 1));
  };

  const handleToday = () => {
    onMonthChange(new Date());
  };

  const getColorClass = (colorState) => {
    switch (colorState) {
      case 'green':
        return 'bg-green-500/20 border-green-500 text-green-700 dark:text-green-400';
      case 'yellow':
        return 'bg-yellow-500/20 border-yellow-500 text-yellow-700 dark:text-yellow-400';
      case 'white':
        return 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300';
      case 'blue-striped':
        return 'bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-400 bg-stripes';
      default:
        return 'bg-card border-border text-muted-foreground';
    }
  };

  const getLabel = (colorState) => {
    switch (colorState) {
      case 'green':
        return 'Q';
      case 'yellow':
        return 'Q';
      case 'white':
        return 'M';
      case 'blue-striped':
        return '—';
      default:
        return '';
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            onClick={handlePrevMonth}
            variant="outline"
            className="px-3 py-2"
          >
            <Icon name="ChevronLeft" size={18} />
          </Button>
          <h3 className="text-lg font-semibold text-foreground min-w-[180px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <Button
            onClick={handleNextMonth}
            variant="outline"
            className="px-3 py-2"
          >
            <Icon name="ChevronRight" size={18} />
          </Button>
        </div>
        <Button onClick={handleToday} variant="outline">
          Today
        </Button>
      </div>
      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2">
        {/* Day Headers */}
        {dayNames?.map(day => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}

        {/* Calendar Days */}
        {calendarDays?.map((day, index) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayData = calendarData?.[dateStr];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const colorState = dayData?.colorState || 'default';

          return (
            <button
              key={index}
              onClick={() => onDateSelect(day, dayData)}
              className={`
                aspect-square p-2 rounded-lg border-2 transition-all
                ${getColorClass(colorState)}
                ${!isCurrentMonth ? 'opacity-30' : ''}
                hover:ring-2 hover:ring-primary/50
                flex flex-col items-center justify-center
              `}
            >
              <span className="text-sm font-medium">
                {format(day, 'd')}
              </span>
              {dayData && (
                <span className="text-xs font-bold mt-1">
                  {getLabel(colorState)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Legend */}
      <div className="mt-6 pt-6 border-t border-border">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-green-500/20 border-2 border-green-500"></div>
            <span className="text-muted-foreground">Qualifying & Verified</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-yellow-500/20 border-2 border-yellow-500"></div>
            <span className="text-muted-foreground">Pending Verification</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600"></div>
            <span className="text-muted-foreground">Manual Entry</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-500/10 border-2 border-blue-500 bg-stripes"></div>
            <span className="text-muted-foreground">Not Qualifying</span>
          </div>
        </div>
      </div>
      <style jsx>{`
        .bg-stripes {
          background-image: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 4px,
            rgba(59, 130, 246, 0.1) 4px,
            rgba(59, 130, 246, 0.1) 8px
          );
        }
      `}</style>
    </div>
  );
};

export default SeaTimeCalendar;