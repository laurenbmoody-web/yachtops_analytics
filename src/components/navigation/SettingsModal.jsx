import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';

const SettingsModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const canAccessVesselSettings = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const [activeTab, setActiveTab] = useState('timezone');
  const [settings, setSettings] = useState({
    timezone: localStorage.getItem('userTimezone') || 'UTC',
    emailNotifications: localStorage.getItem('emailNotifications') !== 'false',
    pushNotifications: localStorage.getItem('pushNotifications') !== 'false',
    taskReminders: localStorage.getItem('taskReminders') !== 'false',
    tripUpdates: localStorage.getItem('tripUpdates') !== 'false',
  });
  const [originalSettings, setOriginalSettings] = useState({});
  const [manualTimezoneEnabled, setManualTimezoneEnabled] = useState(false);
  const [originalManualTimezoneEnabled, setOriginalManualTimezoneEnabled] = useState(false);
  const [manualOffset, setManualOffset] = useState('+00:00');
  const [originalManualOffset, setOriginalManualOffset] = useState('+00:00');
  const [timezoneSearch, setTimezoneSearch] = useState('');
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Load settings from localStorage when modal opens
  useEffect(() => {
    if (isOpen) {
      const loadedSettings = {
        timezone: localStorage.getItem('userTimezone') || 'UTC',
        emailNotifications: localStorage.getItem('emailNotifications') !== 'false',
        pushNotifications: localStorage.getItem('pushNotifications') !== 'false',
        taskReminders: localStorage.getItem('taskReminders') !== 'false',
        tripUpdates: localStorage.getItem('tripUpdates') !== 'false',
      };
      
      // Check if manual timezone is enabled
      const isManual = loadedSettings?.timezone?.startsWith('Manual GMT');
      const offset = isManual ? loadedSettings?.timezone?.replace('Manual GMT', '') : '+00:00';
      
      setSettings(loadedSettings);
      setOriginalSettings(JSON.parse(JSON.stringify(loadedSettings)));
      setManualTimezoneEnabled(isManual);
      setOriginalManualTimezoneEnabled(isManual);
      setManualOffset(offset);
      setOriginalManualOffset(offset);
      
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    const manualModeChanged = manualTimezoneEnabled !== originalManualTimezoneEnabled;
    const offsetChanged = manualOffset !== originalManualOffset;
    return settingsChanged || manualModeChanged || offsetChanged;
  };

  const handleClose = () => {
    if (hasUnsavedChanges()) {
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  };

  const handleDiscardChanges = () => {
    setShowUnsavedDialog(false);
    onClose();
  };

  const handleSave = () => {
    // Save all settings to localStorage
    localStorage.setItem('userTimezone', settings?.timezone);
    localStorage.setItem('emailNotifications', settings?.emailNotifications?.toString());
    localStorage.setItem('pushNotifications', settings?.pushNotifications?.toString());
    localStorage.setItem('taskReminders', settings?.taskReminders?.toString());
    localStorage.setItem('tripUpdates', settings?.tripUpdates?.toString());
    
    // Update original settings to match current
    setOriginalSettings(JSON.parse(JSON.stringify(settings)));
    setOriginalManualTimezoneEnabled(manualTimezoneEnabled);
    setOriginalManualOffset(manualOffset);
    
    onClose();
  };

  const handleTimezoneChange = (timezone) => {
    setSettings({ ...settings, timezone });
  };

  const handleNotificationToggle = (key) => {
    const newValue = !settings?.[key];
    setSettings({ ...settings, [key]: newValue });
  };

  const handleManualTimezoneToggle = () => {
    const newValue = !manualTimezoneEnabled;
    setManualTimezoneEnabled(newValue);
    if (newValue) {
      // When enabling manual mode, set to current offset
      const offset = manualOffset;
      setSettings({ ...settings, timezone: `Manual GMT${offset}` });
    } else {
      // When disabling, revert to UTC
      setSettings({ ...settings, timezone: 'UTC' });
    }
  };

  const handleManualOffsetChange = (e) => {
    const value = e?.target?.value;
    setManualOffset(value);
    if (manualTimezoneEnabled) {
      setSettings({ ...settings, timezone: `Manual GMT${value}` });
    }
  };

  const handleNavigateToVesselSettings = () => {
    navigate('/settings/vessel');
    onClose();
  };

  if (!isOpen) return null;

  const timezones = [
    // UTC
    { value: 'UTC', label: 'UTC - Coordinated Universal Time', offset: '+00:00' },
    
    // Americas
    { value: 'America/New_York', label: 'New York (Eastern Time)', offset: '-05:00' },
    { value: 'America/Chicago', label: 'Chicago (Central Time)', offset: '-06:00' },
    { value: 'America/Denver', label: 'Denver (Mountain Time)', offset: '-07:00' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (Pacific Time)', offset: '-08:00' },
    { value: 'America/Anchorage', label: 'Anchorage (Alaska Time)', offset: '-09:00' },
    { value: 'Pacific/Honolulu', label: 'Honolulu (Hawaii Time)', offset: '-10:00' },
    { value: 'America/Toronto', label: 'Toronto (Eastern Time)', offset: '-05:00' },
    { value: 'America/Vancouver', label: 'Vancouver (Pacific Time)', offset: '-08:00' },
    { value: 'America/Mexico_City', label: 'Mexico City', offset: '-06:00' },
    { value: 'America/Sao_Paulo', label: 'São Paulo', offset: '-03:00' },
    { value: 'America/Buenos_Aires', label: 'Buenos Aires', offset: '-03:00' },
    { value: 'America/Santiago', label: 'Santiago', offset: '-03:00' },
    { value: 'America/Lima', label: 'Lima', offset: '-05:00' },
    { value: 'America/Bogota', label: 'Bogotá', offset: '-05:00' },
    { value: 'America/Caracas', label: 'Caracas', offset: '-04:00' },
    { value: 'America/Panama', label: 'Panama City', offset: '-05:00' },
    { value: 'America/Havana', label: 'Havana', offset: '-05:00' },
    
    // Europe
    { value: 'Europe/London', label: 'London (GMT/BST)', offset: '+00:00' },
    { value: 'Europe/Paris', label: 'Paris (CET)', offset: '+01:00' },
    { value: 'Europe/Berlin', label: 'Berlin (CET)', offset: '+01:00' },
    { value: 'Europe/Rome', label: 'Rome (CET)', offset: '+01:00' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)', offset: '+01:00' },
    { value: 'Europe/Amsterdam', label: 'Amsterdam (CET)', offset: '+01:00' },
    { value: 'Europe/Brussels', label: 'Brussels (CET)', offset: '+01:00' },
    { value: 'Europe/Vienna', label: 'Vienna (CET)', offset: '+01:00' },
    { value: 'Europe/Zurich', label: 'Zurich (CET)', offset: '+01:00' },
    { value: 'Europe/Stockholm', label: 'Stockholm (CET)', offset: '+01:00' },
    { value: 'Europe/Copenhagen', label: 'Copenhagen (CET)', offset: '+01:00' },
    { value: 'Europe/Oslo', label: 'Oslo (CET)', offset: '+01:00' },
    { value: 'Europe/Helsinki', label: 'Helsinki (EET)', offset: '+02:00' },
    { value: 'Europe/Athens', label: 'Athens (EET)', offset: '+02:00' },
    { value: 'Europe/Istanbul', label: 'Istanbul (TRT)', offset: '+03:00' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)', offset: '+03:00' },
    { value: 'Europe/Dublin', label: 'Dublin (GMT/IST)', offset: '+00:00' },
    { value: 'Europe/Lisbon', label: 'Lisbon (WET)', offset: '+00:00' },
    { value: 'Europe/Warsaw', label: 'Warsaw (CET)', offset: '+01:00' },
    { value: 'Europe/Prague', label: 'Prague (CET)', offset: '+01:00' },
    { value: 'Europe/Budapest', label: 'Budapest (CET)', offset: '+01:00' },
    
    // Middle East & Africa
    { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: '+04:00' },
    { value: 'Asia/Riyadh', label: 'Riyadh (AST)', offset: '+03:00' },
    { value: 'Asia/Kuwait', label: 'Kuwait', offset: '+03:00' },
    { value: 'Asia/Doha', label: 'Doha', offset: '+03:00' },
    { value: 'Asia/Bahrain', label: 'Bahrain', offset: '+03:00' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem (IST)', offset: '+02:00' },
    { value: 'Asia/Beirut', label: 'Beirut (EET)', offset: '+02:00' },
    { value: 'Africa/Cairo', label: 'Cairo (EET)', offset: '+02:00' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)', offset: '+02:00' },
    { value: 'Africa/Lagos', label: 'Lagos (WAT)', offset: '+01:00' },
    { value: 'Africa/Nairobi', label: 'Nairobi (EAT)', offset: '+03:00' },
    { value: 'Africa/Casablanca', label: 'Casablanca (WET)', offset: '+00:00' },
    { value: 'Africa/Algiers', label: 'Algiers (CET)', offset: '+01:00' },
    { value: 'Africa/Tunis', label: 'Tunis (CET)', offset: '+01:00' },
    
    // Asia
    { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: '+08:00' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: '+08:00' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: '+09:00' },
    { value: 'Asia/Seoul', label: 'Seoul (KST)', offset: '+09:00' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)', offset: '+08:00' },
    { value: 'Asia/Beijing', label: 'Beijing (CST)', offset: '+08:00' },
    { value: 'Asia/Bangkok', label: 'Bangkok (ICT)', offset: '+07:00' },
    { value: 'Asia/Jakarta', label: 'Jakarta (WIB)', offset: '+07:00' },
    { value: 'Asia/Manila', label: 'Manila (PHT)', offset: '+08:00' },
    { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT)', offset: '+08:00' },
    { value: 'Asia/Taipei', label: 'Taipei (CST)', offset: '+08:00' },
    { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City (ICT)', offset: '+07:00' },
    { value: 'Asia/Kolkata', label: 'Mumbai/Kolkata (IST)', offset: '+05:30' },
    { value: 'Asia/Karachi', label: 'Karachi (PKT)', offset: '+05:00' },
    { value: 'Asia/Dhaka', label: 'Dhaka (BST)', offset: '+06:00' },
    { value: 'Asia/Colombo', label: 'Colombo (IST)', offset: '+05:30' },
    { value: 'Asia/Kathmandu', label: 'Kathmandu (NPT)', offset: '+05:45' },
    { value: 'Asia/Yangon', label: 'Yangon (MMT)', offset: '+06:30' },
    { value: 'Asia/Almaty', label: 'Almaty', offset: '+06:00' },
    { value: 'Asia/Tashkent', label: 'Tashkent', offset: '+05:00' },
    
    // Pacific & Oceania
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)', offset: '+11:00' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEDT)', offset: '+11:00' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)', offset: '+10:00' },
    { value: 'Australia/Perth', label: 'Perth (AWST)', offset: '+08:00' },
    { value: 'Australia/Adelaide', label: 'Adelaide (ACDT)', offset: '+10:30' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZDT)', offset: '+13:00' },
    { value: 'Pacific/Fiji', label: 'Fiji', offset: '+12:00' },
    { value: 'Pacific/Guam', label: 'Guam', offset: '+10:00' },
    { value: 'Pacific/Tahiti', label: 'Tahiti', offset: '-10:00' },
    { value: 'Pacific/Tongatapu', label: 'Tonga', offset: '+13:00' },
  ];

  const filteredTimezones = timezones?.filter(tz => 
    tz?.label?.toLowerCase()?.includes(timezoneSearch?.toLowerCase()) ||
    tz?.value?.toLowerCase()?.includes(timezoneSearch?.toLowerCase()) ||
    tz?.offset?.includes(timezoneSearch)
  );

  const tabs = [
    { id: 'timezone', label: 'Time Zone', icon: 'Clock' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'vessel', label: 'Vessel', icon: 'Ship' },
    { id: 'legal', label: 'Legal', icon: 'FileText' },
    { id: 'help', label: 'Help', icon: 'HelpCircle' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Icon name="Settings" size={24} className="text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Settings</h2>
              <p className="text-sm text-muted-foreground">Manage your preferences and account settings</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6 gap-1">
          {tabs?.map((tab) => (
            <button
              key={tab?.id}
              onClick={() => setActiveTab(tab?.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-smooth border-b-2 ${
                activeTab === tab?.id
                  ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={tab?.icon} size={16} />
              {tab?.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Time Zone Tab */}
          {activeTab === 'timezone' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Time Zone Settings</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select your preferred time zone for displaying dates and times throughout the application.
                </p>
              </div>

              {/* Manual Override Toggle */}
              <div className="flex items-start justify-between p-4 bg-background border border-border rounded-lg">
                <div className="flex items-start gap-3 flex-1">
                  <Icon name="Edit3" size={20} className="text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Manual Time Zone Override</p>
                    <p className="text-xs text-muted-foreground">Enter a custom GMT offset instead of selecting from the list</p>
                  </div>
                </div>
                <button
                  onClick={handleManualTimezoneToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    manualTimezoneEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      manualTimezoneEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Manual Offset Input */}
              {manualTimezoneEnabled && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">GMT Offset</label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground font-medium">GMT</span>
                    <select
                      value={manualOffset}
                      onChange={handleManualOffsetChange}
                      className="flex-1 px-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="-12:00">-12:00</option>
                      <option value="-11:00">-11:00</option>
                      <option value="-10:00">-10:00</option>
                      <option value="-09:30">-09:30</option>
                      <option value="-09:00">-09:00</option>
                      <option value="-08:00">-08:00</option>
                      <option value="-07:00">-07:00</option>
                      <option value="-06:00">-06:00</option>
                      <option value="-05:00">-05:00</option>
                      <option value="-04:00">-04:00</option>
                      <option value="-03:30">-03:30</option>
                      <option value="-03:00">-03:00</option>
                      <option value="-02:00">-02:00</option>
                      <option value="-01:00">-01:00</option>
                      <option value="+00:00">+00:00</option>
                      <option value="+01:00">+01:00</option>
                      <option value="+02:00">+02:00</option>
                      <option value="+03:00">+03:00</option>
                      <option value="+03:30">+03:30</option>
                      <option value="+04:00">+04:00</option>
                      <option value="+04:30">+04:30</option>
                      <option value="+05:00">+05:00</option>
                      <option value="+05:30">+05:30</option>
                      <option value="+05:45">+05:45</option>
                      <option value="+06:00">+06:00</option>
                      <option value="+06:30">+06:30</option>
                      <option value="+07:00">+07:00</option>
                      <option value="+08:00">+08:00</option>
                      <option value="+08:45">+08:45</option>
                      <option value="+09:00">+09:00</option>
                      <option value="+09:30">+09:30</option>
                      <option value="+10:00">+10:00</option>
                      <option value="+10:30">+10:30</option>
                      <option value="+11:00">+11:00</option>
                      <option value="+12:00">+12:00</option>
                      <option value="+12:45">+12:45</option>
                      <option value="+13:00">+13:00</option>
                      <option value="+14:00">+14:00</option>
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Current selection: GMT{manualOffset}
                  </p>
                </div>
              )}

              {/* Standard Time Zone Selection */}
              {!manualTimezoneEnabled && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Select Time Zone</label>
                  
                  {/* Search Input */}
                  <div className="relative">
                    <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search time zones..."
                      value={timezoneSearch}
                      onChange={(e) => setTimezoneSearch(e?.target?.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* Time Zone Dropdown */}
                  <div className="max-h-64 overflow-y-auto border border-border rounded-lg bg-background">
                    {filteredTimezones?.length > 0 ? (
                      filteredTimezones?.map((tz) => (
                        <button
                          key={tz?.value}
                          onClick={() => handleTimezoneChange(tz?.value)}
                          className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted transition-smooth border-b border-border last:border-b-0 ${
                            settings?.timezone === tz?.value ? 'bg-primary/10' : ''
                          }`}
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{tz?.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">GMT{tz?.offset}</p>
                          </div>
                          {settings?.timezone === tz?.value && (
                            <Icon name="Check" size={18} className="text-primary" />
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-8 text-center">
                        <Icon name="Search" size={24} className="text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No time zones found</p>
                      </div>
                    )}
                  </div>
                  
                  <p className="text-xs text-muted-foreground">
                    {filteredTimezones?.length} time zone{filteredTimezones?.length !== 1 ? 's' : ''} available
                  </p>
                </div>
              )}

              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <div className="flex items-start gap-3">
                  <Icon name="Info" size={18} className="text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Current Time</p>
                    <p className="text-sm text-muted-foreground">
                      {manualTimezoneEnabled 
                        ? `Manual GMT${manualOffset} - ${new Date()?.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}`
                        : new Date()?.toLocaleString('en-US', { timeZone: settings?.timezone, dateStyle: 'full', timeStyle: 'long' })
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Notification Preferences</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Choose how you want to receive notifications and updates.
                </p>
              </div>

              <div className="space-y-4">
                {/* Email Notifications */}
                <div className="flex items-start justify-between p-4 bg-background border border-border rounded-lg">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon name="Mail" size={20} className="text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">Email Notifications</p>
                      <p className="text-xs text-muted-foreground">Receive important updates via email</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleNotificationToggle('emailNotifications')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings?.emailNotifications ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings?.emailNotifications ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Push Notifications */}
                <div className="flex items-start justify-between p-4 bg-background border border-border rounded-lg">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon name="Bell" size={20} className="text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">Push Notifications</p>
                      <p className="text-xs text-muted-foreground">Get real-time alerts in your browser</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleNotificationToggle('pushNotifications')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings?.pushNotifications ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings?.pushNotifications ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Task Reminders */}
                <div className="flex items-start justify-between p-4 bg-background border border-border rounded-lg">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon name="CheckSquare" size={20} className="text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">Task Reminders</p>
                      <p className="text-xs text-muted-foreground">Reminders for upcoming and overdue tasks</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleNotificationToggle('taskReminders')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings?.taskReminders ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings?.taskReminders ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Trip Updates */}
                <div className="flex items-start justify-between p-4 bg-background border border-border rounded-lg">
                  <div className="flex items-start gap-3 flex-1">
                    <Icon name="Ship" size={20} className="text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">Trip Updates</p>
                      <p className="text-xs text-muted-foreground">Notifications about trip changes and updates</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleNotificationToggle('tripUpdates')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings?.tripUpdates ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        settings?.tripUpdates ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Legal Tab */}
          {activeTab === 'vessel' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Vessel Settings</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Manage your vessel configuration and details.
                </p>
              </div>

              <div className="space-y-3">
                {canAccessVesselSettings ? (
                  <button
                    onClick={handleNavigateToVesselSettings}
                    className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group w-full text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Icon name="Ship" size={20} className="text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Vessel Configuration</p>
                        <p className="text-xs text-muted-foreground">Manage vessel name, type, and status</p>
                      </div>
                    </div>
                    <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                  </button>
                ) : (
                  <div className="p-4 bg-muted/50 border border-border rounded-lg">
                    <div className="flex items-start gap-3">
                      <Icon name="Lock" size={20} className="text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">Access Restricted</p>
                        <p className="text-xs text-muted-foreground">
                          Vessel settings are only accessible to Command and Chief roles.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legal Tab */}
          {activeTab === 'legal' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Legal Information</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Review our terms, policies, and compliance information.
                </p>
              </div>

              <div className="space-y-3">
                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="FileText" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Terms of Service</p>
                      <p className="text-xs text-muted-foreground">Last updated: January 2026</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Shield" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Privacy Policy</p>
                      <p className="text-xs text-muted-foreground">Last updated: January 2026</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Lock" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Data Security</p>
                      <p className="text-xs text-muted-foreground">How we protect your information</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Scale" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Compliance</p>
                      <p className="text-xs text-muted-foreground">Regulatory and industry standards</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>
              </div>

              <div className="p-4 bg-muted/50 rounded-lg border border-border">
                <p className="text-xs text-muted-foreground">
                  © 2026 Cargo. All rights reserved. Version 1.0.0
                </p>
              </div>
            </div>
          )}

          {/* Help Tab */}
          {activeTab === 'help' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Help & Support</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Get assistance and learn how to use the platform effectively.
                </p>
              </div>

              <div className="space-y-3">
                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="BookOpen" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">User Guide</p>
                      <p className="text-xs text-muted-foreground">Complete documentation and tutorials</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="MessageCircle" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Contact Support</p>
                      <p className="text-xs text-muted-foreground">Get help from our support team</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Video" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Video Tutorials</p>
                      <p className="text-xs text-muted-foreground">Watch step-by-step guides</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="HelpCircle" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">FAQ</p>
                      <p className="text-xs text-muted-foreground">Frequently asked questions</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>

                <a
                  href="#"
                  className="flex items-center justify-between p-4 bg-background border border-border rounded-lg hover:bg-muted transition-smooth group"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="Zap" size={20} className="text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">What's New</p>
                      <p className="text-xs text-muted-foreground">Latest features and updates</p>
                    </div>
                  </div>
                  <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-foreground" />
                </a>
              </div>

              <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                <div className="flex items-start gap-3">
                  <Icon name="Mail" size={20} className="text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Need immediate assistance?</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      Contact our support team at support@cargo.com
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Available 24/7 for urgent issues
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Save/Cancel */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          {hasUnsavedChanges() && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <Icon name="AlertCircle" size={16} />
              <span>You have unsaved changes</span>
            </div>
          )}
          {!hasUnsavedChanges() && <div />}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleClose}
              variant="outline"
              className="px-4 py-2"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="px-4 py-2"
              disabled={!hasUnsavedChanges()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      {showUnsavedDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUnsavedDialog(false)}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md m-4 p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className="p-3 bg-amber-500/10 rounded-lg">
                <Icon name="AlertTriangle" size={24} className="text-amber-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-2">Unsaved Changes</h3>
                <p className="text-sm text-muted-foreground">
                  You have unsaved changes. Are you sure you want to close without saving?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                onClick={() => setShowUnsavedDialog(false)}
                variant="outline"
                className="px-4 py-2"
              >
                Continue Editing
              </Button>
              <Button
                onClick={handleDiscardChanges}
                className="px-4 py-2 bg-red-600 hover:bg-red-700"
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsModal;