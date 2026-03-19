// Weekly Reminder Automation for HOR
// Runs weekly on Sunday at 18:00 ship time

import { loadUsers } from './authStorage';
import { getCrewWorkEntries, getMonthStatus } from '../pages/crew-profile/utils/horStorage';
import { createNotification, SEVERITY } from '../pages/team-jobs-management/utils/notifications';

const REMINDER_LOG_KEY = 'cargo_hor_reminder_log';

/**
 * Check missing days for a crew member in current month
 */
const getMissingDays = (crewId, year, month) => {
  const entries = getCrewWorkEntries(crewId);
  const today = new Date();
  const currentDay = today?.getMonth() === month && today?.getFullYear() === year ? today?.getDate() : new Date(year, month + 1, 0)?.getDate();
  
  const entriesThisMonth = entries?.filter(entry => {
    const entryDate = new Date(entry?.date);
    return entryDate?.getFullYear() === year && entryDate?.getMonth() === month;
  });
  
  const loggedDates = new Set(entriesThisMonth?.map(e => e?.date));
  const missingDates = [];
  
  for (let day = 1; day <= currentDay; day++) {
    const dateStr = `${year}-${String(month + 1)?.padStart(2, '0')}-${String(day)?.padStart(2, '0')}`;
    if (!loggedDates?.has(dateStr)) {
      missingDates?.push(day);
    }
  }
  
  return missingDates;
};

/**
 * Check if we're in the last 7 days of the month
 */
const isEndOfMonth = (year, month) => {
  const today = new Date();
  if (today?.getFullYear() !== year || today?.getMonth() !== month) {
    return false;
  }
  
  const daysInMonth = new Date(year, month + 1, 0)?.getDate();
  const currentDay = today?.getDate();
  
  return (daysInMonth - currentDay) <= 7;
};

/**
 * Log a reminder event
 */
const logReminder = (userId, month, reminderType, source = 'AUTO', senderId = null) => {
  try {
    const log = JSON.parse(localStorage.getItem(REMINDER_LOG_KEY) || '[]');
    log?.push({
      id: `reminder_${Date.now()}_${Math.random()}`,
      userId,
      month: month?.toISOString(),
      reminderType,
      source, // AUTO or MANUAL
      senderId,
      sentAt: new Date()?.toISOString()
    });
    localStorage.setItem(REMINDER_LOG_KEY, JSON.stringify(log));
  } catch (error) {
    console.error('Error logging reminder:', error);
  }
};

/**
 * Get reminder log for a user
 */
export const getReminderLog = (userId, year = null, month = null) => {
  try {
    const log = JSON.parse(localStorage.getItem(REMINDER_LOG_KEY) || '[]');
    let filtered = log?.filter(r => r?.userId === userId);
    
    if (year !== null && month !== null) {
      filtered = filtered?.filter(r => {
        const reminderDate = new Date(r?.month);
        return reminderDate?.getFullYear() === year && reminderDate?.getMonth() === month;
      });
    }
    
    return filtered?.sort((a, b) => new Date(b?.sentAt) - new Date(a?.sentAt));
  } catch (error) {
    console.error('Error getting reminder log:', error);
    return [];
  }
};

/**
 * Send HOR reminder notification
 */
const sendHORReminder = (userId, userName, reminderType, missingDays = []) => {
  const currentMonth = new Date()?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  
  let title = '';
  let message = '';
  
  if (reminderType === 'MISSING_DAYS') {
    title = 'HOR Reminder: Missing Entries';
    const daysText = missingDays?.length <= 5 
      ? missingDays?.join(', ')
      : `${missingDays?.slice(0, 5)?.join(', ')} and ${missingDays?.length - 5} more`;
    message = `Please complete your hours for ${currentMonth}. Missing days: ${daysText}.`;
  } else if (reminderType === 'CONFIRM_MONTH') {
    title = 'HOR Reminder: Confirm Month';
    message = `Your ${currentMonth} entries are complete. Please Confirm Month.`;
  }
  
  createNotification({
    userId,
    type: 'HOR_REMINDER',
    severity: SEVERITY?.INFO,
    title,
    message,
    actionUrl: '/profile',
    metadata: {
      reminderType,
      missingDays
    }
  });
};

