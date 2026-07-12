import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import './settings.css';

// Editorial switch + hairline row — the two building blocks reused across the
// settings sections (see settings.css).
const Switch = ({ on, onClick, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label}
    className={`set-switch${on ? ' is-on' : ''}`} onClick={onClick}>
    <span className="set-knob" />
  </button>
);

const Row = ({ label, desc, children }) => (
  <div className="set-row">
    <div className="set-row-main">
      <div className="set-row-label">{label}</div>
      {desc && <div className="set-row-desc">{desc}</div>}
    </div>
    {children && <div className="set-row-aside">{children}</div>}
  </div>
);

const GMT_OFFSETS = [
  '-12:00', '-11:00', '-10:00', '-09:00', '-08:00', '-07:00', '-06:00', '-05:00',
  '-04:00', '-03:00', '-02:00', '-01:00', '+00:00', '+01:00', '+02:00', '+03:00',
  '+04:00', '+05:00', '+05:30', '+05:45', '+06:00', '+06:30', '+07:00', '+08:00',
  '+09:00', '+09:30', '+10:00', '+10:30', '+11:00', '+12:00', '+13:00',
];

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
    localStorage.setItem('userTimezone', settings?.timezone);
    localStorage.setItem('emailNotifications', settings?.emailNotifications?.toString());
    localStorage.setItem('pushNotifications', settings?.pushNotifications?.toString());
    localStorage.setItem('taskReminders', settings?.taskReminders?.toString());
    localStorage.setItem('tripUpdates', settings?.tripUpdates?.toString());

    setOriginalSettings(JSON.parse(JSON.stringify(settings)));
    setOriginalManualTimezoneEnabled(manualTimezoneEnabled);
    setOriginalManualOffset(manualOffset);
  };

  const handleTimezoneChange = (timezone) => setSettings({ ...settings, timezone });
  const handleNotificationToggle = (key) => setSettings({ ...settings, [key]: !settings?.[key] });

  const handleManualTimezoneToggle = () => {
    const newValue = !manualTimezoneEnabled;
    setManualTimezoneEnabled(newValue);
    if (newValue) setSettings({ ...settings, timezone: `Manual GMT${manualOffset}` });
    else setSettings({ ...settings, timezone: 'UTC' });
  };

  const handleManualOffsetChange = (e) => {
    const value = e?.target?.value;
    setManualOffset(value);
    if (manualTimezoneEnabled) setSettings({ ...settings, timezone: `Manual GMT${value}` });
  };

  const handleRestoreTour = async () => {
    try {
      await supabase.from('profiles').update({ dashboard_tutorial_dismissed_at: null }).eq('id', session?.user?.id);
      localStorage.removeItem('cg_tutorial_pill_hidden');
      navigate('/dashboard');
    } catch (err) {
      console.warn('[settings] restore tutorial failed', err);
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

  // Personal ("You") sections — available to everyone; rendered in-page.
  const sections = [
    { id: 'membership', label: 'Membership', icon: 'CreditCard' },
    { id: 'timezone', label: 'Timezone', icon: 'Clock' },
    { id: 'notifications', label: 'Notifications', icon: 'Bell' },
    { id: 'legal', label: 'Legal', icon: 'FileText' },
    { id: 'help', label: 'Help', icon: 'HelpCircle' },
  ];

  // Vessel (admin) sections — COMMAND/CHIEF only; they deep-link into the
  // vessel-settings admin page so this stays the single settings home while
  // keeping the admin surface (and its VesselAdminRoute guard) intact.
  const canAccessVessel = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const vesselSections = [
    { id: 'vessel-profile', label: 'Vessel Profile', icon: 'Ship' },
    { id: 'location-management', label: 'Locations', icon: 'MapPin' },
    { id: 'role-management', label: 'Roles', icon: 'Users' },
    { id: 'provisioning-approval', label: 'Provisioning Approval', icon: 'CheckCircle' },
  ];

  const renderContent = () => {
    switch (activeSection) {
      case 'membership':
        return (
          <>
            <div className="set-head">
              <h2 className="set-h2">Membership</h2>
              <p className="set-sub">Manage your subscription and billing.</p>
            </div>
            <div className="set-block">
              <Row label="Current plan" desc="View and manage your membership.">
                <button className="set-btn set-btn-ghost" onClick={() => navigate('/membership')}>Manage plan</button>
              </Row>
              <Row label="Onboarding tour" desc="Restore the setup guide on your dashboard.">
                <button className="set-btn set-btn-ghost" onClick={handleRestoreTour}>Show again</button>
              </Row>
            </div>
          </>
        );

      case 'timezone':
        return (
          <>
            <div className="set-head">
              <h2 className="set-h2">Time zone</h2>
              <p className="set-sub">Set your preferred time zone for dates and times.</p>
            </div>
            <div className="set-block">
              <Row label="Manual time zone" desc="Set a custom GMT offset instead of a city-based zone.">
                <Switch on={manualTimezoneEnabled} onClick={handleManualTimezoneToggle} label="Manual time zone" />
              </Row>

              {manualTimezoneEnabled ? (
                <div style={{ paddingTop: 18 }}>
                  <label className="set-fieldlabel">GMT offset</label>
                  <select className="set-field" value={manualOffset} onChange={handleManualOffsetChange}>
                    {GMT_OFFSETS.map(o => (
                      <option key={o} value={o}>{`GMT${o}${o === '+00:00' ? ' (UTC)' : ''}`}</option>
                    ))}
                  </select>
                  <p className="set-fieldnote">Current selection: Manual GMT{manualOffset}</p>
                </div>
              ) : (
                <div>
                  <div className="set-search">
                    <span className="set-searchic"><Icon name="Search" size={16} color="#AEB4C2" /></span>
                    <input
                      type="text"
                      className="set-field"
                      placeholder="Search time zones…"
                      value={timezoneSearch}
                      onChange={(e) => setTimezoneSearch(e?.target?.value)}
                    />
                  </div>
                  <div className="set-tzlist">
                    {filteredTimezones?.map((tz) => (
                      <button
                        key={tz?.value}
                        onClick={() => handleTimezoneChange(tz?.value)}
                        className={`set-tzitem${settings?.timezone === tz?.value ? ' is-sel' : ''}`}
                      >
                        <span className="set-tzname">{tz?.label}</span>
                        <span className="set-tzoff">{tz?.offset}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        );

      case 'notifications':
        return (
          <>
            <div className="set-head">
              <h2 className="set-h2">Notifications</h2>
              <p className="set-sub">Manage how you receive notifications.</p>
            </div>
            <div className="set-block">
              <Row label="Email notifications" desc="Receive notifications via email.">
                <Switch on={settings?.emailNotifications} onClick={() => handleNotificationToggle('emailNotifications')} label="Email notifications" />
              </Row>
              <Row label="Push notifications" desc="Receive push notifications in your browser.">
                <Switch on={settings?.pushNotifications} onClick={() => handleNotificationToggle('pushNotifications')} label="Push notifications" />
              </Row>
              <Row label="Task reminders" desc="Get reminders for upcoming and overdue tasks.">
                <Switch on={settings?.taskReminders} onClick={() => handleNotificationToggle('taskReminders')} label="Task reminders" />
              </Row>
              <Row label="Trip updates" desc="Receive notifications about trip changes and updates.">
                <Switch on={settings?.tripUpdates} onClick={() => handleNotificationToggle('tripUpdates')} label="Trip updates" />
              </Row>
            </div>
          </>
        );

      case 'legal':
        return (
          <>
            <div className="set-head">
              <h2 className="set-h2">Legal</h2>
              <p className="set-sub">Terms, privacy, and legal information.</p>
            </div>
            <div className="set-block">
              <Row label="Terms of Service" desc="Read our terms and conditions for using Cargo.">
                <button className="set-btn set-btn-ghost">View</button>
              </Row>
              <Row label="Privacy Policy" desc="Learn how we collect, use, and protect your data.">
                <button className="set-btn set-btn-ghost">View</button>
              </Row>
              <Row label="Cookie Policy" desc="Understand how we use cookies and similar technologies.">
                <button className="set-btn set-btn-ghost">View</button>
              </Row>
            </div>
          </>
        );

      case 'help':
        return (
          <>
            <div className="set-head">
              <h2 className="set-h2">Help &amp; support</h2>
              <p className="set-sub">Get help and contact support.</p>
            </div>
            <div className="set-block">
              <Row label="Documentation" desc="Browse our comprehensive guides and tutorials.">
                <button className="set-btn set-btn-ghost">View docs</button>
              </Row>
              <Row label="Contact support" desc="Get in touch with our support team.">
                <button className="set-btn set-btn-ghost">Contact us</button>
              </Row>
              <Row label="Report a bug" desc="Help us improve by reporting issues.">
                <button className="set-btn set-btn-ghost">Report bug</button>
              </Row>
            </div>
            <div className="set-fieldnote" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 20 }}>
              <Icon name="Info" size={14} color="#AEB4C2" />
              <span>Version 1.0.0</span>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  if (authLoading || pageLoading) {
    return (
      <>
        <Header />
        <div className="set-loading"><div className="set-spinner" /></div>
      </>
    );
  }

  const showSaveBar = activeSection === 'timezone' || activeSection === 'notifications';

  return (
    <>
      <Header />
      <div className="set-root">
        {/* Sidebar */}
        <aside className="set-side">
          <div className="set-side-title">Settings</div>

          <div className="set-grouplabel">You</div>
          <nav className="set-nav">
            {sections?.map((section) => {
              const active = activeSection === section?.id;
              return (
                <button
                  key={section?.id}
                  onClick={() => setActiveSection(section?.id)}
                  className={`set-navitem${active ? ' is-active' : ''}`}
                >
                  <Icon name={section?.icon} size={17} color={active ? '#C65A1A' : '#8B8478'} />
                  <span>{section?.label}</span>
                </button>
              );
            })}
          </nav>

          {canAccessVessel && (
            <>
              <div className="set-grouplabel">Vessel</div>
              <nav className="set-nav">
                {vesselSections?.map((section) => (
                  <button
                    key={section?.id}
                    onClick={() => navigate(`/settings/vessel?section=${section?.id}`)}
                    className="set-navitem"
                  >
                    <Icon name={section?.icon} size={17} color="#8B8478" />
                    <span>{section?.label}</span>
                    <Icon name="ArrowUpRight" size={14} color="#C3BEB2" className="set-ext" />
                  </button>
                ))}
              </nav>
            </>
          )}
        </aside>

        {/* Content */}
        <main className="set-main">
          <div className="set-content">{renderContent()}</div>
          {showSaveBar && (
            <div className="set-savebar">
              <div className="set-savebar-inner">
                <button className="set-btn set-btn-primary" onClick={handleSave} disabled={!hasUnsavedChanges()}>
                  Save changes
                </button>
                {hasUnsavedChanges() && <span className="set-savenote">You have unsaved changes</span>}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
};

export default SettingsPage;
