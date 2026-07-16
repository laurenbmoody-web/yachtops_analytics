import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

// The applied theme when the user follows their device.
const systemTheme = () =>
  (typeof window !== 'undefined' && window.matchMedia &&
   window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'night'
    : 'day';

export const ThemeProvider = ({ children }) => {
  // themePref is the user's CHOICE — 'day' | 'night' | 'system'. The applied
  // theme (data-theme) is 'day'/'night'; 'system' resolves to the device's.
  const [themePref, setThemePref] = useState(() => localStorage.getItem('yacht-ops-theme') || 'night');
  const [resolved, setResolved] = useState(() => (
    (localStorage.getItem('yacht-ops-theme') || 'night') === 'system'
      ? systemTheme()
      : (localStorage.getItem('yacht-ops-theme') || 'night')
  ));

  useEffect(() => {
    localStorage.setItem('yacht-ops-theme', themePref);
    setResolved(themePref === 'system' ? systemTheme() : themePref);
  }, [themePref]);

  useEffect(() => {
    document.documentElement?.setAttribute('data-theme', resolved);
  }, [resolved]);

  // When following the device, re-resolve live as the OS theme flips.
  useEffect(() => {
    if (themePref !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(systemTheme());
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [themePref]);

  // Header toggle: flip the applied theme and pin it explicitly (leaves 'system').
  const toggleTheme = () => setThemePref(resolved === 'night' ? 'day' : 'night');
  // Settings: choose 'day' | 'night' | 'system'.
  const setThemeMode = (mode) => setThemePref(mode);

  return (
    <ThemeContext.Provider value={{ theme: resolved, themePref, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
