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

    const supplierId = user.user_metadata?.supplier_id;
    if (!supplierId) {
      setError('No supplier_id in user metadata');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, contactRes] = await Promise.all([
          supabase.from('supplier_profiles').select('*').eq('id', supplierId).single(),
          supabase.from('supplier_contacts').select('*').eq('user_id', user.id).single(),
        ]);

        if (cancelled) return;

        if (profileRes.error) throw profileRes.error;
        if (contactRes.error && contactRes.error.code !== 'PGRST116') throw contactRes.error;

        setSupplier(profileRes.data);
        setContact(contactRes.data ?? null);
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
    const supplierId = user?.user_metadata?.supplier_id;
    if (!supplierId) return;
    const { data, error: err } = await supabase
      .from('supplier_profiles')
      .select('*')
      .eq('id', supplierId)
      .single();
    if (!err) setSupplier(data);
  };

  return (
    <SupplierContext.Provider value={{ supplier, contact, loading, error, refreshSupplier, setSupplier }}>
      {children}
    </SupplierContext.Provider>
  );
};
