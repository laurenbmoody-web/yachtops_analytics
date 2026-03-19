import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import MonthView from './components/MonthView';
import DayDetailPanel from './components/DayDetailPanel';
import AddEventModal from './components/AddEventModal';
import { loadOpsEvents } from './utils/opsEventStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { getDepartmentScope, setDepartmentScope, isCommandRole, DEPARTMENT_OPTIONS } from '../../utils/departmentScopeStorage';

const OpsVesselCalendar = () => {
  const navigate = useNavigate();
  const { currentUser: authUser } = useAuth();
  const currentUser = getCurrentUser();
  const [selectedDate, setSelectedDate] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [showDayDetail, setShowDayDetail] = useState(false);
  
  // Department scope state (Command only)
  const [departmentScope, setDepartmentScopeState] = useState(() => getDepartmentScope());
  
  // Handle department scope change (Command only)
  const handleDepartmentScopeChange = (newScope) => {
    setDepartmentScope(newScope);
    setDepartmentScopeState(newScope);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    // Department filtering now happens at data level in loadOpsEvents
    const filteredEvents = loadOpsEvents(currentUser || authUser);
    setEvents(filteredEvents);
  };
  
  // Reload events when department scope changes
  useEffect(() => {
    loadData();
  }, [departmentScope]);

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setShowDayDetail(true);
  };

  const handleMonthChange = (newMonth) => {
    setCurrentMonth(newMonth);
  };

  const handleCloseDayDetail = () => {
    setShowDayDetail(false);
    setSelectedDate(null);
  };

  const handleEventChange = () => {
    loadData();
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto pt-24">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Icon name="Calendar" size={28} className="text-primary" />
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-2">Vessel Calendar</h1>
              <p className="text-sm text-muted-foreground">
                Operational events and vessel scheduling
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Department Scope Chip (Command Only) */}
            {isCommandRole(currentUser || authUser) && (
              <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg">
                <span className="text-sm font-medium text-muted-foreground">Department:</span>
                <select
                  value={departmentScope}
                  onChange={(e) => handleDepartmentScopeChange(e?.target?.value)}
                  className="text-sm font-medium text-foreground bg-transparent border-none outline-none cursor-pointer"
                >
                  {DEPARTMENT_OPTIONS?.map(option => (
                    <option key={option?.value} value={option?.value}>
                      {option?.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={() => setShowAddEventModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-smooth font-medium"
            >
              <Icon name="Plus" size={18} />
              Add Event
            </button>
          </div>
        </div>

        {/* Calendar Layout */}
        <div className={`grid gap-6 transition-all duration-300 ${
          showDayDetail ? 'grid-cols-1 lg:grid-cols-[1fr_400px]' : 'grid-cols-1'
        }`}>
          {/* Month View */}
          <div className={showDayDetail ? 'lg:col-span-1' : 'max-w-5xl mx-auto w-full'}>
            <MonthView
              currentMonth={currentMonth}
              onMonthChange={handleMonthChange}
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              events={events}
            />
          </div>

          {/* Day Detail Panel */}
          {showDayDetail && selectedDate && (
            <div className="lg:col-span-1">
              <DayDetailPanel
                selectedDate={selectedDate}
                events={events}
                onClose={handleCloseDayDetail}
                onEventChange={handleEventChange}
              />
            </div>
          )}
        </div>

        {/* Add Event Modal */}
        {showAddEventModal && (
          <AddEventModal
            onClose={() => setShowAddEventModal(false)}
            onSuccess={handleEventChange}
            selectedDate={selectedDate}
          />
        )}
      </main>
    </div>
  );
};

export default OpsVesselCalendar;