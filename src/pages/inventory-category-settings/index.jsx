import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { getAllTaxonomyL1, getTaxonomyL2ByL1, getTaxonomyL3ByL2, getTaxonomyL4ByL3, createTaxonomyL1, createTaxonomyL2, createTaxonomyL3, createTaxonomyL4, renameTaxonomyL1, renameTaxonomyL2, renameTaxonomyL3, renameTaxonomyL4, archiveTaxonomyL2, archiveTaxonomyL3, archiveTaxonomyL4, getItemCountForL1, getItemCountForL2, getItemCountForL3, getItemCountForL4, canCreateL1, canCreateL2L3L4, migrateOldTaxonomyToNew } from '../inventory/utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';

const InventoryCategorySettings = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  
  // Access control - only Command and Chief
  const canAccess = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canManageL1 = canCreateL1();
  const canManageL2L3L4 = canCreateL2L3L4();
  const canRenameL3Categories = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canRenameL4Categories = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  // Redirect if no access
  useEffect(() => {
    if (!canAccess) {
      navigate('/dashboard');
    }
  }, [canAccess, navigate]);

  // State
  const [taxonomyL1, setTaxonomyL1] = useState([]);
  const [taxonomyL2, setTaxonomyL2] = useState([]);
  const [taxonomyL3, setTaxonomyL3] = useState([]);
  const [taxonomyL4, setTaxonomyL4] = useState([]);
  const [selectedL1, setSelectedL1] = useState(null);
  const [selectedL2, setSelectedL2] = useState(null);
  const [selectedL3, setSelectedL3] = useState(null);
  
  // Inline edit states - keyed by unique ID
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingLevel, setEditingLevel] = useState(null);
  const [editError, setEditError] = useState('');
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [modalContext, setModalContext] = useState(null);
  const [inputValue, setInputValue] = useState('');

  // Load data
  useEffect(() => {
    // Run migration on first load
    const migrationResult = migrateOldTaxonomyToNew();
    if (migrationResult?.migrated > 0) {
      console.log(migrationResult?.message);
    }
    loadData();
  }, []);

  const loadData = () => {
    setTaxonomyL1(getAllTaxonomyL1());
    if (selectedL1) {
      setTaxonomyL2(getTaxonomyL2ByL1(selectedL1?.id));
    }
    if (selectedL2) {
      setTaxonomyL3(getTaxonomyL3ByL2(selectedL2?.id));
    }
    if (selectedL3) {
      setTaxonomyL4(getTaxonomyL4ByL3(selectedL3?.id));
    }
  };

  // L1 Selection
  const handleSelectL1 = (category) => {
    setSelectedL1(category);
    setSelectedL2(null);
    setSelectedL3(null);
    setTaxonomyL2(getTaxonomyL2ByL1(category?.id));
    setTaxonomyL3([]);
    setTaxonomyL4([]);
  };

  // L2 Selection
  const handleSelectL2 = (category) => {
    setSelectedL2(category);
    setSelectedL3(null);
    setTaxonomyL3(getTaxonomyL3ByL2(category?.id));
    setTaxonomyL4([]);
  };

  // L3 Selection
  const handleSelectL3 = (category) => {
    setSelectedL3(category);
    setTaxonomyL4(getTaxonomyL4ByL3(category?.id));
  };

  // Add handlers
  const handleAdd = (level) => {
    setModalContext({ action: 'add', level });
    setInputValue('');
    setShowAddModal(true);
  };

  const handleAddSubmit = () => {
    if (!inputValue?.trim()) return;

    let success = false;
    if (modalContext?.level === 'L1') {
      const newL1 = createTaxonomyL1(inputValue?.trim());
      success = !!newL1;
    } else if (modalContext?.level === 'L2' && selectedL1) {
      const newL2 = createTaxonomyL2(selectedL1?.id, inputValue?.trim());
      success = !!newL2;
    } else if (modalContext?.level === 'L3' && selectedL2) {
      const newL3 = createTaxonomyL3(selectedL1?.id, selectedL2?.id, inputValue?.trim());
      success = !!newL3;
    } else if (modalContext?.level === 'L4' && selectedL3) {
      const newL4 = createTaxonomyL4(selectedL1?.id, selectedL2?.id, selectedL3?.id, inputValue?.trim());
      success = !!newL4;
    }

    if (success) {
      setShowAddModal(false);
      setInputValue('');
      loadData();
    }
  };

  // Inline rename handlers
  const startEditing = (level, category) => {
    setEditingId(category?.id);
    setEditingLevel(level);
    setEditingValue(category?.name);
    setEditError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingLevel(null);
    setEditingValue('');
    setEditError('');
  };

  const saveEditing = () => {
    const trimmedValue = editingValue?.trim();
    
    // Validation
    if (!trimmedValue) {
      setEditError("Name can't be blank");
      return;
    }

    // Permission check for L3 rename
    if (editingLevel === 'L3' && !canRenameL3Categories) {
      setEditError('Only Command and Chief can rename Sub-Categories');
      return;
    }

    // Permission check for L4 rename
    if (editingLevel === 'L4' && !canRenameL4Categories) {
      setEditError('Only Command and Chief can rename Types');
      return;
    }

    let success = false;
    
    // Call appropriate rename function based on level
    if (editingLevel === 'L1') {
      success = renameTaxonomyL1(editingId, trimmedValue);
    } else if (editingLevel === 'L2') {
      success = renameTaxonomyL2(editingId, trimmedValue);
    } else if (editingLevel === 'L3') {
      success = renameTaxonomyL3(editingId, trimmedValue);
    } else if (editingLevel === 'L4') {
      success = renameTaxonomyL4(editingId, trimmedValue);
    }

    if (success) {
      // Update state immutably
      if (editingLevel === 'L1') {
        setTaxonomyL1(prev => prev?.map(item => 
          item?.id === editingId ? { ...item, name: trimmedValue } : item
        ));
        if (selectedL1?.id === editingId) {
          setSelectedL1(prev => ({ ...prev, name: trimmedValue }));
        }
      } else if (editingLevel === 'L2') {
        setTaxonomyL2(prev => prev?.map(item => 
          item?.id === editingId ? { ...item, name: trimmedValue } : item
        ));
        if (selectedL2?.id === editingId) {
          setSelectedL2(prev => ({ ...prev, name: trimmedValue }));
        }
      } else if (editingLevel === 'L3') {
        setTaxonomyL3(prev => prev?.map(item => 
          item?.id === editingId ? { ...item, name: trimmedValue } : item
        ));
        if (selectedL3?.id === editingId) {
          setSelectedL3(prev => ({ ...prev, name: trimmedValue }));
        }
      } else if (editingLevel === 'L4') {
        setTaxonomyL4(prev => prev?.map(item => 
          item?.id === editingId ? { ...item, name: trimmedValue } : item
        ));
      }
      
      // Clear edit state
      cancelEditing();
    } else {
      // Show specific permission error based on level
      if (editingLevel === 'L3') {
        setEditError('Only Command and Chief can rename Sub-Categories');
      } else if (editingLevel === 'L4') {
        setEditError('Only Command and Chief can rename Types');
      } else {
        setEditError('Rename failed — try again');
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e?.key === 'Enter') {
      saveEditing();
    } else if (e?.key === 'Escape') {
      cancelEditing();
    }
  };

  // Archive handlers
  const handleArchive = (level, category) => {
    setModalContext({ action: 'archive', level, category });
    setShowArchiveModal(true);
  };

  const handleArchiveSubmit = () => {
    let success = false;
    if (modalContext?.level === 'L2') {
      success = archiveTaxonomyL2(modalContext?.category?.id);
    } else if (modalContext?.level === 'L3') {
      success = archiveTaxonomyL3(modalContext?.category?.id);
    } else if (modalContext?.level === 'L4') {
      success = archiveTaxonomyL4(modalContext?.category?.id);
    }

    if (success) {
      setShowArchiveModal(false);
      loadData();
    }
  };

  if (!canAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Inventory Categories</h1>
          <p className="text-muted-foreground">
            Manage inventory category names
          </p>
        </div>

        {/* Four-Column Layout */}
        <div className="grid grid-cols-4 gap-4">
          {/* Column 1: Inventory Group */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Inventory Group</h2>
                {canManageL1 && (
                  <Button
                    size="sm"
                    onClick={() => handleAdd('L1')}
                    iconName="Plus"
                  >
                    Add
                  </Button>
                )}
              </div>
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {taxonomyL1?.map((category) => (
                <div
                  key={category?.id}
                  onClick={() => editingId !== category?.id && handleSelectL1(category)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                    selectedL1?.id === category?.id
                      ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {editingId === category?.id && editingLevel === 'L1' ? (
                        <div>
                          <input
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e?.target?.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            autoFocus
                            onClick={(e) => e?.stopPropagation()}
                          />
                          {editError && (
                            <div className="text-xs text-red-600 mt-1">{editError}</div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="font-medium text-gray-900">{category?.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {getItemCountForL1(category?.id)} items
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {editingId === category?.id && editingLevel === 'L1' ? (
                        <>
                          <button
                            onClick={(e) => {
                              e?.stopPropagation();
                              saveEditing();
                            }}
                            className="p-1 hover:bg-green-100 rounded"
                            title="Save"
                          >
                            <Icon name="Check" size={14} className="text-green-600" />
                          </button>
                          <button
                            onClick={(e) => {
                              e?.stopPropagation();
                              cancelEditing();
                            }}
                            className="p-1 hover:bg-gray-200 rounded"
                            title="Cancel"
                          >
                            <Icon name="X" size={14} className="text-gray-600" />
                          </button>
                        </>
                      ) : (
                        <>
                          {canManageL1 && selectedL1?.id === category?.id && (
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                startEditing('L1', category);
                              }}
                              className="p-1 hover:bg-blue-100 rounded transition-opacity"
                              title="Rename"
                            >
                              <Icon name="Edit2" size={14} className="text-blue-600" />
                            </button>
                          )}
                          <Icon
                            name="ChevronRight"
                            size={16}
                            className={selectedL1?.id === category?.id ? 'text-blue-600' : 'text-gray-400'}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Column 2: Category */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Category</h2>
                {canManageL2L3L4 && selectedL1 && (
                  <Button
                    size="sm"
                    onClick={() => handleAdd('L2')}
                    iconName="Plus"
                  >
                    Add
                  </Button>
                )}
              </div>
              {selectedL1 && (
                <div className="text-xs text-gray-500 mt-1">Under: {selectedL1?.name}</div>
              )}
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {!selectedL1 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Select an Inventory Group</p>
                </div>
              ) : taxonomyL2?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No categories yet</p>
                  {canManageL2L3L4 && (
                    <Button size="sm" onClick={() => handleAdd('L2')} className="mt-3">
                      Add First Category
                    </Button>
                  )}
                </div>
              ) : (
                taxonomyL2?.map((category) => (
                  <div
                    key={category?.id}
                    onClick={() => editingId !== category?.id && handleSelectL2(category)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                      selectedL2?.id === category?.id
                        ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        {editingId === category?.id && editingLevel === 'L2' ? (
                          <div>
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e?.target?.value)}
                              onKeyDown={handleKeyDown}
                              className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              autoFocus
                              onClick={(e) => e?.stopPropagation()}
                            />
                            {editError && (
                              <div className="text-xs text-red-600 mt-1">{editError}</div>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="font-medium text-gray-900">{category?.name}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {getItemCountForL2(category?.id)} items
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {editingId === category?.id && editingLevel === 'L2' ? (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                saveEditing();
                              }}
                              className="p-1 hover:bg-green-100 rounded"
                              title="Save"
                            >
                              <Icon name="Check" size={14} className="text-green-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                cancelEditing();
                              }}
                              className="p-1 hover:bg-gray-200 rounded"
                              title="Cancel"
                            >
                              <Icon name="X" size={14} className="text-gray-600" />
                            </button>
                          </>
                        ) : (
                          <>
                            {canManageL2L3L4 && selectedL2?.id === category?.id && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    startEditing('L2', category);
                                  }}
                                  className="p-1 hover:bg-blue-100 rounded"
                                  title="Rename"
                                >
                                  <Icon name="Edit2" size={14} className="text-blue-600" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    handleArchive('L2', category);
                                  }}
                                  className="p-1 hover:bg-red-100 rounded"
                                  title="Archive"
                                >
                                  <Icon name="Archive" size={14} className="text-red-600" />
                                </button>
                              </>
                            )}
                            <Icon
                              name="ChevronRight"
                              size={16}
                              className={selectedL2?.id === category?.id ? 'text-blue-600' : 'text-gray-400'}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 3: Sub-Category */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Sub-Category</h2>
                {canManageL2L3L4 && selectedL2 && (
                  <Button
                    size="sm"
                    onClick={() => handleAdd('L3')}
                    iconName="Plus"
                  >
                    Add
                  </Button>
                )}
              </div>
              {selectedL2 && (
                <div className="text-xs text-gray-500 mt-1">Under: {selectedL2?.name}</div>
              )}
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {!selectedL2 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Select a Category</p>
                </div>
              ) : taxonomyL3?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No sub-categories yet</p>
                </div>
              ) : (
                taxonomyL3?.map((category) => (
                  <div
                    key={category?.id}
                    onClick={() => editingId !== category?.id && handleSelectL3(category)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                      selectedL3?.id === category?.id
                        ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        {editingId === category?.id && editingLevel === 'L3' ? (
                          <div>
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e?.target?.value)}
                              onKeyDown={handleKeyDown}
                              className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              autoFocus
                              onClick={(e) => e?.stopPropagation()}
                            />
                            {editError && (
                              <div className="text-xs text-red-600 mt-1">{editError}</div>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="font-medium text-gray-900">{category?.name}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {getItemCountForL3(category?.id)} items
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {editingId === category?.id && editingLevel === 'L3' ? (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                saveEditing();
                              }}
                              className="p-1 hover:bg-green-100 rounded"
                              title="Save"
                            >
                              <Icon name="Check" size={14} className="text-green-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                cancelEditing();
                              }}
                              className="p-1 hover:bg-gray-200 rounded"
                              title="Cancel"
                            >
                              <Icon name="X" size={14} className="text-gray-600" />
                            </button>
                          </>
                        ) : (
                          <>
                            {canRenameL3Categories && selectedL3?.id === category?.id && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    startEditing('L3', category);
                                  }}
                                  className="p-1 hover:bg-blue-100 rounded"
                                  title="Rename"
                                >
                                  <Icon name="Edit2" size={14} className="text-blue-600" />
                                </button>
                              </>
                            )}
                            {canManageL2L3L4 && selectedL3?.id === category?.id && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    handleArchive('L3', category);
                                  }}
                                  className="p-1 hover:bg-red-100 rounded"
                                  title="Archive"
                                >
                                  <Icon name="Archive" size={14} className="text-red-600" />
                                </button>
                              </>
                            )}
                            <Icon
                              name="ChevronRight"
                              size={16}
                              className={selectedL3?.id === category?.id ? 'text-blue-600' : 'text-gray-400'}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 4: Type */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Type</h2>
                {canManageL2L3L4 && selectedL3 && (
                  <Button
                    size="sm"
                    onClick={() => handleAdd('L4')}
                    iconName="Plus"
                  >
                    Add
                  </Button>
                )}
              </div>
              {selectedL3 && (
                <div className="text-xs text-gray-500 mt-1">Under: {selectedL3?.name}</div>
              )}
            </div>
            <div className="p-2 max-h-[600px] overflow-y-auto">
              {!selectedL3 ? (
                <div className="text-center py-12 text-gray-500">
                  <Icon name="FolderOpen" size={48} className="mx-auto mb-2 opacity-30" />
                  <p>Select a Sub-Category</p>
                </div>
              ) : taxonomyL4?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-sm">No Type classifications</p>
                  <p className="text-xs mt-1">(Optional level)</p>
                </div>
              ) : (
                taxonomyL4?.map((category) => (
                  <div
                    key={category?.id}
                    className="p-3 rounded-lg hover:bg-gray-50 border border-transparent mb-2 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        {editingId === category?.id && editingLevel === 'L4' ? (
                          <div>
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e?.target?.value)}
                              onKeyDown={handleKeyDown}
                              className="w-full px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              autoFocus
                              onClick={(e) => e?.stopPropagation()}
                            />
                            {editError && (
                              <div className="text-xs text-red-600 mt-1">{editError}</div>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="font-medium text-gray-900">{category?.name}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {getItemCountForL4(category?.id)} items
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {editingId === category?.id && editingLevel === 'L4' ? (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                saveEditing();
                              }}
                              className="p-1 hover:bg-green-100 rounded"
                              title="Save"
                            >
                              <Icon name="Check" size={14} className="text-green-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                cancelEditing();
                              }}
                              className="p-1 hover:bg-gray-200 rounded"
                              title="Cancel"
                            >
                              <Icon name="X" size={14} className="text-gray-600" />
                            </button>
                          </>
                        ) : (
                          <>
                            {canRenameL4Categories && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    startEditing('L4', category);
                                  }}
                                  className="p-1 hover:bg-blue-100 rounded"
                                  title="Rename"
                                >
                                  <Icon name="Edit2" size={14} className="text-blue-600" />
                                </button>
                              </>
                            )}
                            {canManageL2L3L4 && (
                                <button
                                  onClick={(e) => {
                                    e?.stopPropagation();
                                    handleArchive('L4', category);
                                  }}
                                  className="p-1 hover:bg-red-100 rounded"
                                  title="Archive"
                                >
                                  <Icon name="Archive" size={14} className="text-red-600" />
                                </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Add {modalContext?.level === 'L1' ? 'Inventory Group' : modalContext?.level === 'L2' ? 'Category' : modalContext?.level === 'L3' ? 'Sub-Category' : 'Type'}
            </h3>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e?.target?.value)}
              placeholder="Enter name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddModal(false);
                  setInputValue('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleAddSubmit}>Add</Button>
            </div>
          </div>
        </div>
      )}
      {/* Archive Modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Archive Category</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to archive "{modalContext?.category?.name}"? Items will retain their historical link.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowArchiveModal(false)}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={handleArchiveSubmit}>
                Archive
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryCategorySettings;