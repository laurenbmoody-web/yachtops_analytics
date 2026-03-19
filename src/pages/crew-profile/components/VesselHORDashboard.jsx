import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { loadUsers, Department } from '../../../utils/authStorage';
import { getComplianceStatus, detectBreaches, getCrewWorkEntries, getMonthConfirmation, sendManualNudge } from '../utils/horStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import CrewHORDrawer from './CrewHORDrawer';
import ExportAuditModal from './ExportAuditModal';
import RequestCorrectionModal from './RequestCorrectionModal';


import { showToast } from '../../../utils/toast';

const VesselHORDashboard = ({ currentMonth, onMonthChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [crewList, setCrewList] = useState([]);
  const [filteredCrew, setFilteredCrew] = useState([]);
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [showCrewDrawer, setShowCrewDrawer] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState(null);
  const [sortConfig, setSortConfig] = useState({ column: null, direction: null });
  const [showLockMonthModal, setShowLockMonthModal] = useState(false);
  const [showUnlockMonthModal, setShowUnlockMonthModal] = useState(false);
  const [isMonthLocked, setIsMonthLocked] = useState(false);

  // Load crew list with HOR summary
  useEffect(() => {
    loadCrewData();
    checkMonthLockStatus();
  }, [currentMonth]);

  // Apply filters
  useEffect(() => {
    applyFilters();
  }, [crewList, searchQuery, departmentFilter, statusFilter, sortConfig]);

  const checkMonthLockStatus = () => {
    const users = loadUsers();
    if (users?.length === 0) return;
    
    const year = currentMonth?.getFullYear();
    const month = currentMonth?.getMonth();
    const firstCrewConfirmation = getMonthConfirmation(users?.[0]?.id, year, month);
    
    setIsMonthLocked(firstCrewConfirmation?.locked || false);
  };

  const loadCrewData = () => {
    const users = loadUsers();
    const crewWithHOR = users?.map(user => {
      const complianceStatus = getComplianceStatus(user?.id);
      const entries = getCrewWorkEntries(user?.id);
      const breaches = detectBreaches(user?.id);
      
      // Calculate month progress
      const year = currentMonth?.getFullYear();
      const month = currentMonth?.getMonth();
      const daysInMonth = new Date(year, month + 1, 0)?.getDate();
      const today = new Date();
      const currentDay = today?.getMonth() === month && today?.getFullYear() === year ? today?.getDate() : daysInMonth;
      
      const entriesThisMonth = entries?.filter(entry => {
        const entryDate = new Date(entry?.date);
        return entryDate?.getMonth() === month && entryDate?.getFullYear() === year;
      });
      
      const uniqueDatesLogged = new Set(entriesThisMonth?.map(e => e?.date))?.size;
      const monthProgress = `${uniqueDatesLogged}/${currentDay} days logged`;
      
      // Determine month status
      let monthStatus = 'Draft';
      const monthConfirmation = getMonthConfirmation(user?.id, year, month);
      if (monthConfirmation?.locked) {
        monthStatus = 'Locked';
      } else if (monthConfirmation?.confirmed) {
        monthStatus = 'Confirmed by Crew';
      }
      
      // Rolling 24h status
      const rolling24hStatus = complianceStatus?.last24HoursRest >= 10 ? 'Compliant' : 'Breach';
      
      // Rolling 7d status
      const rolling7dStatus = complianceStatus?.last7DaysRest >= 77 ? 'Compliant' : 'Breach';
      
      // Last updated
      const lastEntry = entries?.sort((a, b) => new Date(b?.timestamp) - new Date(a?.timestamp))?.[0];
      const lastUpdated = lastEntry?.timestamp ? new Date(lastEntry?.timestamp)?.toLocaleString('en-GB') : 'Never';
      
      // Overall status for filtering
      let overallStatus = 'Compliant';
      if (uniqueDatesLogged < currentDay) {
        overallStatus = 'Missing entries';
      } else if (monthStatus === 'Draft') {
        overallStatus = 'Not confirmed';
      } else if (rolling24hStatus === 'Breach' || rolling7dStatus === 'Breach') {
        overallStatus = 'Breach';
      }
      
      return {
        ...user,
        monthProgress,
        monthStatus,
        rolling24hStatus,
        rolling7dStatus,
        lastUpdated,
        overallStatus,
        uniqueDatesLogged,
        currentDay
      };
    });
    
    setCrewList(crewWithHOR);
  };

  const applyFilters = () => {
    let filtered = [...crewList];
    
    // Search filter
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(crew => 
        crew?.fullName?.toLowerCase()?.includes(query) ||
        crew?.roleTitle?.toLowerCase()?.includes(query) ||
        crew?.department?.toLowerCase()?.includes(query)
      );
    }
    
    // Department filter
    if (departmentFilter !== 'All') {
      filtered = filtered?.filter(crew => crew?.department === departmentFilter);
    }
    
    // Status filter
    if (statusFilter !== 'All') {
      filtered = filtered?.filter(crew => crew?.overallStatus === statusFilter);
    }
    
    // Sort
    if (sortConfig?.column) {
      filtered?.sort((a, b) => {
        let aVal = a?.[sortConfig?.column];
        let bVal = b?.[sortConfig?.column];
        
        if (sortConfig?.column === 'name') {
          aVal = a?.fullName;
          bVal = b?.fullName;
        }
        
        if (typeof aVal === 'string') {
          aVal = aVal?.toLowerCase();
          bVal = bVal?.toLowerCase();
        }
        
        if (aVal < bVal) return sortConfig?.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig?.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    setFilteredCrew(filtered);
  };

  const handleSort = (column) => {
    setSortConfig(prev => {
      if (prev?.column === column) {
        if (prev?.direction === 'asc') return { column, direction: 'desc' };
        if (prev?.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const renderSortIcon = (column) => {
    if (sortConfig?.column !== column) {
      return (
        <div className="inline-flex flex-col ml-1 opacity-30">
          <Icon name="ChevronUp" size={12} className="-mb-1" />
          <Icon name="ChevronDown" size={12} />
        </div>
      );
    }
    if (sortConfig?.direction === 'asc') {
      return <Icon name="ChevronUp" size={14} className="inline ml-1 text-primary" />;
    } else if (sortConfig?.direction === 'desc') {
      return <Icon name="ChevronDown" size={14} className="inline ml-1 text-primary" />;
    }
    return null;
  };

  const handleViewCrew = (crew) => {
    setSelectedCrew(crew);
    setShowCrewDrawer(true);
  };

  const handleNudge = (crew) => {
    const currentUser = getCurrentUser();
    const result = sendManualNudge(crew?.id, crew?.fullName, currentUser?.id);
    
    if (result?.success) {
      showToast(result?.message, 'success');
    } else {
      showToast(result?.message || 'Failed to send nudge', 'error');
    }
  };

  const handleRequestCorrection = (crew) => {
    setCorrectionTarget(crew);
    setShowCorrectionModal(true);
  };

  const handleMonthChangeInternal = (direction) => {
    const newMonth = new Date(currentMonth?.getFullYear(), currentMonth?.getMonth() + direction, 1);
    const today = new Date();
    if (newMonth > today) return; // Prevent future months
    onMonthChange(newMonth);
  };

  const monthName = currentMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const departmentOptions = [
    { value: 'All', label: 'All Departments' },
    { value: Department?.BRIDGE, label: 'Bridge' },
    { value: Department?.INTERIOR, label: 'Interior' },
    { value: Department?.DECK, label: 'Deck' },
    { value: Department?.ENGINEERING, label: 'Engineering' },
    { value: Department?.GALLEY, label: 'Galley' },
    { value: Department?.SECURITY, label: 'Security' },
    { value: Department?.SPA, label: 'Spa' },
    { value: Department?.AVIATION, label: 'Aviation' }
  ];

  const statusOptions = [
    { value: 'All', label: 'All Status' },
    { value: 'Compliant', label: 'Compliant' },
    { value: 'Breach', label: 'Breach' },
    { value: 'Missing entries', label: 'Missing entries' },
    { value: 'Not confirmed', label: 'Not confirmed' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-2xl font-semibold text-foreground">Vessel HOR</h3>
        <p className="text-sm text-muted-foreground mt-1">Monthly compliance overview by crew member</p>
      </div>

      {/* Controls Row */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        {/* Month Selector */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleMonthChangeInternal(-1)}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ChevronLeft" size={18} className="text-foreground" />
            </button>
            <span className="text-sm font-medium text-foreground min-w-[140px] text-center">{monthName}</span>
            <button
              onClick={() => handleMonthChangeInternal(1)}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ChevronRight" size={18} className="text-foreground" />
            </button>
          </div>
          <Button onClick={() => setShowExportModal(true)}>
            <Icon name="Download" size={18} />
            Export Audit Pack
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            placeholder="Search by name, rank, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e?.target?.value)}
            icon="Search"
          />
          <Select
            value={departmentFilter}
            onChange={(value) => setDepartmentFilter(value)}
            options={departmentOptions}
          />
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={statusOptions}
          />
        </div>
      </div>

      {/* Crew Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                <th 
                  className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center">
                    Crew Member
                    {renderSortIcon('name')}
                  </div>
                </th>
                <th 
                  className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                  onClick={() => handleSort('department')}
                >
                  <div className="flex items-center">
                    Department
                    {renderSortIcon('department')}
                  </div>
                </th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Month Progress</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Month Status</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Rolling 24h</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Rolling 7d</th>
                <th className="text-left p-4 text-sm font-medium text-foreground">Last Updated</th>
                <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCrew?.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-muted-foreground">
                    No crew members found
                  </td>
                </tr>
              ) : (
                filteredCrew?.map(crew => (
                  <tr key={crew?.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                    <td className="p-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">{crew?.fullName}</div>
                        <div className="text-xs text-muted-foreground">{crew?.roleTitle}</div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-foreground">{crew?.department}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-foreground">{crew?.monthProgress}</span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                        crew?.monthStatus === 'Locked' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' :
                        crew?.monthStatus === 'Confirmed by Crew'? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {crew?.monthStatus}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                        crew?.rolling24hStatus === 'Compliant' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {crew?.rolling24hStatus}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${
                        crew?.rolling7dStatus === 'Compliant' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {crew?.rolling7dStatus}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground">{crew?.lastUpdated}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewCrew(crew)}
                          className="p-1.5 hover:bg-muted rounded-lg transition-smooth"
                          title="View"
                        >
                          <Icon name="Eye" size={16} className="text-foreground" />
                        </button>
                        <button
                          onClick={() => handleNudge(crew)}
                          className="p-1.5 hover:bg-muted rounded-lg transition-smooth"
                          title="Nudge"
                        >
                          <Icon name="Bell" size={16} className="text-foreground" />
                        </button>
                        <button
                          onClick={() => handleRequestCorrection(crew)}
                          className="p-1.5 hover:bg-muted rounded-lg transition-smooth"
                          title="Request correction"
                        >
                          <Icon name="AlertCircle" size={16} className="text-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Crew HOR Drawer */}
      {showCrewDrawer && selectedCrew && (
        <CrewHORDrawer
          isOpen={showCrewDrawer}
          onClose={() => {
            setShowCrewDrawer(false);
            setSelectedCrew(null);
          }}
          crew={selectedCrew}
          currentMonth={currentMonth}
          onMonthChange={onMonthChange}
          onNudge={handleNudge}
          onRequestCorrection={handleRequestCorrection}
        />
      )}

      {/* Export Audit Modal */}
      {showExportModal && (
        <ExportAuditModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          currentMonth={currentMonth}
          crewList={crewList}
        />
      )}

      {/* Request Correction Modal */}
      {showCorrectionModal && correctionTarget && (
        <RequestCorrectionModal
          isOpen={showCorrectionModal}
          onClose={() => {
            setShowCorrectionModal(false);
            setCorrectionTarget(null);
          }}
          crew={correctionTarget}
          currentMonth={currentMonth}
        />
      )}
    </div>
  );
};

export default VesselHORDashboard;