// Board data model and localStorage persistence utilities
import { supabase } from '../../../lib/supabaseClient';

/**
 * Board Type Definition:
 * {
 *   id: string (unique),
 *   name: string (required),
 *   boardType: "Interior" | "HOD" | "Other",
 *   department: string (Department enum value),
 *   department_id: uuid (Supabase department id),
 *   names: { [departmentId]: string } (per-department name overrides),
 *   description: string (optional),
 *   createdAt: ISO string
 * }
 */

const STORAGE_KEY = 'cargo.boards.v1';

/**
 * Load boards from localStorage
 * @returns {Array} Array of Board objects
 */
export const loadBoards = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const boards = JSON.parse(stored);
      return boards;
    }
    
    // Initialize with default "Additional jobs" board if empty
    const defaultBoards = [
      {
        id: crypto.randomUUID(),
        name: 'Additional jobs',
        boardType: 'Interior',
        department: 'INTERIOR',
        description: '',
        createdAt: new Date()?.toISOString()
      }
    ];
    
    saveBoards(defaultBoards);
    return defaultBoards;
  } catch (error) {
    console.error('Error loading boards:', error);
    return [
      {
        id: crypto.randomUUID(),
        name: 'Additional jobs',
        boardType: 'Interior',
        department: 'INTERIOR',
        description: '',
        createdAt: new Date()?.toISOString()
      }
    ];
  }
};

/**
 * Save boards to localStorage
 * @param {Array} boards - Array of Board objects
 */
export const saveBoards = (boards) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch (error) {
    console.error('Error saving boards:', error);
  }
};

/**
 * Load boards from Supabase for a given tenant
 * Returns boards with their department-scoped names
 * @param {string} tenantId
 * @returns {Promise<Array>} Array of Board objects
 */
export const loadBoardsFromSupabase = async (tenantId) => {
  if (!tenantId) return null;
  try {
    const { data, error } = await supabase
      ?.from('job_boards')
      ?.select('*')
      ?.eq('tenant_id', tenantId)
      ?.order('created_at', { ascending: true });

    if (error) {
      console.warn('[boardStorage] Failed to load boards from Supabase:', error);
      return null;
    }

    if (!data || data?.length === 0) return [];

    // Group rows by board id — each row is a (board_id, department_id) pair
    // We reconstruct the board objects with a `names` map: { [dept_id]: name }
    const boardMap = {};
    for (const row of data) {
      if (!boardMap?.[row?.id]) {
        boardMap[row.id] = {
          id: row?.id,
          name: row?.name,
          boardType: row?.board_type || 'Interior',
          department_id: row?.department_id || null,
          department: row?.department_id || null,
          description: row?.description || '',
          created_by: row?.created_by || null,
          createdAt: row?.created_at || new Date()?.toISOString(),
          names: {},
        };
      }
      // Store department-scoped name
      if (row?.department_id) {
        boardMap[row.id].names[row.department_id] = row?.name;
      }
    }

    return Object.values(boardMap);
  } catch (err) {
    console.warn('[boardStorage] loadBoardsFromSupabase error:', err);
    return null;
  }
};

/**
 * Upsert a board row in Supabase (creates or updates)
 * Call this when a board is created or its name is changed
 * @param {Object} board - Board object
 * @param {string} tenantId
 * @param {string|null} departmentId - specific department scope for the name
 * @param {string} name - the name to store for this board+department combo
 */
export const saveBoardToSupabase = async (board, tenantId, departmentId, name) => {
  if (!tenantId || !board?.id) return;
  try {
    const payload = {
      id: board?.id,
      tenant_id: tenantId,
      department_id: departmentId || null,
      name: name || board?.name || 'Additional jobs',
      description: board?.description || null,
      board_type: board?.boardType || 'Interior',
      created_by: board?.created_by || null,
      updated_at: new Date()?.toISOString(),
    };

    const { error } = await supabase
      ?.from('job_boards')
      ?.upsert(payload, { onConflict: 'id,tenant_id' });

    if (error) {
      console.warn('[boardStorage] Failed to save board to Supabase:', error);
    }
  } catch (err) {
    console.warn('[boardStorage] saveBoardToSupabase error:', err);
  }
};

/**
 * Delete a board from Supabase
 * @param {string} boardId
 * @param {string} tenantId
 */
export const deleteBoardFromSupabase = async (boardId, tenantId) => {
  if (!tenantId || !boardId) return;
  try {
    const { error } = await supabase
      ?.from('job_boards')
      ?.delete()
      ?.eq('id', boardId)
      ?.eq('tenant_id', tenantId);

    if (error) {
      console.warn('[boardStorage] Failed to delete board from Supabase:', error);
    }
  } catch (err) {
    console.warn('[boardStorage] deleteBoardFromSupabase error:', err);
  }
};

/**
 * Load board order for a user+tenant from Supabase user_board_order table.
 * Returns an array of board IDs sorted by sort_index, or null on failure.
 * @param {string} userId
 * @param {string} tenantId
 * @returns {Promise<string[]|null>}
 */
export const loadBoardOrderFromSupabase = async (userId, tenantId) => {
  if (!userId || !tenantId) return null;
  try {
    const { data, error } = await supabase
      ?.from('user_board_order')
      ?.select('board_id, sort_index')
      ?.eq('user_id', userId)
      ?.eq('tenant_id', tenantId)
      ?.order('sort_index', { ascending: true });
    if (error) {
      console.warn('[boardStorage] loadBoardOrderFromSupabase error:', error);
      return null;
    }
    if (!data || data?.length === 0) return null;
    return data?.map(r => r?.board_id);
  } catch (err) {
    console.warn('[boardStorage] loadBoardOrderFromSupabase exception:', err);
    return null;
  }
};

/**
 * Persist board order for a user+tenant to Supabase user_board_order table.
 * Uses upsert so it works for both first-save and updates.
 * @param {string} userId
 * @param {string} tenantId
 * @param {string[]} orderedBoardIds
 * @returns {Promise<boolean>} true on success, false on failure
 */
export const saveBoardOrderToSupabase = async (userId, tenantId, orderedBoardIds) => {
  if (!userId || !tenantId || !Array.isArray(orderedBoardIds)) return false;
  try {
    const rows = orderedBoardIds?.map((boardId, idx) => ({
      tenant_id: tenantId,
      user_id: userId,
      board_id: boardId,
      sort_index: idx,
      updated_at: new Date()?.toISOString(),
    }));
    const { error } = await supabase
      ?.from('user_board_order')
      ?.upsert(rows, { onConflict: 'tenant_id,user_id,board_id' });
    if (error) {
      console.warn('[boardStorage] saveBoardOrderToSupabase error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[boardStorage] saveBoardOrderToSupabase exception:', err);
    return false;
  }
};

/**
 * Create a new board
 * @param {Object} boardData - { name, boardType, department, description }
 * @returns {Object} New Board object
 */
export const createBoard = (boardData) => {
  return {
    id: crypto.randomUUID(),
    name: boardData?.name?.trim(),
    boardType: boardData?.boardType || 'Interior',
    department: boardData?.department || 'INTERIOR',
    description: boardData?.description?.trim() || '',
    createdAt: new Date()?.toISOString()
  };
};

/**
 * Update an existing board
 * @param {Array} boards - Current boards array
 * @param {string} boardId - ID of board to update
 * @param {Object} updates - Fields to update
 * @returns {Array} Updated boards array
 */
export const updateBoard = (boards, boardId, updates) => {
  return boards?.map(board => 
    board?.id === boardId 
      ? { ...board, ...updates }
      : board
  );
};

/**
 * Delete a board
 * @param {Array} boards - Current boards array
 * @param {string} boardId - ID of board to delete
 * @returns {Array} Updated boards array
 */
export const deleteBoard = (boards, boardId) => {
  return boards?.filter(board => board?.id !== boardId);
};