/**
 * Weekly reminder job - runs every Sunday at 18:00
 */
export const runWeeklyReminderJob = () => {
  console.log('[HOR Reminder] Running weekly reminder job...');
  
  const users = loadUsers();
  const today = new Date();
  const year = today?.getFullYear();
  const month = today?.getMonth();
  
  let remindersSent = 0;
  
  users?.forEach(user => {
    // Check month status
    const monthStatus = getMonthStatus(user?.id, year, month);
    
    // Skip if month is locked
    if (monthStatus?.locked) {
      return;
    }
    
    // Check for missing days
    const missingDays = getMissingDays(user?.id, year, month);
    
    if (missingDays?.length > 0) {
      // Send missing days reminder
      sendHORReminder(user?.id, user?.fullName, 'MISSING_DAYS', missingDays);
      logReminder(user?.id, today, 'MISSING_DAYS', 'AUTO');
      remindersSent++;
    } else if (!monthStatus?.confirmed && isEndOfMonth(year, month)) {
      // Send confirm month reminder
      sendHORReminder(user?.id, user?.fullName, 'CONFIRM_MONTH');
      logReminder(user?.id, today, 'CONFIRM_MONTH', 'AUTO');
      remindersSent++;
    }
  });
  
  console.log(`[HOR Reminder] Sent ${remindersSent} reminders`);
  return remindersSent;
};

/**
 * Manual nudge - sends reminder immediately
 */
export const sendManualNudge = (userId, userName, senderId) => {
  const today = new Date();
  const year = today?.getFullYear();
  const month = today?.getMonth();
  
  // Check month status
  const monthStatus = getMonthStatus(userId, year, month);
  
  if (monthStatus?.locked) {
    return { success: false, message: 'Month is locked' };
  }
  
  // Check for missing days
  const missingDays = getMissingDays(userId, year, month);
  
  if (missingDays?.length > 0) {
    sendHORReminder(userId, userName, 'MISSING_DAYS', missingDays);
    logReminder(userId, today, 'MISSING_DAYS', 'MANUAL', senderId);
    return { success: true, message: `Nudge sent. Missing ${missingDays?.length} day(s).` };
  } else if (!monthStatus?.confirmed) {
    sendHORReminder(userId, userName, 'CONFIRM_MONTH');
    logReminder(userId, today, 'CONFIRM_MONTH', 'MANUAL', senderId);
    return { success: true, message: 'Nudge sent to confirm month.' };
  }
  
  return { success: false, message: 'No action needed - entries complete and confirmed.' };
};

/**
 * Initialize weekly reminder scheduler
 * In production, this would be a server-side cron job
 * For demo purposes, we'll check on app load and use setInterval
 */
export const initializeReminderScheduler = () => {
  // Check if it's Sunday 18:00
  const checkAndRun = () => {
    const now = new Date();
    const dayOfWeek = now?.getDay(); // 0 = Sunday
    const hour = now?.getHours();
    
    // Check if last run was today
    const lastRun = localStorage.getItem('cargo_hor_last_reminder_run');
    const lastRunDate = lastRun ? new Date(lastRun) : null;
    const today = now?.toISOString()?.split('T')?.[0];
    const lastRunDay = lastRunDate?.toISOString()?.split('T')?.[0];
    
    if (dayOfWeek === 0 && hour === 18 && lastRunDay !== today) {
      runWeeklyReminderJob();
      localStorage.setItem('cargo_hor_last_reminder_run', now?.toISOString());
    }
  };
  
  // Check immediately
  checkAndRun();
  
  // Check every hour
  setInterval(checkAndRun, 60 * 60 * 1000);
};

export default {
  runWeeklyReminderJob,
  sendManualNudge,
  getReminderLog,
  initializeReminderScheduler
};