import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { loadPresets, addPreset, updatePreset, deletePreset, getCrewWorkEntries } from '../utils/horStorage';

const QuickEntryModal = ({ isOpen, onClose, onSave, initialDate, crewId }) => {
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedSegments, setSelectedSegments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [showEditPresetModal, setShowEditPresetModal] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const [editingPreset, setEditingPreset] = useState(null);

  // Load presets from localStorage on mount
  useEffect(() => {
    if (isOpen) {
      const presets = loadPresets();
      setSavedPresets(presets);
      
      // If initialDate provided, pre-select it and load existing work segments
      if (initialDate) {
        setSelectedDates([initialDate]);
        
        // Load existing work segments for this date if editing
        if (crewId) {
          const entries = getCrewWorkEntries(crewId);
          const dateEntries = entries?.filter(entry => entry?.date === initialDate);
          
          if (dateEntries?.length > 0) {
            // Get all work segments from entries for this date
            const existingSegments = [];
            dateEntries?.forEach(entry => {
              if (entry?.workSegments) {
                existingSegments?.push(...entry?.workSegments);
              }
            });
            
            // Remove duplicates and sort
            const uniqueSegments = [...new Set(existingSegments)]?.sort((a, b) => a - b);
            setSelectedSegments(uniqueSegments);
          }
        }
      }
    }
  }, [isOpen, initialDate, crewId]);

  if (!isOpen) return null;

  const getDaysInMonth = (date) => {
    const year = date?.getFullYear();
    const month = date?.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay?.getDate();
    const startingDayOfWeek = firstDay?.getDay();
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);
  const monthName = currentMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const handleDateClick = (date) => {
    const dateStr = date?.toISOString()?.split('T')?.[0];
    const today = new Date();
    today?.setHours(0, 0, 0, 0);
    
    // Disable future dates
    if (date > today) return;

    setSelectedDates(prev => {
      if (prev?.includes(dateStr)) {
        return prev?.filter(d => d !== dateStr);
      } else {
        return [...prev, dateStr];
      }
    });
  };

  const handleSegmentClick = (segmentIndex) => {
    setSelectedSegments(prev => {
      if (prev?.includes(segmentIndex)) {
        return prev?.filter(s => s !== segmentIndex);
      } else {
        return [...prev, segmentIndex]?.sort((a, b) => a - b);
      }
    });
  };

  const handleSegmentMouseDown = (segmentIndex) => {
    setIsDragging(true);
    handleSegmentClick(segmentIndex);
  };

  const handleSegmentMouseEnter = (segmentIndex) => {
    if (isDragging) {
      handleSegmentClick(segmentIndex);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const getTimeLabel = (segmentIndex) => {
    const hours = Math.floor(segmentIndex / 2);
    const minutes = (segmentIndex % 2) * 30;
    return `${hours?.toString()?.padStart(2, '0')}:${minutes?.toString()?.padStart(2, '0')}`;
  };

  const handleSavePreset = () => {
    if (!presetName?.trim() || selectedSegments?.length === 0) return;
    
    const newPreset = addPreset(presetName, selectedSegments);
    setSavedPresets(prev => [...prev, newPreset]);
    setPresetName('');
    setShowSavePresetModal(false);
    setShowPresetModal(true);
  };

  const handleUpdatePreset = () => {
    if (!presetName?.trim() || !editingPreset) return;
    
    const updated = updatePreset(editingPreset?.id, { 
      name: presetName,
      segments: [...selectedSegments]
    });
    setSavedPresets(prev => prev?.map(p => p?.id === updated?.id ? updated : p));
    setPresetName('');
    setEditingPreset(null);
    setShowEditPresetModal(false);
    setShowPresetModal(true);
  };

  const handleDeletePreset = (presetId) => {
    if (confirm('Are you sure you want to delete this preset?')) {
      deletePreset(presetId);
      setSavedPresets(prev => prev?.filter(p => p?.id !== presetId));
    }
  };

  const handleEditPreset = (preset) => {
    setEditingPreset(preset);
    setPresetName(preset?.name);
    setSelectedSegments([...preset?.segments]);
    setShowPresetModal(false);
    setShowEditPresetModal(true);
  };

  const handleApplyPreset = (preset) => {
    setSelectedSegments([...preset?.segments]);
    setShowPresetModal(false);
  };

  const handleSaveEntry = () => {
    if (selectedDates?.length === 0 || selectedSegments?.length === 0) {
      alert('Please select at least one date and mark work time on the time bar');
      return;
    }
    
    // Save work entries for each selected date
    const entries = selectedDates?.map(dateStr => ({
      date: dateStr,
      workSegments: [...selectedSegments],
      workHours: selectedSegments?.length * 0.5,
      timestamp: new Date()?.toISOString()
    }));
    
    // Call onSave callback to update parent component
    if (onSave) {
      onSave(entries);
    }
    
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseUp={handleMouseUp}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div 
        className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e?.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Add Entry</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={18} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2 flex-1 min-h-0 overflow-y-auto">
          {/* Section 1: Calendar */}
          <div className="flex justify-center">
            <div className="w-full max-w-[50%]">
              <h3 className="text-sm font-semibold text-foreground mb-1.5 text-center">Select Date(s)</h3>
              <div className="bg-muted/30 rounded-lg p-2">
                {/* Month Navigation */}
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                    className="p-1 hover:bg-muted rounded-lg transition-smooth"
                  >
                    <Icon name="ChevronLeft" size={14} className="text-foreground" />
                  </button>
                  <span className="text-xs font-semibold text-foreground">{monthName}</span>
                  <button
                    onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                    className="p-1 hover:bg-muted rounded-lg transition-smooth"
                  >
                    <Icon name="ChevronRight" size={14} className="text-foreground" />
                  </button>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-0.5">
                  {/* Day Headers */}
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S']?.map((day, index) => (
                    <div key={index} className="text-center text-[8px] font-semibold text-muted-foreground py-0.5">
                      {day}
                    </div>
                  ))}

                  {/* Empty cells - adjust for Monday start */}
                  {Array.from({ length: startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1 })?.map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square" />
                  ))}

                  {/* Calendar days */}
                  {Array.from({ length: daysInMonth })?.map((_, index) => {
                    const day = index + 1;
                    const date = new Date(year, month, day);
                    const dateStr = date?.toISOString()?.split('T')?.[0];
                    const isSelected = selectedDates?.includes(dateStr);
                    const today = new Date();
                    today?.setHours(0, 0, 0, 0);
                    const isFuture = date > today;

                    return (
                      <button
                        key={day}
                        onClick={() => handleDateClick(date)}
                        disabled={isFuture}
                        className={`aspect-square rounded text-[9px] font-semibold transition-smooth ${
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : isFuture
                            ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed'
                            : 'bg-background text-foreground hover:bg-muted cursor-pointer'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>

                {selectedDates?.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-border">
                    <p className="text-[10px] text-muted-foreground text-center">
                      <span className="font-semibold text-foreground">{selectedDates?.length}</span> date(s) selected
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Work Time Bar */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1.5">Mark Work Time</h3>
            <div className="bg-muted/30 rounded-lg p-2">
              {/* Time Bar */}
              <div className="mb-1">
                <div className="flex gap-0.5" onMouseLeave={handleMouseUp}>
                  {Array.from({ length: 48 })?.map((_, index) => (
                    <div
                      key={index}
                      onMouseDown={() => handleSegmentMouseDown(index)}
                      onMouseEnter={() => handleSegmentMouseEnter(index)}
                      className={`flex-1 h-6 cursor-pointer transition-smooth border border-border/50 ${
                        selectedSegments?.includes(index)
                          ? 'bg-primary hover:bg-primary/90' :'bg-background hover:bg-muted'
                      }`}
                      style={{ userSelect: 'none' }}
                    />
                  ))}
                </div>
              </div>

              {/* Time Labels */}
              <div className="relative h-4">
                <div className="flex justify-between text-[8px] text-muted-foreground">
                  {Array.from({ length: 25 })?.map((_, index) => {
                    const segmentIndex = index * 2;
                    return (
                      <span key={index} className="absolute" style={{ left: `${(segmentIndex / 48) * 100}%`, transform: 'translateX(-50%)' }}>
                        {getTimeLabel(segmentIndex)}
                      </span>
                    );
                  })}
                </div>
              </div>

              {selectedSegments?.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-border">
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{selectedSegments?.length * 0.5}</span> hours of work time marked
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Shift Patterns */}
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              iconName="Save"
              onClick={() => {
                setShowSavePresetModal(true);
                setShowPresetModal(false);
              }}
              disabled={selectedSegments?.length === 0}
              className="text-xs py-1.5 h-8"
            >
              Set Shift Pattern
            </Button>
            <Button 
              variant="outline" 
              iconName="List"
              onClick={() => setShowPresetModal(true)}
              className="text-xs py-1.5 h-8"
            >
              Select Preset
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-card border-t border-border px-3 py-2 flex items-center justify-end gap-2 flex-shrink-0">
          <Button variant="outline" onClick={onClose} className="text-xs h-8">
            Cancel
          </Button>
          <Button 
            variant="default" 
            onClick={handleSaveEntry}
            disabled={selectedDates?.length === 0 || selectedSegments?.length === 0}
            className="text-xs h-8"
          >
            Save Entry
          </Button>
        </div>
      </div>
      {/* Save Preset Modal */}
      {showSavePresetModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowSavePresetModal(false);
              setPresetName('');
            }}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Save Shift Pattern</h3>
            <Input
              label="Pattern Name"
              value={presetName}
              onChange={(e) => setPresetName(e?.target?.value)}
              placeholder="e.g. Morning Shift"
            />
            <div className="flex items-center gap-3 mt-6">
              <Button variant="outline" onClick={() => {
                setShowSavePresetModal(false);
                setPresetName('');
              }} fullWidth>
                Cancel
              </Button>
              <Button 
                variant="default" 
                onClick={handleSavePreset}
                disabled={!presetName?.trim()}
                fullWidth
              >
                Save Pattern
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Preset Modal */}
      {showEditPresetModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowEditPresetModal(false);
              setEditingPreset(null);
              setPresetName('');
            }}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Edit Shift Pattern</h3>
            <Input
              label="Pattern Name"
              value={presetName}
              onChange={(e) => setPresetName(e?.target?.value)}
              placeholder="e.g. Morning Shift"
            />
            <div className="flex items-center gap-3 mt-6">
              <Button variant="outline" onClick={() => {
                setShowEditPresetModal(false);
                setEditingPreset(null);
                setPresetName('');
              }} fullWidth>
                Cancel
              </Button>
              <Button 
                variant="default" 
                onClick={handleUpdatePreset}
                disabled={!presetName?.trim()}
                fullWidth
              >
                Update Pattern
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Select Preset Modal */}
      {showPresetModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowPresetModal(false)}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-foreground mb-4">Select Shift Pattern</h3>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {savedPresets?.length > 0 ? (
                savedPresets?.map(preset => (
                  <div
                    key={preset?.id}
                    className="flex items-center gap-2 w-full px-4 py-3 bg-muted/50 hover:bg-muted rounded-lg transition-smooth"
                  >
                    <button
                      onClick={() => handleApplyPreset(preset)}
                      className="flex-1 text-left"
                    >
                      <div className="font-medium text-foreground">{preset?.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {preset?.segments?.length * 0.5} hours
                      </div>
                    </button>
                    <button
                      onClick={() => handleEditPreset(preset)}
                      className="p-2 hover:bg-background rounded-lg transition-smooth"
                      title="Edit preset"
                    >
                      <Icon name="Edit" size={16} className="text-muted-foreground hover:text-foreground" />
                    </button>
                    <button
                      onClick={() => handleDeletePreset(preset?.id)}
                      className="p-2 hover:bg-background rounded-lg transition-smooth"
                      title="Delete preset"
                    >
                      <Icon name="Trash2" size={16} className="text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">No saved presets yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Create a shift pattern to get started</p>
                </div>
              )}
            </div>
            <div className="mt-4">
              <Button variant="outline" onClick={() => setShowPresetModal(false)} fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickEntryModal;