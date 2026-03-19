import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import LaundryItemRow from '../laundry-management-dashboard/components/LaundryItemRow';
import {
  getLaundryItemsByDeliveredDate,
  getDeliveredDates,
  LaundryStatus
} from '../laundry-management-dashboard/utils/laundryStorage';

const LaundryCalendarHistoryView = () => {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [laundryItems, setLaundryItems] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  useEffect(() => {
    loadAvailableDates();
  }, []);
  
  useEffect(() => {
    loadLaundryForDate();
  }, [selectedDate]);
  
  const loadAvailableDates = () => {
    const dates = getDeliveredDates();
    setAvailableDates(dates);
  };
  
  const loadLaundryForDate = () => {
    const dateKey = selectedDate?.toISOString()?.split('T')?.[0];
    const items = getLaundryItemsByDeliveredDate(dateKey);
    setLaundryItems(items);
  };
  
  const getDaysInMonth = (date) => {
    const year = date?.getFullYear();
    const month = date?.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay?.getDate();
    const startingDayOfWeek = firstDay?.getDay();
    
    return { daysInMonth, startingDayOfWeek, year, month };
  };
  
  const isDateAvailable = (date) => {
    const dateStr = date?.toISOString()?.split('T')?.[0];
    return availableDates?.includes(dateStr);
  };
  
  const isSelectedDate = (date) => {
    return date?.toDateString() === selectedDate?.toDateString();
  };
  
  const handleDateClick = (date) => {
    setSelectedDate(date);
  };
  
  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  
  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  
  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(today);
  };
  
  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);
  const monthName = currentMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  
  const getStatusCounts = () => {
    // History view shows delivered items only
    return {
      inProgress: 0,
      ready: 0,
      delivered: laundryItems?.filter(item => item?.status === LaundryStatus?.DELIVERED)?.length,
      total: laundryItems?.length
    };
  };
  
  const counts = getStatusCounts();
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Laundry History</h1>
              <p className="text-sm text-muted-foreground mt-1">Browse delivered laundry by date</p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate('/laundry')}
              iconName="ArrowLeft"
            >
              Back to Today
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Panel */}
          <div className="lg:col-span-1">
            <div className="bg-card border border-border rounded-xl p-6">
              {/* Calendar Header */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handlePrevMonth}
                  className="p-2 hover:bg-muted rounded-lg transition-smooth"
                >
                  <Icon name="ChevronLeft" size={20} className="text-foreground" />
                </button>
                <h3 className="text-lg font-semibold text-foreground">{monthName}</h3>
                <button
                  onClick={handleNextMonth}
                  className="p-2 hover:bg-muted rounded-lg transition-smooth"
                >
                  <Icon name="ChevronRight" size={20} className="text-foreground" />
                </button>
              </div>
              
              <button
                onClick={handleToday}
                className="w-full mb-4 px-3 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-smooth"
              >
                Go to Today
              </button>
              
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {/* Day Headers */}
                {['S', 'M', 'T', 'W', 'T', 'F', 'S']?.map((day, index) => (
                  <div key={index} className="text-center text-xs font-medium text-muted-foreground py-2">
                    {day}
                  </div>
                ))}
                
                {/* Empty cells for days before month starts */}
                {Array.from({ length: startingDayOfWeek })?.map((_, index) => (
                  <div key={`empty-${index}`} className="aspect-square" />
                ))}
                
                {/* Calendar days */}
                {Array.from({ length: daysInMonth })?.map((_, index) => {
                  const day = index + 1;
                  const date = new Date(year, month, day);
                  const hasData = isDateAvailable(date);
                  const isSelected = isSelectedDate(date);
                  const isToday = date?.toDateString() === new Date()?.toDateString();
                  
                  return (
                    <button
                      key={day}
                      onClick={() => handleDateClick(date)}
                      className={`aspect-square rounded-lg text-sm font-medium transition-smooth relative ${
                        isSelected
                          ? 'bg-primary text-white'
                          : hasData
                          ? 'bg-muted text-foreground hover:bg-muted/80 cursor-pointer'
                          : 'text-muted-foreground hover:bg-muted/50 cursor-pointer'
                      } ${
                        isToday && !isSelected ? 'ring-2 ring-primary ring-offset-2' : ''
                      }`}
                    >
                      {day}
                      {hasData && !isSelected && (
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
              
              {/* Legend */}
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-3 h-3 bg-primary rounded-full" />
                  <span>Has laundry records</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-3 h-3 border-2 border-primary rounded-full" />
                  <span>Today</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Items Panel */}
          <div className="lg:col-span-2">
            {/* Selected Date Header */}
            <div className="bg-card border border-border rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    {selectedDate?.toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {counts?.total} item{counts?.total !== 1 ? 's' : ''} delivered
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-success">{counts?.delivered}</p>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Items List */}
            <div className="space-y-3">
              {laundryItems?.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-semibold text-foreground">No delivered items for this date</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select a date with delivered items from the calendar
                  </p>
                </div>
              ) : (
                laundryItems?.map(item => (
                  <LaundryItemRow
                    key={item?.id}
                    item={item}
                    onUpdate={() => {}} // Read-only in history view
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LaundryCalendarHistoryView;