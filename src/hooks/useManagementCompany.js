// Which management company the signed-in user acts for.
//
// A management user has no tenant_members row anywhere — that's the whole point
// of the design — so none of the vessel context applies to them. This is the
// equivalent lookup for the other side of the app: their firm, their tier in it,
// and how many vessels it is engaged on.
//
// Empty for crew, which is exactly how the app knows not to offer the management
// surface at all.
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { listMyManagementCompanies } from '../services/managementAccess';

// The guard, the shell and the page all ask this on the way to drawing one
// screen. Without a cache that's three identical round trips per navigation, and
// the answer cannot change inside a page load. Keyed by user so it can't survive
// into somebody else's session; cleared on sign-out by the reload that follows.
let cache = { key: null, promise: null };

export const clearManagementCompanyCache = () => { cache = { key: null, promise: null }; };

const fetchFor = (userId) => {
  if (cache.key !== userId) {
    cache = { key: userId, promise: listMyManagementCompanies() };
  }
  return cache.promise;
};

export default function useManagementCompany() {
  const { session, user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session || !user?.id) { setCompanies([]); setLoading(false); return undefined; }
    let live = true;
    (async () => {
      setLoading(true);
      const { data, error } = await fetchFor(user.id);
      if (!live) return;
      // A failed lookup must not be remembered as "works for nobody" — that
      // would lock them out of their own side of the app until a full reload.
      if (error) clearManagementCompanyCache();
      setCompanies(data || []);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [session, user?.id]);

  // Almost always exactly one. Somebody who works for two firms is rare enough
  // that the first is the right default rather than a chooser nobody needs.
  return { company: companies[0] || null, companies, loading, isManagement: companies.length > 0 };
}
