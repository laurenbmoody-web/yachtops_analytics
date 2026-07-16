import React, { createContext, useContext, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

// ── Light-locked ────────────────────────────────────────────────────────────
// Cargo is a light-first editorial product. Dark mode is parked until the whole
// app is styled in light (so there's a locked light reference to build dark
// from). Until then the app renders 'day' everywhere — the toggle/setter are
// kept as no-ops so existing consumers of useTheme() don't break; they simply
// always get the light variant (navy logo, light map, etc.).
export const ThemeProvider = ({ children }) => {
  useEffect(() => {
    document.documentElement?.setAttribute('data-theme', 'day');
    try { localStorage.setItem('yacht-ops-theme', 'day'); } catch { /* noop */ }
  }, []);

  const value = {
    theme: 'day',
    themePref: 'day',
    toggleTheme: () => {},
    setThemeMode: () => {},
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
