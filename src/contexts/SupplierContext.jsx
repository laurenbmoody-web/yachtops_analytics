import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const SupplierContext = createContext(null);

export const useSupplier = () => {
  const ctx = useContext(SupplierContext);
  if (!ctx) throw new Error('useSupplier must be used within SupplierProvider');
  return ctx;
};

export const SupplierProvider = ({ children }) => {
  const { session, user } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!session || !user) {
      setSupplier(null);
      setContact(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Primary: look up via supplier_contacts (always written by the
        // Netlify function even when updateUser() fails due to no session).
        const { data: contactData, error: contactErr } = await supabase
          .from('supplier_contacts')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (cancelled) return;

        // PGRST116 = no rows — fall through to metadata fallback below.
        if (contactErr && contactErr.code !== 'PGRST116') throw contactErr;

        // Resolve supplier_id: contacts row first, then user_metadata fallback.
        const supplierId =
          contactData?.supplier_id ?? user.user_metadata?.supplier_id ?? null;

        if (!supplierId) {
          throw new Error('Supplier account not found. Please contact support.');
        }

        const { data: profileData, error: profileErr } = await supabase
          .from('supplier_profiles')
          .select('*')
          .eq('id', supplierId)
          .single();

        if (cancelled) return;
        if (profileErr) throw profileErr;

        setContact(contactData ?? null);
        setSupplier(profileData);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [session, user]);

  const refreshSupplier = async () => {
    if (!supplier?.id) return;
    const { data, error: err } = await supabase
      .from('supplier_profiles')
      .select('*')
      .eq('id', supplier.id)
      .single();
    if (!err) setSupplier(data);
  };

  return (
    <SupplierContext.Provider value={{ supplier, contact, loading, error, refreshSupplier, setSupplier }}>
      {children}
    </SupplierContext.Provider>
  );
};
