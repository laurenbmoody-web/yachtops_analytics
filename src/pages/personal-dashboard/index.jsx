import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns';

const PersonalDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guardCheckComplete, setGuardCheckComplete] = useState(false);
  
  // Profile widget data
  const [profileCompletion, setProfileCompletion] = useState(0);
  const [missingFields, setMissingFields] = useState([]);
  
  // Calendar widget data
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [monthEvents, setMonthEvents] = useState([]);
  
  // Lists widget data
  const [todayTasks, setTodayTasks] = useState([]);
  const [todayTasksCount, setTodayTasksCount] = useState(0);
  
  // Quick add modals
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskDueDate, setTaskDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [eventTitle, setEventTitle] = useState('');
  const [eventStartAt, setEventStartAt] = useState('');
  const [newListTitle, setNewListTitle] = useState('');

  useEffect(() => {
    checkAccessAndLoadData();
  }, []);

  const checkAccessAndLoadData = async () => {
    try {
      setLoading(true);
      
      console.log('PersonalDashboard: Loading data...');
      
      const { data: { user }, error: authError } = await supabase?.auth?.getUser();
      if (authError || !user) {
        console.error('PersonalDashboard: Auth error:', authError);
        // DO NOT redirect here - ProtectedRoute handles this
        return;
      }
      
      console.log('PersonalDashboard: User authenticated', { uid: user?.id });
      
      // Fetch profile data (no guard check, routing handled by /dashboard)
      const { data: profileData, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, email')
        ?.eq('id', user?.id)
        ?.single();
      
      if (profileError) {
        console.error('PersonalDashboard: Profile fetch error:', profileError);
        // Continue without profile data
      }
      
      console.log('PersonalDashboard: Profile loaded');
      
      setUserId(user?.id);
      setProfile(profileData);
      setGuardCheckComplete(true);
      
      await calculateProfileCompletion(profileData, user?.id);
      await loadCalendarData(user?.id);
      await loadTasksData(user?.id);
      
      setLoading(false);
    } catch (err) {
      console.error('PersonalDashboard: Error loading dashboard:', err);
      setLoading(false);
    }
  };

  const loadCalendarData = async (uid) => {
    try {
      // Load upcoming events (next 5)
      const today = new Date()?.toISOString();
      const { data: upcomingData } = await supabase
        ?.from('personal_calendar_events')
        ?.select('*')
        ?.eq('user_id', uid)
        ?.gte('start_at', today)
        ?.order('start_at', { ascending: true })
        ?.limit(5);
      
      setUpcomingEvents(upcomingData || []);
      
      // Load month events
      const monthStart = startOfMonth(currentMonth)?.toISOString();
      const monthEnd = endOfMonth(currentMonth)?.toISOString();
      const { data: monthData } = await supabase
        ?.from('personal_calendar_events')
        ?.select('*')
        ?.eq('user_id', uid)
        ?.gte('start_at', monthStart)
        ?.lte('start_at', monthEnd);
      
      setMonthEvents(monthData || []);
    } catch (err) {
      console.error('Error loading calendar data:', err);
    }
  };

  const loadTasksData = async (uid) => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data, count } = await supabase
        ?.from('personal_list_items')
        ?.select('*', { count: 'exact' })
        ?.eq('user_id', uid)
        ?.eq('is_done', false)
        ?.eq('due_date', today)
        ?.order('created_at', { ascending: false })
        ?.limit(8);
      
      setTodayTasks(data || []);
      setTodayTasksCount(count || 0);
    } catch (err) {
      console.error('Error loading tasks data:', err);
    }
  };

  const loadDashboardData = async () => {
    if (!userId) return;
    await loadCalendarData(userId);
    await loadTasksData(userId);
  };

  const calculateProfileCompletion = async (profileData, uid) => {
    // Check personal_profile for additional fields
    const { data: personalProfile } = await supabase
      ?.from('personal_profile')
      ?.select('*')
      ?.eq('user_id', uid)
      ?.single();
    
    const fields = [
      { name: 'Emergency Contact', key: 'next_of_kin_phone', value: personalProfile?.next_of_kin_phone, priority: 1 },
      { name: 'Next of Kin', key: 'next_of_kin_name', value: personalProfile?.next_of_kin_name, priority: 2 },
      { name: 'Documents', key: 'documents', value: null, priority: 3 }, // Placeholder for documents check
      { name: 'Phone', key: 'phone', value: personalProfile?.phone, priority: 4 },
      { name: 'Avatar', key: 'avatar_url', value: personalProfile?.avatar_url, priority: 5 },
      { name: 'DOB', key: 'dob', value: personalProfile?.dob, priority: 6 },
      { name: 'Nationality', key: 'nationality', value: personalProfile?.nationality, priority: 7 },
      { name: 'Full Name', key: 'full_name', value: profileData?.full_name, priority: 8 }
    ];
    
    const filledFields = fields?.filter(f => f?.value)?.length;
    const totalFields = fields?.length;
    const percentage = Math.round((filledFields / totalFields) * 100);
    
    setProfileCompletion(percentage);
    // Sort by priority and take first 6 missing
    const missing = fields
      ?.filter(f => !f?.value)
      ?.sort((a, b) => a?.priority - b?.priority)
      ?.slice(0, 6);
    setMissingFields(missing);
  };

  const handleToggleTask = async (taskId, currentStatus) => {
    try {
      const { error } = await supabase
        ?.from('personal_list_items')
        ?.update({ is_done: !currentStatus })
        ?.eq('id', taskId);
      
      if (error) throw error;
      
      // Optimistic UI update
      setTodayTasks(prev => prev?.filter(t => t?.id !== taskId));
      setTodayTasksCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Error toggling task:', err);
      loadDashboardData();
    }
  };

  const handleAddTask = async (e) => {
    e?.preventDefault();
    if (!taskText?.trim()) return;
    
    try {
      // Get or create default list
      let { data: lists } = await supabase
        ?.from('personal_lists')
        ?.select('id')
        ?.eq('user_id', userId)
        ?.limit(1);
      
      let listId = lists?.[0]?.id;
      
      if (!listId) {
        const { data: newList } = await supabase
          ?.from('personal_lists')
          ?.insert({ user_id: userId, title: 'My Tasks' })
          ?.select()
          ?.single();
        listId = newList?.id;
      }
      
      const { error } = await supabase
        ?.from('personal_list_items')
        ?.insert({
          user_id: userId,
          list_id: listId,
          text: taskText?.trim(),
          due_date: taskDueDate || null,
          is_done: false
        });
      
      if (error) throw error;
      
      setTaskText('');
      setTaskDueDate(format(new Date(), 'yyyy-MM-dd'));
      setShowAddTaskModal(false);
      loadDashboardData();
    } catch (err) {
      console.error('Error adding task:', err);
    }
  };

  const handleAddEvent = async (e) => {
    e?.preventDefault();
    if (!eventTitle?.trim() || !eventStartAt) return;
    
    try {
      const { error } = await supabase
        ?.from('personal_calendar_events')
        ?.insert({
          user_id: userId,
          title: eventTitle?.trim(),
          start_at: eventStartAt
        });
      
      if (error) throw error;
      
      setEventTitle('');
      setEventStartAt('');
      setShowAddEventModal(false);
      loadDashboardData();
    } catch (err) {
      console.error('Error adding event:', err);
    }
  };

  const handleCreateList = async (e) => {
    e?.preventDefault();
    if (!newListTitle?.trim()) return;
    
    try {
      const { error } = await supabase
        ?.from('personal_lists')
        ?.insert({
          user_id: userId,
          title: newListTitle?.trim()
        });
      
      if (error) throw error;
      
      setNewListTitle('');
      setShowNewListModal(false);
      navigate('/personal/lists');
    } catch (err) {
      console.error('Error creating list:', err);
    }
  };

  const renderMiniCalendar = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
    
    // Get day of week for first day (0 = Sunday)
    const firstDayOfWeek = monthStart?.getDay();
    const emptyDays = Array(firstDayOfWeek)?.fill(null);
    
    return (
      <div className="mt-3">
        <div className="grid grid-cols-7 gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S']?.map((day, i) => (
            <div key={i} className="text-center">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {emptyDays?.map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {days?.map((day, i) => {
            const hasEvent = monthEvents?.some(event => 
              isSameDay(parseISO(event?.start_at), day)
            );
            const isCurrentDay = isToday(day);
            
            return (
              <div
                key={i}
                className={`aspect-square flex items-center justify-center text-xs rounded relative ${
                  isCurrentDay
                    ? 'bg-[#4A7C9B] text-white font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {format(day, 'd')}
                {hasEvent && !isCurrentDay && (
                  <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#4A7C9B]" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const ClickableCard = ({ onClick, children, className = '' }) => (
    <button
      onClick={onClick}
      onKeyDown={(e) => e?.key === 'Enter' && onClick?.()}
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-left hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${className}`}
    >
      {children}
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] dark:bg-gray-900">
        <Header />
        <div className="flex items-center justify-center h-96">
          <div className="text-gray-500 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  const todayString = format(new Date(), 'EEEE d MMM');

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-gray-900">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">Personal Dashboard</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Welcome back, {profile?.full_name || 'User'}</p>
        </div>

        {/* 3-Column Grid: My Lists (LEFT) | Calendar (CENTER) | My Profile (RIGHT) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          
          {/* LEFT COLUMN: MY LISTS */}
          <div className="flex flex-col">
            <ClickableCard onClick={() => navigate('/personal/lists')} className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">My Lists</h2>
                <Icon name="list" className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </div>
              
              {/* Today Section with Count Badge */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Today</h3>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    {todayTasksCount}
                  </span>
                </div>
                
                {todayTasks?.length > 0 ? (
                  <div className="space-y-2">
                    {todayTasks?.map((task) => (
                      <div
                        key={task?.id}
                        className="flex items-start gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handleToggleTask(task?.id, task?.is_done);
                          }}
                          className="mt-0.5 w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center hover:border-[#4A7C9B] focus:outline-none focus:ring-2 focus:ring-[#4A7C9B]"
                        >
                          {task?.is_done && (
                            <Icon name="check" className="w-3 h-3 text-[#4A7C9B]" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 dark:text-gray-100">{task?.text}</p>
                          {task?.due_date && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              Due {format(parseISO(task?.due_date), 'MMM d')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">You're clear for today.</p>
                )}
              </div>
              
              {/* Actions */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
                <Button
                  onClick={(e) => {
                    e?.stopPropagation();
                    setShowAddTaskModal(true);
                  }}
                  className="w-full bg-[#4A7C9B] hover:bg-[#3d6680] text-white"
                  size="sm"
                >
                  <Icon name="plus" className="w-4 h-4 mr-2" />
                  Add task
                </Button>
                <button
                  onClick={(e) => {
                    e?.stopPropagation();
                    setShowNewListModal(true);
                  }}
                  className="w-full text-sm text-[#4A7C9B] hover:underline focus:outline-none py-1"
                >
                  + New list
                </button>
              </div>
              
              {/* View All Link */}
              <div className="mt-3 text-center">
                <button
                  onClick={(e) => {
                    e?.stopPropagation();
                    navigate('/personal/lists');
                  }}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:text-[#4A7C9B] dark:hover:text-[#4A7C9B] focus:outline-none"
                >
                  View all lists
                </button>
              </div>
            </ClickableCard>
          </div>
          
          {/* CENTER COLUMN: CALENDAR */}
          <ClickableCard onClick={() => navigate('/personal/calendar')} className="lg:col-span-1">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Calendar</h2>
              <Icon name="calendar" className="w-5 h-5 text-gray-400 dark:text-gray-500" />
            </div>
            
            {/* Today Strip */}
            <div className="mb-3 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-md">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Today · {todayString}
              </p>
            </div>
            
            {/* Mini Month View */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{format(currentMonth, 'MMMM yyyy')}</h3>
              </div>
              {renderMiniCalendar()}
            </div>
            
            {/* Upcoming Events */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Upcoming</h3>
              {upcomingEvents?.length > 0 ? (
                <div className="space-y-2">
                  {upcomingEvents?.map((event) => (
                    <button
                      key={event?.id}
                      onClick={(e) => {
                        e?.stopPropagation();
                        navigate(`/personal/calendar?event_id=${event?.id}`);
                      }}
                      className="w-full text-left p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#4A7C9B]"
                    >
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {format(parseISO(event?.start_at), 'MMM d, h:mm a')}
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">{event?.title}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">Your schedule is clear — add something?</p>
              )}
            </div>
            
            {/* Add Event Button */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                onClick={(e) => {
                  e?.stopPropagation();
                  setShowAddEventModal(true);
                }}
                className="w-full bg-[#4A7C9B] hover:bg-[#3d6680] text-white"
                size="sm"
              >
                <Icon name="plus" className="w-4 h-4 mr-2" />
                Add event
              </Button>
            </div>
          </ClickableCard>
          
          {/* RIGHT COLUMN: MY PROFILE */}
          <div className="flex flex-col">
            <ClickableCard onClick={() => navigate('/my-profile')} className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">My Profile</h2>
                <Icon name="user" className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </div>
              
              {/* Crew-ready Progress Bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-600 dark:text-gray-400">Crew-ready:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{profileCompletion}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-[#4A7C9B] h-2 rounded-full transition-all"
                    style={{ width: `${profileCompletion}%` }}
                  />
                </div>
              </div>
              
              {/* Missing Fields Chips */}
              {profileCompletion < 100 ? (
                <div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Finish these to be vessel-ready:</p>
                  <div className="flex flex-wrap gap-2">
                    {missingFields?.map((field, i) => {
                      const isCritical = field?.name === 'Emergency Contact' || field?.name === 'Next of Kin';
                      return (
                        <span
                          key={i}
                          className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${
                            isCritical
                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800' :'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {field?.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center text-green-700 dark:text-green-400 text-sm">
                  <Icon name="check-circle" className="w-4 h-4 mr-2" />
                  Profile complete
                </div>
              )}
              
              {/* CTA Button */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Button
                  onClick={(e) => {
                    e?.stopPropagation();
                    navigate('/my-profile');
                  }}
                  className="w-full bg-[#4A7C9B] hover:bg-[#3d6680] text-white"
                  size="sm"
                >
                  {profileCompletion < 100 ? 'Complete profile' : 'View profile'}
                </Button>
              </div>
            </ClickableCard>
          </div>
          
        </div>

        {/* Global Dashboard Helper Text */}
        <div className="text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This is your personal Cargo space. Join a vessel anytime via invite.
          </p>
        </div>
      </div>

      {/* Add Task Modal */}
      {showAddTaskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Add task</h3>
            <form onSubmit={handleAddTask}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Task
                  </label>
                  <input
                    type="text"
                    value={taskText}
                    onChange={(e) => setTaskText(e?.target?.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Enter task..."
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e?.target?.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddTaskModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-[#4A7C9B] hover:bg-[#3d6680] text-white">
                  Add Task
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Event Modal */}
      {showAddEventModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Add event</h3>
            <form onSubmit={handleAddEvent}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Event Title
                  </label>
                  <input
                    type="text"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e?.target?.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Enter event title..."
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Start Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={eventStartAt}
                    onChange={(e) => setEventStartAt(e?.target?.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddEventModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-[#4A7C9B] hover:bg-[#3d6680] text-white">
                  Add Event
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create List Modal */}
      {showNewListModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Create list</h3>
            <form onSubmit={handleCreateList}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    List Name
                  </label>
                  <input
                    type="text"
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e?.target?.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4A7C9B] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Enter list name..."
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewListModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-[#4A7C9B] hover:bg-[#3d6680] text-white">
                  Create List
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalDashboard;