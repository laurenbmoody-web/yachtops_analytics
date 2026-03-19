import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { getAllTaxonomyL1, getTaxonomyL2ByL1, getTaxonomyL3ByL2, getTaxonomyL4ByL3, createTaxonomyL1, createTaxonomyL2, createTaxonomyL3, createTaxonomyL4, renameTaxonomyL1, renameTaxonomyL2, renameTaxonomyL3, renameTaxonomyL4, archiveTaxonomyL2, archiveTaxonomyL3, archiveTaxonomyL4, getItemCountForL1, getItemCountForL2, getItemCountForL3, getItemCountForL4, canCreateL1, canCreateL2L3L4, migrateOldTaxonomyToNew } from '../inventory/utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';

const FourLevelTaxonomyAdministration = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  
  // Access control - only Command and Chief
  const canAccess = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canManageL1 = canCreateL1();
  const canManageL2L3L4 = canCreateL2L3L4();

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
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
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

  // Rename handlers
  const handleRename = (level, category) => {
    setModalContext({ action: 'rename', level, category });
    setInputValue(category?.name);
    setShowRenameModal(true);
  };

  const handleRenameSubmit = () => {
    if (!inputValue?.trim()) return;

    let success = false;
    if (modalContext?.level === 'L1') {
      success = renameTaxonomyL1(modalContext?.category?.id, inputValue?.trim());
    } else if (modalContext?.level === 'L2') {
      success = renameTaxonomyL2(modalContext?.category?.id, inputValue?.trim());
    } else if (modalContext?.level === 'L3') {
      success = renameTaxonomyL3(modalContext?.category?.id, inputValue?.trim());
    } else if (modalContext?.level === 'L4') {
      success = renameTaxonomyL4(modalContext?.category?.id, inputValue?.trim());
    }

    if (success) {
      setShowRenameModal(false);
      setInputValue('');
      loadData();
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
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900">
              Dashboard
            </button>
            <Icon name="ChevronRight" size={14} />
            <button onClick={() => navigate('/inventory')} className="hover:text-gray-900">
              Inventory
            </button>
            <Icon name="ChevronRight" size={14} />
            <span className="text-gray-900 font-medium">4-Level Taxonomy Administration</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">4-Level Taxonomy Administration</h1>
          <p className="text-gray-600 mt-1">Manage hierarchical inventory categories with ID-based relationships</p>
        </div>

        {/* Four-Column Layout */}
        <div className="grid grid-cols-4 gap-4">
          {/* Column 1: L1 Operational Domains */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">L1 Domains</h2>
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
                  onClick={() => handleSelectL1(category)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                    selectedL1?.id === category?.id
                      ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{category?.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {getItemCountForL1(category?.id)} items
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canManageL1 && selectedL1?.id === category?.id && (
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handleRename('L1', category);
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
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Column 2: L2 Categories */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">L2 Categories</h2>
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
                  <p>Select an L1 domain</p>
                </div>
              ) : taxonomyL2?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No categories yet</p>
                </div>
              ) : (
                taxonomyL2?.map((category) => (
                  <div
                    key={category?.id}
                    onClick={() => handleSelectL2(category)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                      selectedL2?.id === category?.id
                        ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{category?.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {getItemCountForL2(category?.id)} items
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {canManageL2L3L4 && selectedL2?.id === category?.id && (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                handleRename('L2', category);
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
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 3: L3 Subcategories */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">L3 Subcategories</h2>
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
                  <p>Select an L2 category</p>
                </div>
              ) : taxonomyL3?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p>No subcategories yet</p>
                </div>
              ) : (
                taxonomyL3?.map((category) => (
                  <div
                    key={category?.id}
                    onClick={() => handleSelectL3(category)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 group ${
                      selectedL3?.id === category?.id
                        ? 'bg-blue-50 border border-blue-200' :'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{category?.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {getItemCountForL3(category?.id)} items
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {canManageL2L3L4 && selectedL3?.id === category?.id && (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                handleRename('L3', category);
                              }}
                              className="p-1 hover:bg-blue-100 rounded"
                              title="Rename"
                            >
                              <Icon name="Edit2" size={14} className="text-blue-600" />
                            </button>
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
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 4: L4 Optional */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">L4 Optional</h2>
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
                  <p>Select an L3 subcategory</p>
                </div>
              ) : taxonomyL4?.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-sm">No L4 classifications</p>
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
                        <div className="font-medium text-gray-900">{category?.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {getItemCountForL4(category?.id)} items
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {canManageL2L3L4 && (
                          <>
                            <button
                              onClick={(e) => {
                                e?.stopPropagation();
                                handleRename('L4', category);
                              }}
                              className="p-1 hover:bg-blue-100 rounded"
                              title="Rename"
                            >
                              <Icon name="Edit2" size={14} className="text-blue-600" />
                            </button>
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
              Add {modalContext?.level} Category
            </h3>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e?.target?.value)}
              placeholder="Enter category name"
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

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Rename {modalContext?.level} Category
            </h3>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e?.target?.value)}
              placeholder="Enter new name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRenameModal(false);
                  setInputValue('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleRenameSubmit}>Rename</Button>
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

export default FourLevelTaxonomyAdministration;