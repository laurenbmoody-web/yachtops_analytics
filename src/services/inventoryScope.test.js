import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHOLE_VESSEL_TIERS, WHOLE_VESSEL_DEPARTMENTS,
  isWholeVesselTier, isWholeVesselDepartment, hasWholeVesselInventory,
  visibleRootFolders, scopeLabel,
} from './inventoryScope.js';

const FOLDERS = ['Bridge', 'Deck', 'Engineering', 'Interior', 'Galley', 'Medical'];

test('Command and Chief keep whole-vessel scope', () => {
  for (const tier of WHOLE_VESSEL_TIERS) {
    assert.equal(isWholeVesselTier(tier), true, tier);
    assert.deepEqual(visibleRootFolders(FOLDERS, { tier, department: 'Interior' }), FOLDERS);
  }
});

test('Bridge gets every folder whatever the tier', () => {
  // The case this was built for: Harrison, Bridge HOD, who saw one folder.
  assert.deepEqual(
    visibleRootFolders(FOLDERS, { tier: 'HOD', department: 'Bridge' }),
    FOLDERS,
  );
  assert.deepEqual(
    visibleRootFolders(FOLDERS, { tier: 'CREW', department: 'Bridge' }),
    FOLDERS,
  );
});

test('every other department stays scoped to its own folder', () => {
  assert.deepEqual(visibleRootFolders(FOLDERS, { tier: 'HOD', department: 'Galley' }), ['Galley']);
  assert.deepEqual(visibleRootFolders(FOLDERS, { tier: 'CREW', department: 'Deck' }), ['Deck']);
  assert.deepEqual(
    visibleRootFolders(FOLDERS, { tier: 'CREW', department: 'Engineering' }),
    ['Engineering'],
  );
});

test('department and tier matching ignores case and padding', () => {
  assert.equal(isWholeVesselTier('command'), true);
  assert.equal(isWholeVesselTier(' Chief '), true);
  assert.equal(isWholeVesselDepartment('bridge'), true);
  assert.equal(isWholeVesselDepartment(' BRIDGE '), true);
  // Folder names come from two different tables and do not agree on case.
  assert.deepEqual(visibleRootFolders(['GALLEY'], { tier: 'CREW', department: 'galley' }), ['GALLEY']);
});

test('a near-miss department name is not whole-vessel', () => {
  assert.equal(isWholeVesselDepartment('Bridge Deck'), false);
  assert.equal(isWholeVesselDepartment('Flybridge'), false);
  assert.equal(isWholeVesselTier('HOD'), false);
  assert.equal(isWholeVesselTier('CREW'), false);
});

test('fails closed when the profile has not loaded', () => {
  // A half-loaded profile must show an empty grid, never the whole vessel.
  assert.deepEqual(visibleRootFolders(FOLDERS, { tier: 'CREW', department: '' }), []);
  assert.deepEqual(visibleRootFolders(FOLDERS, { tier: 'CREW', department: null }), []);
  assert.deepEqual(visibleRootFolders(FOLDERS, {}), []);
  assert.deepEqual(visibleRootFolders(FOLDERS), []);
  assert.equal(hasWholeVesselInventory(), false);
  assert.equal(hasWholeVesselInventory({}), false);
});

test('survives junk in the folder list', () => {
  assert.deepEqual(
    visibleRootFolders([null, 'Deck', undefined, ''], { tier: 'CREW', department: 'Deck' }),
    ['Deck'],
  );
  assert.deepEqual(visibleRootFolders(null, { tier: 'COMMAND' }), []);
  assert.deepEqual(visibleRootFolders('Deck', { tier: 'COMMAND' }), []);
});

test('the folder list is not mutated', () => {
  const input = [...FOLDERS];
  visibleRootFolders(input, { tier: 'CREW', department: 'Galley' });
  assert.deepEqual(input, FOLDERS);
});

test('Bridge is the only whole-vessel department', () => {
  // A guard on the rule itself: widening this list widens access for real crew,
  // so it should take a deliberate test change rather than passing quietly.
  assert.deepEqual(WHOLE_VESSEL_DEPARTMENTS, ['BRIDGE']);
  assert.deepEqual(WHOLE_VESSEL_TIERS, ['COMMAND', 'CHIEF']);
});

// ── unrestricted (non-department) folders ───────────────────────────────────
// Items in a folder that is not a department derive a null usage_department,
// and RLS treats null as unrestricted. The folder grid has to agree, or those
// items are readable but unreachable.
const DEPTS = ['Bridge', 'Deck', 'Engineering', 'Interior', 'Galley', 'Medical', 'Spa'];
const WITH_ODDITIES = [...FOLDERS, 'Spa', 'Archive', 'Unfiled'];

test('a non-department folder is offered to everyone', () => {
  const seen = visibleRootFolders(WITH_ODDITIES, {
    tier: 'CREW', department: 'Deck', departments: DEPTS,
  });
  assert.deepEqual(seen, ['Deck', 'Archive', 'Unfiled']);
});

test('other departments stay hidden even with the departments list', () => {
  const seen = visibleRootFolders(WITH_ODDITIES, {
    tier: 'CREW', department: 'Galley', departments: DEPTS,
  });
  assert.equal(seen.includes('Medical'), false);
  assert.equal(seen.includes('Interior'), false);
  assert.equal(seen.includes('Galley'), true);
});

test('without the departments list, only the own-department folder is offered', () => {
  // Narrower than RLS permits, which is the safe direction to be wrong in.
  assert.deepEqual(
    visibleRootFolders(WITH_ODDITIES, { tier: 'CREW', department: 'Deck' }),
    ['Deck'],
  );
  assert.deepEqual(
    visibleRootFolders(WITH_ODDITIES, { tier: 'CREW', department: 'Deck', departments: [] }),
    ['Deck'],
  );
});

test('whole-vessel scope still wins over the departments list', () => {
  assert.deepEqual(
    visibleRootFolders(WITH_ODDITIES, { tier: 'HOD', department: 'Bridge', departments: DEPTS }),
    WITH_ODDITIES,
  );
});

test('an unloaded profile gets nothing, departments list or not', () => {
  assert.deepEqual(
    visibleRootFolders(WITH_ODDITIES, { tier: 'CREW', department: '', departments: DEPTS }),
    [],
  );
});

test('scopeLabel says which it is', () => {
  assert.equal(scopeLabel({ tier: 'HOD', department: 'Bridge' }), 'All departments');
  assert.equal(scopeLabel({ tier: 'CHIEF', department: 'Galley' }), 'All departments');
  assert.equal(scopeLabel({ tier: 'CREW', department: 'Deck' }), 'Deck');
});
