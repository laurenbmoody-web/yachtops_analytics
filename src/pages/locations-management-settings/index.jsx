import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { markTutorialStep } from '../../utils/tutorialState';
import {
  getAllDecks,
  createDeck,
  updateDeck,
  archiveDeck,
  unarchiveDeck,
  getZonesByDeck,
  createZone,
  updateZone,
  archiveZone,
  unarchiveZone,
  getSpacesByZone,
  createSpace,
  updateSpace,
  archiveSpace,
  unarchiveSpace,
  reorderLocations,
} from './utils/locationsHierarchyStorage';

// ─── Sortable Row Wrapper ────────────────────────────────────────────────────
const SortableRow = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS?.Transform?.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandleProps: { ...attributes, ...listeners } })}
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
const LocationsManagementSettings = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { session, bootstrapComplete, tenantRole } = useAuth();
  const currentUser = getCurrentUser();

  // Access control - only Command and Chief
  // Use tenantRole from AuthContext as primary source (reactive), fall back to localStorage
  const normalizedRole = (tenantRole || '')?.toUpperCase()?.trim();
  const canAccessByRole = normalizedRole === 'COMMAND' || normalizedRole === 'CHIEF';
  const canAccessByUser = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canAccess = canAccessByRole || canAccessByUser;

  // Redirect if no access (only when standalone, not embedded)
  useEffect(() => {
    if (!embedded && bootstrapComplete && !canAccess) {
      navigate('/dashboard');
    }
  }, [canAccess, bootstrapComplete, navigate, embedded]);

  // State
  const [decks, setDecks] = useState([]);
  const [zones, setZones] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [spacesLoading, setSpacesLoading] = useState(false);

  // Show archived toggles
  const [showArchivedDecks, setShowArchivedDecks] = useState(false);
  const [showArchivedZones, setShowArchivedZones] = useState(false);
  const [showArchivedSpaces, setShowArchivedSpaces] = useState(false);

  // Inline edit states
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingLevel, setEditingLevel] = useState(null);
  const [editError, setEditError] = useState('');

  // Add states
  const [addingLevel, setAddingLevel] = useState(null);
  const [addingValue, setAddingValue] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);

  // dnd-kit sensors — require 8px movement before drag starts so clicks still work
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Load decks
  const loadDecks = useCallback(async () => {
    setPageLoading(true);
    try {
      const data = await getAllDecks(showArchivedDecks);
      setDecks(data);
    } catch (err) {
      console.error('Failed to load decks:', err);
    } finally {
      setPageLoading(false);
    }
  }, [showArchivedDecks]);

  // Load zones for selected deck
  const loadZones = useCallback(async (deckId) => {
    if (!deckId) { setZones([]); return; }
    setZonesLoading(true);
    try {
      const data = await getZonesByDeck(deckId, showArchivedZones);
      setZones(data);
    } catch (err) {
      console.error('Failed to load zones:', err);
    } finally {
      setZonesLoading(false);
    }
  }, [showArchivedZones]);

  // Load spaces for selected zone
  const loadSpaces = useCallback(async (zoneId) => {
    if (!zoneId) { setSpaces([]); return; }
    setSpacesLoading(true);
    try {
      const data = await getSpacesByZone(zoneId, showArchivedSpaces);
      setSpaces(data);
    } catch (err) {
      console.error('Failed to load spaces:', err);
    } finally {
      setSpacesLoading(false);
    }
  }, [showArchivedSpaces]);

  // Initial load
  useEffect(() => {
    if (bootstrapComplete && canAccess) {
      loadDecks();
    }
  }, [bootstrapComplete, canAccess, loadDecks]);

  // Reload zones when archived toggle changes
  useEffect(() => {
    if (selectedDeck) {
      loadZones(selectedDeck?.id);
    }
  }, [showArchivedZones, selectedDeck, loadZones]);

  // Reload spaces when archived toggle changes
  useEffect(() => {
    if (selectedZone) {
      loadSpaces(selectedZone?.id);
    }
  }, [showArchivedSpaces, selectedZone, loadSpaces]);

  // Deck Selection
  const handleSelectDeck = async (deck) => {
    setSelectedDeck(deck);
    setSelectedZone(null);
    setSpaces([]);
    await loadZones(deck?.id);
  };

  // Zone Selection
  const handleSelectZone = async (zone) => {
    setSelectedZone(zone);
    await loadSpaces(zone?.id);
  };

  // Start editing
  const startEditing = (level, item) => {
    setEditingId(item?.id);
    setEditingValue(item?.name);
    setEditingLevel(level);
    setEditError('');
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditingValue('');
    setEditingLevel(null);
    setEditError('');
  };

  // Save editing
  const saveEditing = async () => {
    const trimmedValue = editingValue?.trim();
    if (!trimmedValue) {
      setEditError('Name cannot be empty');
      return;
    }
    setSaving(true);
    try {
      if (editingLevel === 'deck') {
        await updateDeck(editingId, trimmedValue);
        await loadDecks();
        if (selectedDeck?.id === editingId) {
          setSelectedDeck(prev => ({ ...prev, name: trimmedValue }));
        }
      } else if (editingLevel === 'zone') {
        await updateZone(editingId, trimmedValue);
        await loadZones(selectedDeck?.id);
        if (selectedZone?.id === editingId) {
          setSelectedZone(prev => ({ ...prev, name: trimmedValue }));
        }
      } else if (editingLevel === 'space') {
        await updateSpace(editingId, trimmedValue);
        await loadSpaces(selectedZone?.id);
      }
      cancelEditing();
    } catch (err) {
      setEditError(err?.message || 'Rename failed — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e?.key === 'Enter') saveEditing();
    else if (e?.key === 'Escape') cancelEditing();
  };

  // Start adding
  const startAdding = (level) => {
    if (level === 'zone' && !selectedDeck) {
      setAddError('Please select a deck first');
      return;
    }
    if (level === 'space' && !selectedZone) {
      setAddError('Please select a zone first');
      return;
    }
    setAddingLevel(level);
    setAddingValue('');
    setAddError('');
  };

  // Cancel adding
  const cancelAdding = () => {
    setAddingLevel(null);
    setAddingValue('');
    setAddError('');
  };

  // Save adding
  const saveAdding = async () => {
    const trimmedValue = addingValue?.trim();
    if (!trimmedValue) {
      setAddError('Name cannot be empty');
      return;
    }
    setSaving(true);
    try {
      if (addingLevel === 'deck') {
        await createDeck(trimmedValue);
        await loadDecks();
      } else if (addingLevel === 'zone') {
        await createZone(selectedDeck?.id, trimmedValue);
        await loadZones(selectedDeck?.id);
      } else if (addingLevel === 'space') {
        await createSpace(selectedZone?.id, trimmedValue);
        await loadSpaces(selectedZone?.id);
      }
      markTutorialStep(session?.user?.id, 'locations_done').catch(() => {});
      cancelAdding();
    } catch (err) {
      setAddError(err?.message || 'Failed to create — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleAddKeyDown = (e) => {
    if (e?.key === 'Enter') saveAdding();
    else if (e?.key === 'Escape') cancelAdding();
  };

  // Archive/Unarchive handlers
  const handleToggleArchive = async (level, item) => {
    setSaving(true);
    try {
      if (level === 'deck') {
        if (item?.isArchived) await unarchiveDeck(item?.id);
        else await archiveDeck(item?.id);
        await loadDecks();
      } else if (level === 'zone') {
        if (item?.isArchived) await unarchiveZone(item?.id);
        else await archiveZone(item?.id);
        await loadZones(selectedDeck?.id);
      } else if (level === 'space') {
        if (item?.isArchived) await unarchiveSpace(item?.id);
        else await archiveSpace(item?.id);
        await loadSpaces(selectedZone?.id);
      }
    } catch (err) {
      console.error('Archive toggle failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // Drag end handlers
  const handleDeckDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active?.id === over?.id) return;

    const oldIndex = decks?.findIndex(d => d?.id === active?.id);
    const newIndex = decks?.findIndex(d => d?.id === over?.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(decks, oldIndex, newIndex);
    setDecks(reordered); // optimistic update
    try {
      await reorderLocations(reordered?.map(d => d?.id));
    } catch (err) {
      console.error('Failed to save deck order:', err);
      await loadDecks(); // revert on error
    }
  };

  const handleZoneDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active?.id === over?.id) return;

    const oldIndex = zones?.findIndex(z => z?.id === active?.id);
    const newIndex = zones?.findIndex(z => z?.id === over?.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(zones, oldIndex, newIndex);
    setZones(reordered);
    try {
      await reorderLocations(reordered?.map(z => z?.id));
    } catch (err) {
      console.error('Failed to save zone order:', err);
      await loadZones(selectedDeck?.id);
    }
  };

  const handleSpaceDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active?.id === over?.id) return;

    const oldIndex = spaces?.findIndex(s => s?.id === active?.id);
    const newIndex = spaces?.findIndex(s => s?.id === over?.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(spaces, oldIndex, newIndex);
    setSpaces(reordered);
    try {
      await reorderLocations(reordered?.map(s => s?.id));
    } catch (err) {
      console.error('Failed to save space order:', err);
      await loadSpaces(selectedZone?.id);
    }
  };

  if (!bootstrapComplete) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Access restricted to Command and Chief only.
        </div>
      );
    }
    return null;
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Header />}
      <div className={embedded ? '' : 'max-w-7xl mx-auto px-4 py-6'}>
        {/* Page Header - only shown standalone */}
        {!embedded && (
          <div className="mb-6">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900">
                Dashboard
              </button>
              <Icon name="ChevronRight" size={14} />
              <button onClick={() => navigate('/settings/vessel')} className="hover:text-gray-900">
                Vessel Hub
              </button>
              <Icon name="ChevronRight" size={14} />
              <span className="text-gray-900 font-medium">Locations</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Locations</h1>
            <p className="text-gray-600 mt-1">Manage your vessel locations (Decks, Zones, Spaces)</p>
          </div>
        )}

        {/* Three-Column Layout */}
        <div className="grid grid-cols-3 gap-4">
          {/* Column 1: Decks */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Decks</h2>
                <Button
                  size="sm"
                  onClick={() => startAdding('deck')}
                  iconName="Plus"
                  disabled={saving}
                >
                  Add
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchivedDecks}
                  onChange={(e) => setShowArchivedDecks(e?.target?.checked)}
                  className="rounded border-gray-300"
                />
                Show archived
              </label>
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {/* Add Deck Form */}
              {addingLevel === 'deck' && (
                <div className="p-3 mb-2 bg-blue-50 rounded-lg border border-blue-200">
                  <input
                    type="text"
                    value={addingValue}
                    onChange={(e) => setAddingValue(e?.target?.value)}
                    onKeyDown={handleAddKeyDown}
                    placeholder="Deck name"
                    className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none mb-2 text-gray-900"
                    autoFocus
                  />
                  {addError && (
                    <div className="text-xs text-red-600 mb-2">{addError}</div>
                  )}
                  <div className="flex gap-2">
                    <Button size="xs" onClick={saveAdding} iconName="Check" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                    <Button size="xs" variant="outline" onClick={cancelAdding} iconName="X" disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {pageLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                </div>
              ) : decks?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>No decks yet</p>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDeckDragEnd}>
                  <SortableContext items={decks?.map(d => d?.id)} strategy={verticalListSortingStrategy}>
                    {decks?.map((deck) => (
                      <SortableRow key={deck?.id} id={deck?.id}>
                        {({ dragHandleProps }) => (
                          <div
                            onClick={() => editingId !== deck?.id && handleSelectDeck(deck)}
                            className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                              selectedDeck?.id === deck?.id
                                ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              {/* Drag handle */}
                              <button
                                {...dragHandleProps}
                                onClick={(e) => e?.stopPropagation()}
                                className="p-1 mr-1 rounded cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0"
                                title="Drag to reorder"
                              >
                                <Icon name="GripVertical" size={14} />
                              </button>
                              <div className="flex-1">
                                {editingId === deck?.id && editingLevel === 'deck' ? (
                                  <div>
                                    <input
                                      type="text"
                                      value={editingValue}
                                      onChange={(e) => setEditingValue(e?.target?.value)}
                                      onKeyDown={handleKeyDown}
                                      className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-900"
                                      autoFocus
                                      onClick={(e) => e?.stopPropagation()}
                                    />
                                    {editError && (
                                      <div className="text-xs text-red-600 mt-1">{editError}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <div className="font-medium text-gray-900">{deck?.name}</div>
                                    {deck?.isArchived && (
                                      <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">Archived</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                {editingId === deck?.id && editingLevel === 'deck' ? (
                                  <>
                                    <button
                                      onClick={(e) => { e?.stopPropagation(); saveEditing(); }}
                                      className="p-1 hover:bg-green-100 rounded"
                                      title="Save"
                                      disabled={saving}
                                    >
                                      <Icon name="Check" size={14} className="text-green-600" />
                                    </button>
                                    <button
                                      onClick={(e) => { e?.stopPropagation(); cancelEditing(); }}
                                      className="p-1 hover:bg-gray-200 rounded"
                                      title="Cancel"
                                    >
                                      <Icon name="X" size={14} className="text-gray-600" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {selectedDeck?.id === deck?.id && (
                                      <>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); startEditing('deck', deck); }}
                                          className="p-1 hover:bg-blue-100 rounded"
                                          title="Rename"
                                        >
                                          <Icon name="Edit2" size={14} className="text-blue-600" />
                                        </button>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); handleToggleArchive('deck', deck); }}
                                          className="p-1 hover:bg-orange-100 rounded"
                                          title={deck?.isArchived ? 'Unarchive' : 'Archive'}
                                          disabled={saving}
                                        >
                                          <Icon name="Archive" size={14} className="text-orange-600" />
                                        </button>
                                      </>
                                    )}
                                    <Icon
                                      name="ChevronRight"
                                      size={16}
                                      className={selectedDeck?.id === deck?.id ? 'text-blue-600' : 'text-gray-400'}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </SortableRow>
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          {/* Column 2: Zones */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Zones</h2>
                {selectedDeck && (
                  <Button
                    size="sm"
                    onClick={() => startAdding('zone')}
                    iconName="Plus"
                    disabled={saving}
                  >
                    Add
                  </Button>
                )}
              </div>
              {selectedDeck && (
                <>
                  <div className="text-xs text-gray-500 mb-2">Under: {selectedDeck?.name}</div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showArchivedZones}
                      onChange={(e) => setShowArchivedZones(e?.target?.checked)}
                      className="rounded border-gray-300"
                    />
                    Show archived
                  </label>
                </>
              )}
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {!selectedDeck ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Select a deck to manage zones</p>
                </div>
              ) : (
                <>
                  {/* Add Zone Form */}
                  {addingLevel === 'zone' && (
                    <div className="p-3 mb-2 bg-blue-50 rounded-lg border border-blue-200">
                      <input
                        type="text"
                        value={addingValue}
                        onChange={(e) => setAddingValue(e?.target?.value)}
                        onKeyDown={handleAddKeyDown}
                        placeholder="Zone name"
                        className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none mb-2 text-gray-900"
                        autoFocus
                      />
                      {addError && (
                        <div className="text-xs text-red-600 mb-2">{addError}</div>
                      )}
                      <div className="flex gap-2">
                        <Button size="xs" onClick={saveAdding} iconName="Check" disabled={saving}>
                          {saving ? 'Saving...' : 'Save'}
                        </Button>
                        <Button size="xs" variant="outline" onClick={cancelAdding} iconName="X" disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {zonesLoading ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    </div>
                  ) : zones?.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <p>No zones yet</p>
                      <Button size="sm" onClick={() => startAdding('zone')} className="mt-3">
                        Add First Zone
                      </Button>
                    </div>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleZoneDragEnd}>
                      <SortableContext items={zones?.map(z => z?.id)} strategy={verticalListSortingStrategy}>
                        {zones?.map((zone) => (
                          <SortableRow key={zone?.id} id={zone?.id}>
                            {({ dragHandleProps }) => (
                              <div
                                onClick={() => editingId !== zone?.id && handleSelectZone(zone)}
                                className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                                  selectedZone?.id === zone?.id
                                    ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <button
                                    {...dragHandleProps}
                                    onClick={(e) => e?.stopPropagation()}
                                    className="p-1 mr-1 rounded cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0"
                                    title="Drag to reorder"
                                  >
                                    <Icon name="GripVertical" size={14} />
                                  </button>
                                  <div className="flex-1">
                                    {editingId === zone?.id && editingLevel === 'zone' ? (
                                      <div>
                                        <input
                                          type="text"
                                          value={editingValue}
                                          onChange={(e) => setEditingValue(e?.target?.value)}
                                          onKeyDown={handleKeyDown}
                                          className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-900"
                                          autoFocus
                                          onClick={(e) => e?.stopPropagation()}
                                        />
                                        {editError && (
                                          <div className="text-xs text-red-600 mt-1">{editError}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <div className="font-medium text-gray-900">{zone?.name}</div>
                                        {zone?.isArchived && (
                                          <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">Archived</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {editingId === zone?.id && editingLevel === 'zone' ? (
                                      <>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); saveEditing(); }}
                                          className="p-1 hover:bg-green-100 rounded"
                                          title="Save"
                                          disabled={saving}
                                        >
                                          <Icon name="Check" size={14} className="text-green-600" />
                                        </button>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); cancelEditing(); }}
                                          className="p-1 hover:bg-gray-200 rounded"
                                          title="Cancel"
                                        >
                                          <Icon name="X" size={14} className="text-gray-600" />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {selectedZone?.id === zone?.id && (
                                          <>
                                            <button
                                              onClick={(e) => { e?.stopPropagation(); startEditing('zone', zone); }}
                                              className="p-1 hover:bg-blue-100 rounded"
                                              title="Rename"
                                            >
                                              <Icon name="Edit2" size={14} className="text-blue-600" />
                                            </button>
                                            <button
                                              onClick={(e) => { e?.stopPropagation(); handleToggleArchive('zone', zone); }}
                                              className="p-1 hover:bg-orange-100 rounded"
                                              title={zone?.isArchived ? 'Unarchive' : 'Archive'}
                                              disabled={saving}
                                            >
                                              <Icon name="Archive" size={14} className="text-orange-600" />
                                            </button>
                                          </>
                                        )}
                                        <Icon
                                          name="ChevronRight"
                                          size={16}
                                          className={selectedZone?.id === zone?.id ? 'text-blue-600' : 'text-gray-400'}
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortableRow>
                        ))}
                      </SortableContext>
                    </DndContext>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Column 3: Spaces */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">Spaces</h2>
                {selectedZone && (
                  <Button
                    size="sm"
                    onClick={() => startAdding('space')}
                    iconName="Plus"
                    disabled={saving}
                  >
                    Add
                  </Button>
                )}
              </div>
              {selectedZone && (
                <>
                  <div className="text-xs text-gray-500 mb-2">Under: {selectedZone?.name}</div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showArchivedSpaces}
                      onChange={(e) => setShowArchivedSpaces(e?.target?.checked)}
                      className="rounded border-gray-300"
                    />
                    Show archived
                  </label>
                </>
              )}
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {!selectedZone ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Select a zone to manage spaces</p>
                </div>
              ) : (
                <>
                  {/* Add Space Form */}
                  {addingLevel === 'space' && (
                    <div className="p-3 mb-2 bg-blue-50 rounded-lg border border-blue-200">
                      <input
                        type="text"
                        value={addingValue}
                        onChange={(e) => setAddingValue(e?.target?.value)}
                        onKeyDown={handleAddKeyDown}
                        placeholder="Space name"
                        className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none mb-2 text-gray-900"
                        autoFocus
                      />
                      {addError && (
                        <div className="text-xs text-red-600 mb-2">{addError}</div>
                      )}
                      <div className="flex gap-2">
                        <Button size="xs" onClick={saveAdding} iconName="Check" disabled={saving}>
                          {saving ? 'Saving...' : 'Save'}
                        </Button>
                        <Button size="xs" variant="outline" onClick={cancelAdding} iconName="X" disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {spacesLoading ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    </div>
                  ) : spaces?.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <p>No spaces yet</p>
                      <Button size="sm" onClick={() => startAdding('space')} className="mt-3">
                        Add First Space
                      </Button>
                    </div>
                  ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSpaceDragEnd}>
                      <SortableContext items={spaces?.map(s => s?.id)} strategy={verticalListSortingStrategy}>
                        {spaces?.map((space) => (
                          <SortableRow key={space?.id} id={space?.id}>
                            {({ dragHandleProps }) => (
                              <div className="p-3 rounded-lg mb-2 border border-gray-200 hover:bg-gray-50 transition-colors">
                                <div className="flex items-center justify-between">
                                  <button
                                    {...dragHandleProps}
                                    onClick={(e) => e?.stopPropagation()}
                                    className="p-1 mr-1 rounded cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0"
                                    title="Drag to reorder"
                                  >
                                    <Icon name="GripVertical" size={14} />
                                  </button>
                                  <div className="flex-1">
                                    {editingId === space?.id && editingLevel === 'space' ? (
                                      <div>
                                        <input
                                          type="text"
                                          value={editingValue}
                                          onChange={(e) => setEditingValue(e?.target?.value)}
                                          onKeyDown={handleKeyDown}
                                          className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none text-gray-900"
                                          autoFocus
                                          onClick={(e) => e?.stopPropagation()}
                                        />
                                        {editError && (
                                          <div className="text-xs text-red-600 mt-1">{editError}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <div className="font-medium text-gray-900">{space?.name}</div>
                                        {space?.isArchived && (
                                          <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">Archived</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {editingId === space?.id && editingLevel === 'space' ? (
                                      <>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); saveEditing(); }}
                                          className="p-1 hover:bg-green-100 rounded"
                                          title="Save"
                                          disabled={saving}
                                        >
                                          <Icon name="Check" size={14} className="text-green-600" />
                                        </button>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); cancelEditing(); }}
                                          className="p-1 hover:bg-gray-200 rounded"
                                          title="Cancel"
                                        >
                                          <Icon name="X" size={14} className="text-gray-600" />
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); startEditing('space', space); }}
                                          className="p-1 hover:bg-blue-100 rounded"
                                          title="Rename"
                                        >
                                          <Icon name="Edit2" size={14} className="text-blue-600" />
                                        </button>
                                        <button
                                          onClick={(e) => { e?.stopPropagation(); handleToggleArchive('space', space); }}
                                          className="p-1 hover:bg-orange-100 rounded"
                                          title={space?.isArchived ? 'Unarchive' : 'Archive'}
                                          disabled={saving}
                                        >
                                          <Icon name="Archive" size={14} className="text-orange-600" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortableRow>
                        ))}
                      </SortableContext>
                    </DndContext>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationsManagementSettings;