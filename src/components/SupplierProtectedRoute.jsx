import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SupplierProtectedRoute = ({ children }) => {
  const { session, loading, user } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8FAFC',
      }}>
        <div
          className="animate-spin rounded-full h-12 w-12 border-b-2"
          style={{ borderColor: '#1E3A5F' }}
        />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/supplier/login" replace />;
  }

  const userType = user?.user_metadata?.user_type;
  if (userType !== 'supplier') {
    return <Navigate to="/login-authentication" replace />;
  }

  return children;
};

export default SupplierProtectedRoute;
