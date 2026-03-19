import React, { useEffect } from "react";
import Routes from "./Routes";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import { RoleProvider } from "./contexts/RoleContext";
import { initializeReminderScheduler } from "./utils/horReminderAutomation";
import './utils/toast';

function App() {
  // Initialize HOR reminder scheduler on app load
  useEffect(() => {
    initializeReminderScheduler();
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <RoleProvider>
          <Routes />
        </RoleProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;