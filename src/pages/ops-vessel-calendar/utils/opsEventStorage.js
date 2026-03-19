// Ops/Vessel Event data model and localStorage persistence

const STORAGE_KEY = 'cargo.ops-events.v1';

/**
 * Ops Event Type Definition:
 * {
 *   id: string (unique),
 *   title: string,
 *   description: string,
 *   startDate: ISO string,
 *   endDate: ISO string,
 *   location: string,
 *   category: string,
 *   isPrivate: boolean,
 *   visibility: string[] (roles/departments),
 *   attachments: Array<{id, name, url, type, size}>,
 *   createdBy: string (user ID),
 *   createdByName: string,
 *   createdAt: ISO string,
 *   editedBy: string (user ID),
 *   editedByName: string,
 *   editedAt: ISO string,
 *   activity: Array<{id, action, userId, userName, timestamp, details}>
 * }
 */

import { getCurrentUser } from '../../../utils/authStorage';
import { enforceDepartmentScope } from '../../../utils/departmentScopeEnforcement';
import { getDepartmentScope } from '../../../utils/departmentScopeStorage';
import { logActivity } from '../../../utils/activityStorage';

// Ops Event Actions for activity feed
export const OpsEventActions = {
  EVENT_CREATED: 'EVENT_CREATED',
  EVENT_UPDATED: 'EVENT_UPDATED',
  EVENT_DELETED: 'EVENT_DELETED'
};

/**
 * Load ops events from localStorage
 * @param {Object} currentUser - Current user object
 * @returns {Array} Array of event objects visible to user
 */
export const loadOpsEvents = (currentUser) => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const allEvents = JSON.parse(stored);
    
    // Get current user and requested scope
    const user = currentUser || getCurrentUser();
    const requestedScope = getDepartmentScope();

    // Filter events based on visibility (existing logic)
    const visibleEvents = allEvents?.filter(event => {
      // Private events only visible to creator
      if (event?.isPrivate) {
        return event?.createdBy === user?.id;
      }
      
      // Non-private events with visibility rules
      if (!event?.visibility || event?.visibility?.length === 0) {
        return event?.createdBy === user?.id;
      }
      
      // Check visibility permissions
      let isVisible = false;
      if (event?.visibility?.includes('All Hands')) isVisible = true;
      if (event?.visibility?.includes('Chiefs') && user?.tier === 'CHIEF') isVisible = true;
      if (event?.visibility?.includes('HODs') && user?.tier === 'HOD') isVisible = true;
      if (event?.visibility?.includes('Crew') && user?.tier === 'CREW') isVisible = true;
      if (event?.visibility?.includes('HODs + Crew') && (user?.tier === 'HOD' || user?.tier === 'CREW')) isVisible = true;
      if (event?.visibility?.includes(user?.department)) isVisible = true;
      
      // Creator can always see their own events
      if (event?.createdBy === user?.id) isVisible = true;
      
      return isVisible;
    });
    
    // Apply department scope enforcement at data level
    // This ensures non-Command users can only see their department's events
    return enforceDepartmentScope(visibleEvents, user, requestedScope);
  } catch (error) {
    console.error('Error loading ops events:', error);
    return [];
  }
};

/**
 * Save ops events to localStorage
 * @param {Array} events - Array of event objects
 */
const saveOpsEvents = (events) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (error) {
    console.error('Error saving ops events:', error);
  }
};

/**
 * Create activity log entry
 * @param {string} action - Action description
 * @param {string} userId - User ID
 * @param {string} userName - User name
 * @param {Object} details - Additional details
 * @returns {Object} Activity entry
 */
const createActivityEntry = (action, userId, userName, details = {}) => {
  return {
    id: crypto.randomUUID(),
    action,
    userId,
    userName,
    timestamp: new Date()?.toISOString(),
    details
  };
};

/**
 * Create a new ops event
 * @param {Object} eventData - Event data
 * @param {string} userId - Creator user ID
 * @param {string} userName - Creator user name
 * @returns {Object} New event object
 */
