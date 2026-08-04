// "You're logged in but not linked to a vessel yet."
//
// Four route guards each drew their own copy of this, which is why fixing it in
// one place fixed nothing — a management login still met it on whichever guard
// it happened to hit first. One component now, so the next change lands
// everywhere at once.
//
// Having no vessel means two different things:
//   crew between boats     this screen is right for them
//   the shore office       they have no vessel BY DESIGN — they're a firm a
//                          vessel engaged, not crew — and telling them they
//                          aren't "linked to a vessel yet" is the app failing to
//                          recognise its own user
//
// So it asks before it draws. The check only runs once we already know there's
// no membership, which is rare, and it renders nothing until the answer comes
// back rather than flashing the wrong screen first.
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function NoVesselAccess() {
  const [shore, setShore] = useState(null);   // null = still asking

  useEffect(() => {
    let live = true;
    supabase?.rpc?.('my_management_companies')
      ?.then?.(({ data }) => { if (live) setShore((data || []).length > 0); })
      ?.catch?.(() => { if (live) setShore(false); });
    return () => { live = false; };
  }, []);

  if (shore === null) return null;
  if (shore) return <Navigate to="/management" replace />;

  const signOut = async () => {
    try { localStorage.clear(); await supabase?.auth?.signOut(); } catch (e) { /* ignore */ }
    window.location.href = '/login-authentication';
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
      <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-foreground mb-2">No active vessel access</h2>
        <p className="text-muted-foreground mb-6">
          You&apos;re logged in but not linked to a vessel yet.
        </p>
        <div className="flex items-center justify-center gap-3">
          <a href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            Back to Dashboard
          </a>
          <button type="button" onClick={signOut}
            className="inline-block px-6 py-2 border border-border rounded-lg hover:bg-muted transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
