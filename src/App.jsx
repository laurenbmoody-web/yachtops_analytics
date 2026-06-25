import React from "react";
import Routes from "./Routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { RoleProvider } from "./contexts/RoleContext";
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
  // HOR reminders now run server-side (pg_cron `hor-weekly-reminders` →
  // public.hor_send_weekly_reminders), so they fire reliably without a browser
  // open and reach the DB notifications feed cross-device. The old client-side
  // setInterval sweep was removed to avoid duplicate nudges.

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