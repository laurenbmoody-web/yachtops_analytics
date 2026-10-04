import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tailwind.css';
import './styles/index.css';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { initA11y } from './utils/a11y';
import { initNative } from './lib/native/init';

// Apply saved accessibility prefs (reduced motion, text size) before render.
initA11y();
// iOS / Android app shell: downloads → share sheet, new windows → viewer, etc.
initNative();

const root = ReactDOM?.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);