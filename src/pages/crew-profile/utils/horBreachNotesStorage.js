// HOR Breach Notes Storage Utility
// Manages breach notes for Hours of Rest compliance violations

import { BREACH_TYPES, BREACH_DISPLAY_INFO } from './horStorage';

const HOR_BREACH_NOTES_KEY = 'cargo_hor_breach_notes';

// Breach type labels for UI display (human-readable)
export const BREACH_TYPE_LABELS = {
  [BREACH_TYPES?.REST_LT_10_IN_24H]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_10_IN_24H]?.displayName || '<10h rest / 24h',
  [BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]?.displayName || 'No 6h continuous rest',
  [BREACH_TYPES?.REST_LT_77_IN_7D]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_77_IN_7D]?.displayName || '<77h rest / 7d'
};

// Quick tag options for breach notes
export const QUICK_TAGS = [
  { id: 'guest_trip', label: 'Guest trip', prefix: 'Guest trip: ' },
  { id: 'turnaround', label: 'Turnaround / provisioning', prefix: 'Turnaround/provisioning: ' },
  { id: 'night_watch', label: 'Night watch / security', prefix: 'Night watch/security: ' },
  { id: 'medical', label: 'Medical / emergency', prefix: 'Medical/emergency: ' },
  { id: 'drill', label: 'Drill / operations', prefix: 'Drill/operations: ' }
];

/**
 * Load all breach notes from localStorage
 */
export const loadBreachNotes = () => {
  try {
    const data = localStorage.getItem(HOR_BREACH_NOTES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading breach notes:', error);
    return [];
  }
};

/**
 * Save breach notes to localStorage
 */
export const saveBreachNotes = (notes) => {
  try {
    localStorage.setItem(HOR_BREACH_NOTES_KEY, JSON.stringify(notes));
    return true;
  } catch (error) {
    console.error('Error saving breach notes:', error);
    return false;
  }
};

/**
 * Add or update breach note (upsert)
 * If a note exists for the same userId, date, and breachType, update it
 * Otherwise, create a new note
 */
export const upsertBreachNote = ({
  userId,
  date,
  breachTypes,
  noteText,
  createdByUserId
}) => {
  const allNotes = loadBreachNotes();
  const now = new Date()?.toISOString();
  
  // Find existing note for this user and date
  const existingIndex = allNotes?.findIndex(
    note => note?.userId === userId && note?.date === date
  );
  
  if (existingIndex !== -1) {
    // Update existing note
    allNotes[existingIndex] = {
      ...allNotes?.[existingIndex],
      breachTypes,
      noteText,
      updatedAt: now,
      updatedByUserId: createdByUserId
    };
  } else {
    // Create new note
    const newNote = {
      id: `breach_note_${userId}_${date}_${Date.now()}`,
      userId,
      date,
      breachTypes,
      noteText,
      createdAt: now,
      createdByUserId,
      updatedAt: now,
      updatedByUserId: createdByUserId
    };
    allNotes?.push(newNote);
  }
  
  saveBreachNotes(allNotes);
  return allNotes;
};

/**
 * Get breach notes for a specific user and month
 */
export const getBreachNotesForMonth = (userId, year, month) => {
  const allNotes = loadBreachNotes();
  
  return allNotes?.filter(note => {
    if (note?.userId !== userId) return false;
    
    const noteDate = new Date(note.date);
    return noteDate?.getFullYear() === year && noteDate?.getMonth() === month;
  });
};

/**
 * Get breach note for a specific date
 */
export const getBreachNoteForDate = (userId, date) => {
  const allNotes = loadBreachNotes();
  return allNotes?.find(note => note?.userId === userId && note?.date === date);
};

/**
 * Delete breach note
 */
export const deleteBreachNote = (noteId) => {
  const allNotes = loadBreachNotes();
  const filteredNotes = allNotes?.filter(note => note?.id !== noteId);
  saveBreachNotes(filteredNotes);
  return filteredNotes;
};

/**
 * Check if breach note exists for a date
 */
export const hasBreachNoteForDate = (userId, date) => {
  const note = getBreachNoteForDate(userId, date);
  return note !== undefined;
};