export const createOpsEvent = (eventData, userId, userName) => {
  const newEvent = {
    id: crypto.randomUUID(),
    title: eventData?.title,
    description: eventData?.description || '',
    startDate: eventData?.startDate,
    endDate: eventData?.endDate || null,
    location: eventData?.location || '',
    category: eventData?.category || '',
    isPrivate: eventData?.isPrivate || false,
    visibility: eventData?.visibility || [],
    attachments: eventData?.attachments || [],
    createdBy: userId,
    createdByName: userName,
    createdAt: new Date()?.toISOString(),
    editedBy: null,
    editedByName: null,
    editedAt: null,
    activity: [
      createActivityEntry('created event', userId, userName)
    ]
  };
  
  // Add All Hands confirmation to activity if applicable
  if (newEvent?.visibility?.includes('All Hands')) {
    newEvent?.activity?.push(
      createActivityEntry('confirmed All Hands visibility', userId, userName)
    );
  }
  
  const allEvents = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  allEvents?.push(newEvent);
  saveOpsEvents(allEvents);

  // Log to Supabase activity feed
  logActivity({
    module: 'calendar',
    action: OpsEventActions?.EVENT_CREATED,
    entityType: 'ops_event',
    entityId: newEvent?.id,
    summary: `Calendar event created: ${newEvent?.title}`,
    meta: { title: newEvent?.title, category: newEvent?.category, startDate: newEvent?.startDate }
  });
  
  return newEvent;
};

/**
 * Update an existing ops event
 * @param {string} eventId - Event ID
 * @param {Object} updates - Updated fields
 * @param {string} userId - Editor user ID
 * @param {string} userName - Editor user name
 * @returns {Object} Updated event
 */
export const updateOpsEvent = (eventId, updates, userId, userName) => {
  const allEvents = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const eventIndex = allEvents?.findIndex(e => e?.id === eventId);
  
  if (eventIndex === -1) return null;
  
  const oldEvent = allEvents?.[eventIndex];
  const updatedEvent = {
    ...oldEvent,
    ...updates,
    editedBy: userId,
    editedByName: userName,
    editedAt: new Date()?.toISOString()
  };
  
  // Track changes in activity log
  const changes = [];
  if (oldEvent?.title !== updates?.title) changes?.push('title');
  if (oldEvent?.description !== updates?.description) changes?.push('description');
  if (oldEvent?.startDate !== updates?.startDate) changes?.push('start date');
  if (oldEvent?.endDate !== updates?.endDate) changes?.push('end date');
  if (oldEvent?.location !== updates?.location) changes?.push('location');
  if (oldEvent?.category !== updates?.category) changes?.push('category');
  if (oldEvent?.isPrivate !== updates?.isPrivate) changes?.push('privacy');
  if (JSON.stringify(oldEvent?.visibility) !== JSON.stringify(updates?.visibility)) changes?.push('visibility');
  
  if (changes?.length > 0) {
    updatedEvent?.activity?.push(
      createActivityEntry(`edited ${changes?.join(', ')}`, userId, userName, { changes })
    );
  }
  
  // Add All Hands confirmation if newly added
  const hadAllHands = oldEvent?.visibility?.includes('All Hands');
  const hasAllHands = updates?.visibility?.includes('All Hands');
  if (hasAllHands && !hadAllHands) {
    updatedEvent?.activity?.push(
      createActivityEntry('confirmed All Hands visibility', userId, userName)
    );
  }
  
  allEvents[eventIndex] = updatedEvent;
  saveOpsEvents(allEvents);

  // Log to Supabase activity feed
  logActivity({
    module: 'calendar',
    action: OpsEventActions?.EVENT_UPDATED,
    entityType: 'ops_event',
    entityId: eventId,
    summary: `Calendar event updated: ${updatedEvent?.title}`,
    meta: { title: updatedEvent?.title, changes }
  });
  
  return updatedEvent;
};

/**
 * Delete an ops event
 * @param {string} eventId - Event ID
 * @returns {boolean} Success status
 */
export const deleteOpsEvent = (eventId) => {
  try {
    const allEvents = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const eventToDelete = allEvents?.find(e => e?.id === eventId);
    const filtered = allEvents?.filter(e => e?.id !== eventId);
    saveOpsEvents(filtered);

    // Log to Supabase activity feed
    if (eventToDelete) {
      logActivity({
        module: 'calendar',
        action: OpsEventActions?.EVENT_DELETED,
        entityType: 'ops_event',
        entityId: eventId,
        summary: `Calendar event deleted: ${eventToDelete?.title}`,
        meta: { title: eventToDelete?.title }
      });
    }

    return true;
  } catch (error) {
    console.error('Error deleting ops event:', error);
    return false;
  }
};