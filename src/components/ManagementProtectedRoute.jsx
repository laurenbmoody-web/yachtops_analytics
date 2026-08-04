// Gate for the shore office's side of Cargo.
//
// Mirrors SupplierProtectedRoute: a session, and then one question of its own.
// Deliberately NOT ProtectedRoute — that one requires a tenant and a crew role,
// and a management user has neither. They are not crew on any vessel; they are
// a firm the vessel engaged.
//
// This only decides whether the page renders. Every piece of data behind it is
// fetched through a database function that checks the engagement again for
// itself, so getting past this guard buys nothing on its own.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from './LogoSpinner';
import useManagementCompany from '../hooks/useManagementCompany';

export default function ManagementProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const { isManagement, loading: loadingCompany } = useManagementCompany();

  if (loading || (session && loadingCompany)) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F8FAFC',
      }}>
        <LogoSpinner size={48} />
      </div>
    );
  }

  if (!session) return <Navigate to="/login-authentication" replace />;
  // Signed in but works for no firm — a crew member who typed the URL. Send them
  // to their own side rather than showing an empty fleet.
  if (!isManagement) return <Navigate to="/dashboard" replace />;

  return children;
}
