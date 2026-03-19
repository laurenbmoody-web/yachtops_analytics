import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import { addManualSeaServiceEntry, loadSavedVessels, saveSavedVessel, loadCrewOnboardStatus, CREW_STATUS } from '../utils/seaTimeStorage';
import { showToast } from '../../../utils/toast';

const CAPACITY_OPTIONS = [
  'Deck Cadet',
  'OOW',
  'Mate',
  'AB',
  'Engineer',
  'EOOW',
  'Chief Engineer',
  'Other'
];

const SEA_SERVICE_TYPES = [
  'Underway',
  'In port',
  'Yard period',
  'Standby'
];

const AddManualEntryModal = ({ isOpen, onClose, userId, onSuccess }) => {
  const [step, setStep] = useState(1);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [useExistingVessel, setUseExistingVessel] = useState(false);
  const [selectedSavedVessel, setSelectedSavedVessel] = useState(null);
  const [saveVesselForFuture, setSaveVesselForFuture] = useState(false);
  const [documents, setDocuments] = useState([]);
  
  // Step 1: Service Period
  const [servicePeriod, setServicePeriod] = useState({
    startDate: '',
    endDate: '',
    capacityServed: '',
    watchkeepingRole: false,
    locationTradingArea: '',
    seaServiceType: 'Underway'
  });
  
  // Step 2: Vessel Details
  const [vesselDetails, setVesselDetails] = useState({
    vesselName: '',
    flag: '',
    imoNumber: '',
    officialNumber: '',
    vesselStatusType: 'Commercial Yacht',
    grossTonnage: '',
    propulsionPowerKW: '',
    propulsionPowerHP: '',
    vesselType: 'Motor Yacht',
    // Optional fields
    loa: '',
    breadth: '',
    depth: '',
    propulsionType: 'Diesel',
    engineMakeModel: '',
    numberOfEngines: '',
    callSign: '',
    mmsi: '',
    portOfRegistry: '',
    tradingArea: '',
    companyOperator: ''
  });
  
  // Step 3: Evidence & Notes
  const [evidenceNotes, setEvidenceNotes] = useState({
    noteReason: '',
    markedForVerification: false
  });

  const savedVessels = loadSavedVessels(userId);

  // Auto-populate capacity served if user is active on a vessel
  useEffect(() => {
    if (isOpen && userId) {
      const crewOnboardRecords = loadCrewOnboardStatus();
      const activeRecord = crewOnboardRecords?.find(
        r => r?.userId === userId && r?.status === CREW_STATUS?.ACTIVE
      );
      
      if (activeRecord && activeRecord?.capacityServed) {
        // User is active on a vessel, auto-populate their job title
        setServicePeriod(prev => ({
          ...prev,
          capacityServed: activeRecord?.capacityServed
        }));
      } else {
        // User is not active, leave blank
        setServicePeriod(prev => ({
          ...prev,
          capacityServed: ''
        }));
      }
    }
  }, [isOpen, userId]);

  if (!isOpen) return null;

  const handleHPtoKW = () => {
    const hp = parseFloat(vesselDetails?.propulsionPowerHP);
    if (hp && !isNaN(hp)) {
      const kw = Math.round(hp * 0.7457);
      setVesselDetails({ ...vesselDetails, propulsionPowerKW: kw?.toString() });
      showToast(`${hp} HP = ${kw} kW`, 'success');
    }
  };

  const handleSelectSavedVessel = (vesselId) => {
    const vessel = savedVessels?.find(v => v?.id === vesselId);
    if (vessel) {
      setSelectedSavedVessel(vessel);
      setVesselDetails({
        vesselName: vessel?.vesselName || '',
        flag: vessel?.flag || '',
        imoNumber: vessel?.imoNumber || '',
        officialNumber: vessel?.officialNumber || '',
        vesselStatusType: vessel?.vesselStatusType || 'Commercial Yacht',
        grossTonnage: vessel?.grossTonnage?.toString() || '',
        propulsionPowerKW: vessel?.propulsionPowerKW?.toString() || '',
        propulsionPowerHP: '',
        vesselType: vessel?.vesselType || 'Motor Yacht',
        loa: vessel?.loa?.toString() || '',
        breadth: vessel?.breadth?.toString() || '',
        depth: vessel?.depth?.toString() || '',
        propulsionType: vessel?.propulsionType || 'Diesel',
        engineMakeModel: vessel?.engineMakeModel || '',
        numberOfEngines: vessel?.numberOfEngines?.toString() || '',
        callSign: vessel?.callSign || '',
        mmsi: vessel?.mmsi || '',
        portOfRegistry: vessel?.portOfRegistry || '',
        tradingArea: vessel?.tradingArea || '',
        companyOperator: vessel?.companyOperator || ''
      });
    }
  };

  const validateStep1 = () => {
    if (!servicePeriod?.startDate || !servicePeriod?.endDate || !servicePeriod?.capacityServed) {
      showToast('Please fill in all required fields', 'error');
      return false;
    }
    if (new Date(servicePeriod?.endDate) < new Date(servicePeriod?.startDate)) {
      showToast('End date must be after start date', 'error');
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!vesselDetails?.vesselName || !vesselDetails?.flag) {
      showToast('Please fill in vessel name and flag', 'error');
      return false;
    }
    if (!vesselDetails?.imoNumber && !vesselDetails?.officialNumber) {
      showToast('Please provide either IMO Number or Official Number', 'error');
      return false;
    }
    if (!vesselDetails?.grossTonnage || isNaN(parseFloat(vesselDetails?.grossTonnage))) {
      showToast('Please provide valid Gross Tonnage', 'error');
      return false;
    }
    if (!vesselDetails?.propulsionPowerKW || isNaN(parseFloat(vesselDetails?.propulsionPowerKW))) {
      showToast('Please provide valid propulsion power (kW)', 'error');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    }
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = (e) => {
    e?.preventDefault();

    try {
      // Save vessel if requested
      let savedVesselId = selectedSavedVessel?.id || null;
      if (saveVesselForFuture && !selectedSavedVessel) {
        const saved = saveSavedVessel(userId, {
          vesselName: vesselDetails?.vesselName,
          flag: vesselDetails?.flag,
          imoNumber: vesselDetails?.imoNumber,
          officialNumber: vesselDetails?.officialNumber,
          vesselStatusType: vesselDetails?.vesselStatusType,
          grossTonnage: parseFloat(vesselDetails?.grossTonnage),
          propulsionPowerKW: parseFloat(vesselDetails?.propulsionPowerKW),
          vesselType: vesselDetails?.vesselType,
          loa: vesselDetails?.loa ? parseFloat(vesselDetails?.loa) : null,
          breadth: vesselDetails?.breadth ? parseFloat(vesselDetails?.breadth) : null,
          depth: vesselDetails?.depth ? parseFloat(vesselDetails?.depth) : null,
          propulsionType: vesselDetails?.propulsionType,
          engineMakeModel: vesselDetails?.engineMakeModel,
          numberOfEngines: vesselDetails?.numberOfEngines ? parseInt(vesselDetails?.numberOfEngines) : null,
          callSign: vesselDetails?.callSign,
          mmsi: vesselDetails?.mmsi,
          portOfRegistry: vesselDetails?.portOfRegistry,
          tradingArea: vesselDetails?.tradingArea,
          companyOperator: vesselDetails?.companyOperator
        });
        if (saved) {
          savedVesselId = saved?.id;
          showToast('Vessel saved for future entries', 'success');
        }
      }

      // Generate entries for date range
      const startDate = new Date(servicePeriod?.startDate);
      const endDate = new Date(servicePeriod?.endDate);
      let entriesCreated = 0;

      for (let d = new Date(startDate); d <= endDate; d?.setDate(d?.getDate() + 1)) {
        const dateStr = d?.toISOString()?.split('T')?.[0];
        
        addManualSeaServiceEntry(userId, {
          vesselName: vesselDetails?.vesselName,
          savedVesselId,
          date: dateStr,
          vesselStatus: null,
          capacityServed: servicePeriod?.capacityServed,
          watchkeepingRole: servicePeriod?.watchkeepingRole,
          locationTradingArea: servicePeriod?.locationTradingArea,
          seaServiceType: servicePeriod?.seaServiceType,
          noteReason: evidenceNotes?.noteReason,
          documents,
          markedForVerification: evidenceNotes?.markedForVerification
        });
        entriesCreated++;
      }

      showToast(`${entriesCreated} sea service ${entriesCreated === 1 ? 'entry' : 'entries'} added`, 'success');
      onSuccess?.();
      handleClose();
    } catch (error) {
      console.error('Error adding manual entries:', error);
      showToast('Failed to add manual entries', 'error');
    }
  };

  const handleClose = () => {
    setStep(1);
    setShowMoreDetails(false);
    setUseExistingVessel(false);
    setSelectedSavedVessel(null);
    setSaveVesselForFuture(false);
    setDocuments([]);
    setServicePeriod({
      startDate: '',
      endDate: '',
      capacityServed: '',
      watchkeepingRole: false,
      locationTradingArea: '',
      seaServiceType: 'Underway'
    });
    setVesselDetails({
      vesselName: '',
      flag: '',
      imoNumber: '',
      officialNumber: '',
      vesselStatusType: 'Commercial Yacht',
      grossTonnage: '',
      propulsionPowerKW: '',
      propulsionPowerHP: '',
      vesselType: 'Motor Yacht',
      loa: '',
      breadth: '',
      depth: '',
      propulsionType: 'Diesel',
      engineMakeModel: '',
      numberOfEngines: '',
      callSign: '',
      mmsi: '',
      portOfRegistry: '',
      tradingArea: '',
      companyOperator: ''
    });
    setEvidenceNotes({
      noteReason: '',
      markedForVerification: false
    });
    onClose();
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e?.target?.files || []);
    const newDocs = files?.map(f => ({
      id: `doc-${Date.now()}-${Math.random()}`,
      name: f?.name,
      size: f?.size,
      type: f?.type,
      uploadedAt: new Date()?.toISOString()
    }));
    setDocuments([...documents, ...newDocs]);
  };

  const removeDocument = (docId) => {
    setDocuments(documents?.filter(d => d?.id !== docId));
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal */}
        <div
          className="bg-background border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-background border-b border-border p-6 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              <Icon name="Plus" size={24} className="text-primary" />
              <div>
                <h2 className="text-xl font-semibold text-foreground">Add Sea Service Entry</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Step {step} of 3: {step === 1 ? 'Service Period' : step === 2 ? 'Vessel Details' : 'Evidence & Notes'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-accent rounded-lg transition-smooth"
            >
              <Icon name="X" size={20} className="text-muted-foreground" />
            </button>
          </div>

          {/* Progress Indicator */}
          <div className="flex items-center gap-2 px-6 pt-4">
            {[1, 2, 3]?.map((s) => (
              <div key={s} className="flex-1 flex items-center gap-2">
                <div className={`h-2 flex-1 rounded-full ${
                  s < step ? 'bg-primary' : s === step ? 'bg-primary/50' : 'bg-border'
                }`} />
              </div>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* STEP 1: SERVICE PERIOD */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Start Date <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={servicePeriod?.startDate}
                      onChange={(e) => setServicePeriod({ ...servicePeriod, startDate: e?.target?.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      End Date <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={servicePeriod?.endDate}
                      onChange={(e) => setServicePeriod({ ...servicePeriod, endDate: e?.target?.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Capacity Served <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={servicePeriod?.capacityServed}
                    onChange={(e) => setServicePeriod({ ...servicePeriod, capacityServed: e?.target?.value })}
                  >
                    <option value="">Select capacity...</option>
                    {CAPACITY_OPTIONS?.map(cap => (
                      <option key={cap} value={cap}>{cap}</option>
                    ))}
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={servicePeriod?.watchkeepingRole}
                    onChange={(e) => setServicePeriod({ ...servicePeriod, watchkeepingRole: e?.target?.checked })}
                  />
                  <label className="text-sm text-foreground">
                    Watchkeeping / Navigational role
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Location / Trading Area
                  </label>
                  <Input
                    value={servicePeriod?.locationTradingArea}
                    onChange={(e) => setServicePeriod({ ...servicePeriod, locationTradingArea: e?.target?.value })}
                    placeholder="e.g., Mediterranean, Caribbean"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Sea Service Type
                  </label>
                  <Select
                    value={servicePeriod?.seaServiceType}
                    onChange={(e) => setServicePeriod({ ...servicePeriod, seaServiceType: e?.target?.value })}
                  >
                    {SEA_SERVICE_TYPES?.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            {/* STEP 2: VESSEL DETAILS */}
            {step === 2 && (
              <div className="space-y-4">
                {/* Saved Vessel Selection */}
                {savedVessels?.length > 0 && (
                  <div className="bg-accent/50 border border-border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Checkbox
                        checked={useExistingVessel}
                        onChange={(e) => {
                          setUseExistingVessel(e?.target?.checked);
                          if (!e?.target?.checked) {
                            setSelectedSavedVessel(null);
                          }
                        }}
                      />
                      <label className="text-sm font-medium text-foreground">
                        Use a saved vessel
                      </label>
                    </div>
                    {useExistingVessel && (
                      <Select
                        value={selectedSavedVessel?.id || ''}
                        onChange={(e) => handleSelectSavedVessel(e?.target?.value)}
                      >
                        <option value="">Select saved vessel...</option>
                        {savedVessels?.map(v => (
                          <option key={v?.id} value={v?.id}>
                            {v?.vesselName} ({v?.flag})
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                )}

                {/* Required Fields */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Required Information</h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Vessel Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={vesselDetails?.vesselName}
                      onChange={(e) => setVesselDetails({ ...vesselDetails, vesselName: e?.target?.value })}
                      placeholder="Enter vessel name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Flag <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={vesselDetails?.flag}
                      onChange={(e) => setVesselDetails({ ...vesselDetails, flag: e?.target?.value })}
                      placeholder="e.g., Cayman Islands, Malta"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        IMO Number
                      </label>
                      <Input
                        value={vesselDetails?.imoNumber}
                        onChange={(e) => setVesselDetails({ ...vesselDetails, imoNumber: e?.target?.value })}
                        placeholder="IMO1234567"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Official Number
                      </label>
                      <Input
                        value={vesselDetails?.officialNumber}
                        onChange={(e) => setVesselDetails({ ...vesselDetails, officialNumber: e?.target?.value })}
                        placeholder="OFF789"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">At least one of IMO or Official Number required</p>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Vessel Status/Type <span className="text-red-500">*</span>
                    </label>
                    <Select
                      value={vesselDetails?.vesselStatusType}
                      onChange={(e) => setVesselDetails({ ...vesselDetails, vesselStatusType: e?.target?.value })}
                    >
                      <option value="Commercial Yacht">Commercial Yacht</option>
                      <option value="Private Yacht">Private Yacht</option>
                      <option value="Merchant">Merchant</option>
                      <option value="Other">Other</option>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Gross Tonnage (GT) <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        value={vesselDetails?.grossTonnage}
                        onChange={(e) => setVesselDetails({ ...vesselDetails, grossTonnage: e?.target?.value })}
                        placeholder="499"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        Propulsion Power (kW) <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        value={vesselDetails?.propulsionPowerKW}
                        onChange={(e) => setVesselDetails({ ...vesselDetails, propulsionPowerKW: e?.target?.value })}
                        placeholder="2400"
                      />
                    </div>
                  </div>

                  {/* HP Converter */}
                  <div className="bg-accent/50 border border-border rounded-lg p-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-2">
                      I only know HP (optional converter)
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={vesselDetails?.propulsionPowerHP}
                        onChange={(e) => setVesselDetails({ ...vesselDetails, propulsionPowerHP: e?.target?.value })}
                        placeholder="Enter HP"
                        className="flex-1"
                      />
                      <Button type="button" onClick={handleHPtoKW} variant="outline" size="sm">
                        Convert to kW
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Vessel Type <span className="text-red-500">*</span>
                    </label>
                    <Select
                      value={vesselDetails?.vesselType}
                      onChange={(e) => setVesselDetails({ ...vesselDetails, vesselType: e?.target?.value })}
                    >
                      <option value="Motor Yacht">Motor Yacht</option>
                      <option value="Sailing Yacht">Sailing Yacht</option>
                      <option value="Workboat / Support">Workboat / Support</option>
                      <option value="Other">Other</option>
                    </Select>
                  </div>
                </div>

                {/* Optional Fields (Collapsible) */}
                <div className="border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => setShowMoreDetails(!showMoreDetails)}
                    className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-smooth"
                  >
                    <Icon name={showMoreDetails ? 'ChevronUp' : 'ChevronDown'} size={16} />
                    {showMoreDetails ? 'Hide' : 'Show'} more details (optional)
                  </button>

                  {showMoreDetails && (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            LOA (m)
                          </label>
                          <Input
                            type="number"
                            step="0.01"
                            value={vesselDetails?.loa}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, loa: e?.target?.value })}
                            placeholder="45.5"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Breadth/Beam (m)
                          </label>
                          <Input
                            type="number"
                            step="0.01"
                            value={vesselDetails?.breadth}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, breadth: e?.target?.value })}
                            placeholder="8.5"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Depth (m)
                          </label>
                          <Input
                            type="number"
                            step="0.01"
                            value={vesselDetails?.depth}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, depth: e?.target?.value })}
                            placeholder="3.2"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Propulsion Type
                        </label>
                        <Select
                          value={vesselDetails?.propulsionType}
                          onChange={(e) => setVesselDetails({ ...vesselDetails, propulsionType: e?.target?.value })}
                        >
                          <option value="Diesel">Diesel</option>
                          <option value="Diesel-electric">Diesel-electric</option>
                          <option value="Hybrid">Hybrid</option>
                          <option value="Other">Other</option>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Engine Make/Model
                          </label>
                          <Input
                            value={vesselDetails?.engineMakeModel}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, engineMakeModel: e?.target?.value })}
                            placeholder="e.g., Caterpillar C32"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Number of Engines
                          </label>
                          <Input
                            type="number"
                            value={vesselDetails?.numberOfEngines}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, numberOfEngines: e?.target?.value })}
                            placeholder="2"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            Call Sign
                          </label>
                          <Input
                            value={vesselDetails?.callSign}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, callSign: e?.target?.value })}
                            placeholder="e.g., ZCXY1"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            MMSI
                          </label>
                          <Input
                            value={vesselDetails?.mmsi}
                            onChange={(e) => setVesselDetails({ ...vesselDetails, mmsi: e?.target?.value })}
                            placeholder="e.g., 319123456"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Port of Registry
                        </label>
                        <Input
                          value={vesselDetails?.portOfRegistry}
                          onChange={(e) => setVesselDetails({ ...vesselDetails, portOfRegistry: e?.target?.value })}
                          placeholder="e.g., George Town"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Trading Area
                        </label>
                        <Input
                          value={vesselDetails?.tradingArea}
                          onChange={(e) => setVesselDetails({ ...vesselDetails, tradingArea: e?.target?.value })}
                          placeholder="e.g., Worldwide"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          Company / Operator Name
                        </label>
                        <Input
                          value={vesselDetails?.companyOperator}
                          onChange={(e) => setVesselDetails({ ...vesselDetails, companyOperator: e?.target?.value })}
                          placeholder="e.g., ABC Yacht Management"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Save Vessel Checkbox */}
                {!selectedSavedVessel && (
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={saveVesselForFuture}
                        onChange={(e) => setSaveVesselForFuture(e?.target?.checked)}
                      />
                      <div>
                        <label className="text-sm font-medium text-foreground">
                          Save this vessel for future entries
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">
                          You'll be able to quickly select this vessel when adding future sea service entries
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: EVIDENCE & NOTES */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Upload Documents (optional)
                  </label>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-smooth">
                    <input
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                      id="document-upload"
                      accept=".pdf,.jpg,.jpeg,.png"
                    />
                    <label htmlFor="document-upload" className="cursor-pointer">
                      <Icon name="Upload" size={32} className="text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-foreground font-medium">Click to upload documents</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Sea service testimonial, discharge book, letters, etc.
                      </p>
                    </label>
                  </div>

                  {documents?.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {documents?.map(doc => (
                        <div key={doc?.id} className="flex items-center justify-between bg-accent/50 border border-border rounded-lg p-3">
                          <div className="flex items-center gap-2">
                            <Icon name="FileText" size={16} className="text-muted-foreground" />
                            <span className="text-sm text-foreground">{doc?.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeDocument(doc?.id)}
                            className="p-1 hover:bg-accent rounded transition-smooth"
                          >
                            <Icon name="X" size={16} className="text-muted-foreground" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Notes / Reason
                  </label>
                  <textarea
                    value={evidenceNotes?.noteReason}
                    onChange={(e) => setEvidenceNotes({ ...evidenceNotes, noteReason: e?.target?.value })}
                    placeholder="Add any notes or reason for this manual entry..."
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[120px]"
                  />
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={evidenceNotes?.markedForVerification}
                    onChange={(e) => setEvidenceNotes({ ...evidenceNotes, markedForVerification: e?.target?.checked })}
                  />
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Mark as submitted for verification
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      This will flag the entry for Command review
                    </p>
                  </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <Icon name="AlertCircle" size={16} className="text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      Manual entries are marked as unverified and will require external verification to count towards qualification.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4 border-t border-border">
              {step > 1 && (
                <Button type="button" onClick={handleBack} variant="outline">
                  <Icon name="ChevronLeft" size={16} />
                  Back
                </Button>
              )}
              <Button type="button" onClick={handleClose} variant="outline" className="ml-auto">
                Cancel
              </Button>
              {step < 3 ? (
                <Button type="button" onClick={handleNext}>
                  Next
                  <Icon name="ChevronRight" size={16} />
                </Button>
              ) : (
                <Button type="submit">
                  <Icon name="Check" size={16} />
                  Save Entry
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default AddManualEntryModal;