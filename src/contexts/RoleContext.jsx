import React, { createContext, useContext, useState, useEffect } from 'react';

const RoleContext = createContext();

export const useRole = () => {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error('useRole must be used within RoleProvider');
  }
  return context;
};

export const RoleProvider = ({ children }) => {
  const [userRole, setUserRole] = useState(() => {
    const stored = localStorage.getItem('cargo-user-role');
    return stored || 'crew'; // Default to crew
  });

  const [userId, setUserId] = useState(() => {
    const stored = localStorage.getItem('cargo-user-id');
    return stored || 'user-1';
  });

  const [userName, setUserName] = useState(() => {
    const stored = localStorage.getItem('cargo-user-name');
    return stored || 'John Doe';
  });

  useEffect(() => {
    localStorage.setItem('cargo-user-role', userRole);
    localStorage.setItem('cargo-user-id', userId);
    localStorage.setItem('cargo-user-name', userName);
  }, [userRole, userId, userName]);

  const switchRole = (role) => {
    setUserRole(role);
  };

  // Normalize role to uppercase for consistent comparison
  const normalizedRole = userRole?.toUpperCase();
  const isChiefStew = normalizedRole === 'CHIEF';
  const isCrew = normalizedRole === 'CREW';

  return (
    <RoleContext.Provider value={{ 
      userRole, 
      userId, 
      userName, 
      switchRole, 
      isChiefStew, 
      isCrew,
      setUserId,
      setUserName
    }}>
      {children}
    </RoleContext.Provider>
  );
};

export default RoleContext;