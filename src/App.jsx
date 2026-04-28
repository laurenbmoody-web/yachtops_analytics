import React, { useEffect } from "react";
import Routes from "./Routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { RoleProvider } from "./contexts/RoleContext";
import { initializeReminderScheduler } from "./utils/horReminderAutomation";
import { useTripsMigration } from "./hooks/useTripsMigration";
import './utils/toast';
import './lib/devGlobals';

// Mounted once inside AuthProvider so it can read auth state. The hook
// waits for bootstrapComplete + session + activeTenantId before firing,
// so this fragment is safe on every route — signed-out renders are no-ops.
function TripsMigrationRunner() {
  useTripsMigration();
  return null;
}

function App() {
  // Initialize HOR reminder scheduler on app load
  useEffect(() => {
    initializeReminderScheduler();
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <RoleProvider>
          <TripsMigrationRunner />
          <Routes />
        </RoleProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;