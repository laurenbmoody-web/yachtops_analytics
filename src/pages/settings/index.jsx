import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Header from '../../components/navigation/Header';
import { getCurrentUser } from '../../utils/authStorage';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';

const SettingsPage = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const currentUser = getCurrentUser();
  const [activeSection, setActiveSection] = useState('membership');
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
  const [pageLoading, setPageLoading] = useState(true);

  // Load settings from localStorage on mount
  useEffect(() => {
    setPageLoading(true);
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
    setPageLoading(false);
  }, []);

  // Check if there are unsaved changes
  const hasUnsavedChanges = () => {
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    const manualModeChanged = manualTimezoneEnabled !== originalManualTimezoneEnabled;
    const offsetChanged = manualOffset !== originalManualOffset;
    return settingsChanged || manualModeChanged || offsetChanged;
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

  const sections = [
    { id: 'membership', label: 'Membership', icon: 'CreditCard' },
    { id: 'timezone', label: 'Timezone', icon: 'Clock' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'legal', label: 'Legal', icon: 'FileText' },
    { id: 'help', label: 'Help', icon: 'HelpCircle' },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case 'membership':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Membership</h2>
              <p className="text-sm text-muted-foreground">Manage your subscription and billing</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-medium text-foreground">Current Plan</h3>
                  <p className="text-sm text-muted-foreground mt-1">View and manage your membership</p>
                </div>
                <Button
                  onClick={() => navigate('/membership')}
                  variant="outline"
                >
                  Manage Plan
                </Button>
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-foreground">Onboarding tour</h3>
                  <p className="text-sm text-muted-foreground mt-1">Restore the setup guide on your dashboard</p>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await supabase
                        .from('profiles')
                        .update({ dashboard_tutorial_dismissed_at: null })
                        .eq('id', session?.user?.id);
                      localStorage.removeItem('cg_tutorial_pill_hidden');
                      navigate('/dashboard');
                    } catch (err) {
                      console.warn('[settings] restore tutorial failed', err);
                    }
                  }}
                >
                  Show again
                </Button>
              </div>
            </div>
          </div>
        );

      case 'timezone':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Time Zone</h2>
              <p className="text-sm text-muted-foreground">Set your preferred time zone for dates and times</p>
            </div>

            {/* Manual Timezone Toggle */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-foreground mb-1">Manual Time Zone</h3>
                  <p className="text-sm text-muted-foreground">
                    Enable to set a custom GMT offset instead of selecting a city-based time zone
                  </p>
                </div>
                <button
                  onClick={handleManualTimezoneToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    manualTimezoneEnabled ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      manualTimezoneEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {manualTimezoneEnabled && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    GMT Offset
                  </label>
                  <select
                    value={manualOffset}
                    onChange={handleManualOffsetChange}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="-12:00">GMT-12:00</option>
                    <option value="-11:00">GMT-11:00</option>
                    <option value="-10:00">GMT-10:00</option>
                    <option value="-09:00">GMT-09:00</option>
                    <option value="-08:00">GMT-08:00</option>
                    <option value="-07:00">GMT-07:00</option>
                    <option value="-06:00">GMT-06:00</option>
                    <option value="-05:00">GMT-05:00</option>
                    <option value="-04:00">GMT-04:00</option>
                    <option value="-03:00">GMT-03:00</option>
                    <option value="-02:00">GMT-02:00</option>
                    <option value="-01:00">GMT-01:00</option>
                    <option value="+00:00">GMT+00:00 (UTC)</option>
                    <option value="+01:00">GMT+01:00</option>
                    <option value="+02:00">GMT+02:00</option>
                    <option value="+03:00">GMT+03:00</option>
                    <option value="+04:00">GMT+04:00</option>
                    <option value="+05:00">GMT+05:00</option>
                    <option value="+05:30">GMT+05:30</option>
                    <option value="+05:45">GMT+05:45</option>
                    <option value="+06:00">GMT+06:00</option>
                    <option value="+06:30">GMT+06:30</option>
                    <option value="+07:00">GMT+07:00</option>
                    <option value="+08:00">GMT+08:00</option>
                    <option value="+09:00">GMT+09:00</option>
                    <option value="+09:30">GMT+09:30</option>
                    <option value="+10:00">GMT+10:00</option>
                    <option value="+10:30">GMT+10:30</option>
                    <option value="+11:00">GMT+11:00</option>
                    <option value="+12:00">GMT+12:00</option>
                    <option value="+13:00">GMT+13:00</option>
                  </select>
                  <p className="text-xs text-muted-foreground mt-2">
                    Current selection: Manual GMT{manualOffset}
                  </p>
                </div>
              )}
            </div>

            {/* City-based Timezone Selection */}
            {!manualTimezoneEnabled && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-base font-medium text-foreground mb-4">Select Time Zone</h3>
                
                {/* Search */}
                <div className="relative mb-4">
                  <Icon
                    name="Search"
                    size={18}
                    color="var(--color-muted-foreground)"
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                  />
                  <input
                    type="text"
                    placeholder="Search time zones..."
                    value={timezoneSearch}
                    onChange={(e) => setTimezoneSearch(e?.target?.value)}
                    className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Timezone List */}
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {filteredTimezones?.map((tz) => (
                    <button
                      key={tz?.value}
                      onClick={() => handleTimezoneChange(tz?.value)}
                      className={`w-full px-4 py-3 text-left rounded-lg transition-colors ${
                        settings?.timezone === tz?.value
                          ? 'bg-primary/10 border border-primary' :'hover:bg-muted border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{tz?.label}</span>
                        <span className="text-xs text-muted-foreground">{tz?.offset}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Notifications</h2>
              <p className="text-sm text-muted-foreground">Manage how you receive notifications</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-6 space-y-6">
              {/* Email Notifications */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-foreground mb-1">Email Notifications</h3>
                  <p className="text-sm text-muted-foreground">
                    Receive notifications via email
                  </p>
                </div>
                <button
                  onClick={() => handleNotificationToggle('emailNotifications')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings?.emailNotifications ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings?.emailNotifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="border-t border-border" />

              {/* Push Notifications */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-foreground mb-1">Push Notifications</h3>
                  <p className="text-sm text-muted-foreground">
                    Receive push notifications in your browser
                  </p>
                </div>
                <button
                  onClick={() => handleNotificationToggle('pushNotifications')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings?.pushNotifications ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings?.pushNotifications ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="border-t border-border" />

              {/* Task Reminders */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-foreground mb-1">Task Reminders</h3>
                  <p className="text-sm text-muted-foreground">
                    Get reminders for upcoming and overdue tasks
                  </p>
                </div>
                <button
                  onClick={() => handleNotificationToggle('taskReminders')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings?.taskReminders ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings?.taskReminders ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="border-t border-border" />

              {/* Trip Updates */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-base font-medium text-foreground mb-1">Trip Updates</h3>
                  <p className="text-sm text-muted-foreground">
                    Receive notifications about trip changes and updates
                  </p>
                </div>
                <button
                  onClick={() => handleNotificationToggle('tripUpdates')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings?.tripUpdates ? 'bg-primary' : 'bg-muted'
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
        );

      case 'legal':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Legal</h2>
              <p className="text-sm text-muted-foreground">Terms, privacy, and legal information</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-medium text-foreground mb-2">Terms of Service</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Read our terms and conditions for using Cargo
                </p>
                <Button variant="outline" size="sm">
                  View Terms
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-base font-medium text-foreground mb-2">Privacy Policy</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Learn how we collect, use, and protect your data
                </p>
                <Button variant="outline" size="sm">
                  View Privacy Policy
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-base font-medium text-foreground mb-2">Cookie Policy</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Understand how we use cookies and similar technologies
                </p>
                <Button variant="outline" size="sm">
                  View Cookie Policy
                </Button>
              </div>
            </div>
          </div>
        );

      case 'help':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">Help & Support</h2>
              <p className="text-sm text-muted-foreground">Get help and contact support</p>
            </div>

            <div className="bg-card border border-border rounded-lg p-6 space-y-4">
              <div>
                <h3 className="text-base font-medium text-foreground mb-2">Documentation</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Browse our comprehensive guides and tutorials
                </p>
                <Button variant="outline" size="sm">
                  View Docs
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-base font-medium text-foreground mb-2">Contact Support</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Get in touch with our support team
                </p>
                <Button variant="outline" size="sm">
                  Contact Us
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-base font-medium text-foreground mb-2">Report a Bug</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Help us improve by reporting issues
                </p>
                <Button variant="outline" size="sm">
                  Report Bug
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Info" size={16} />
                  <span>Version 1.0.0</span>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Show loading state while auth or page data is loading
  if (authLoading || pageLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="flex h-[calc(100vh-64px)]">
        {/* Left Sidebar */}
        <div className="w-64 bg-card border-r border-border flex-shrink-0">
          <div className="p-4">
            <h1 className="text-xl font-semibold text-foreground mb-6">Settings</h1>
            <nav className="space-y-1">
              {sections?.map((section) => (
                <button
                  key={section?.id}
                  onClick={() => setActiveSection(section?.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    activeSection === section?.id
                      ? 'bg-primary text-white' :'text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon name={section?.icon} size={18} />
                  <span className="text-sm font-medium">{section?.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-8">
            {renderContent()}
            
            {/* Save Button - Only show for timezone and notifications */}
            {(activeSection === 'timezone' || activeSection === 'notifications') && (
              <div className="mt-8 flex items-center gap-4">
                <Button
                  onClick={handleSave}
                  disabled={!hasUnsavedChanges()}
                >
                  Save Changes
                </Button>
                {hasUnsavedChanges() && (
                  <span className="text-sm text-muted-foreground">
                    You have unsaved changes
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;