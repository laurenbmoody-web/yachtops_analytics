import React, { useState, useEffect } from 'react';
import '../../styles/editorial.css';
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
      <main style={{ padding: '26px clamp(16px, 4vw, 40px) 80px', background: '#F8FAFC', minHeight: '100vh' }}>
        {/* Page Header — canonical editorial pair; actions wrap on phones. */}
        <div className="mb-6">
          <p className="editorial-meta">
            <span className="dot">●</span>CALENDAR<span className="bar" /><span className="muted">OPERATIONS</span><span className="bar" /><span className="muted">{events?.length || 0} EVENTS</span>
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="editorial-greeting">VESSEL<span className="period">,</span> <em>on schedule</em><span className="period">.</span></h1>
            <div className="flex flex-wrap items-center gap-3">
              {/* Department Scope Chip (Command Only) */}
              {isCommandRole(currentUser || authUser) && (
                <label className="inline-flex items-center gap-2" style={{ padding: '8px 14px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 999 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#8B8478' }}>Department</span>
                  <select
                    value={departmentScope}
                    onChange={(e) => handleDepartmentScopeChange(e?.target?.value)}
                    style={{ fontSize: 13, fontWeight: 600, color: '#1C1B3A', background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer' }}
                  >
                    {DEPARTMENT_OPTIONS?.map(option => (
                      <option key={option?.value} value={option?.value}>
                        {option?.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                onClick={() => setShowAddEventModal(true)}
                className="inline-flex items-center gap-2 font-semibold text-white"
                style={{ padding: '10px 16px', background: '#C65A1A', borderRadius: 10, fontSize: 13 }}
              >
                <Icon name="Plus" size={16} />
                Add event
              </button>
            </div>
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