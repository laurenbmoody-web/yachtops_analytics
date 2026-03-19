import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const AcceptAdminBanner = ({ onAccept, onRefresh }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingTransfer, setPendingTransfer] = useState(null);
  const [vesselName, setVesselName] = useState('');

  useEffect(() => {
    checkPendingTransfer();
  }, [user]);

  const checkPendingTransfer = async (retries = 2) => {
    try {
      if (!user?.id) return;

      // Check if current user has a pending transfer request
      const { data: profile, error: profileError } = await supabase?.from('profiles')?.select('last_active_tenant_id')?.eq('id', user?.id)?.single();

      if (profileError) {
        if (profileError?.name === 'AbortError' || profileError?.message?.includes('aborted')) {
          console.warn('[TRANSFER] Query aborted (timeout or cancellation)');
          if (retries > 0) {
            console.warn(`[TRANSFER] Retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return checkPendingTransfer(retries - 1);
          }
          console.warn('[TRANSFER] AbortError after all retries. Treating as no pending transfer.');
          setPendingTransfer(null);
          return;
        }
        throw profileError;
      }

      const tenantId = profile?.last_active_tenant_id;
      if (!tenantId) return;

      // Fetch pending transfer where current user is the recipient
      const { data: transfer, error: transferError } = await supabase?.from('admin_transfer_requests')?.select(`
          id,
          tenant_id,
          from_user_id,
          to_user_id,
          status,
          created_at,
          from_profile:from_user_id (full_name),
          tenants:tenant_id (name)
        `)?.eq('tenant_id', tenantId)?.eq('to_user_id', user?.id)?.eq('status', 'PENDING')?.maybeSingle();

      if (transferError) {
        if (transferError?.name === 'AbortError' || transferError?.message?.includes('aborted')) {
          console.warn('[TRANSFER] Transfer query aborted (timeout or cancellation)');
          if (retries > 0) {
            console.warn(`[TRANSFER] Retrying transfer query... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return checkPendingTransfer(retries - 1);
          }
          console.warn('[TRANSFER] AbortError after all retries. Treating as no pending transfer.');
          setPendingTransfer(null);
          return;
        }

        if (transferError?.code === 'PGRST116' || transferError?.status === 406 || transferError?.message?.includes('0 rows')) {
          setPendingTransfer(null);
          return;
        }
        throw transferError;
      }

      if (transfer) {
        setPendingTransfer(transfer);
        setVesselName(transfer?.tenants?.name || 'this vessel');
      } else {
        setPendingTransfer(null);
      }
    } catch (err) {
      const errMsg = err?.message || '';

      if (
        err instanceof TypeError ||
        errMsg?.includes('Load failed') ||
        errMsg?.includes('TypeError') ||
        errMsg?.includes('Failed to fetch') ||
        errMsg?.includes('NetworkError')
      ) {
        console.warn('[TRANSFER] Network error (Load failed) - treating as no pending transfer');
        if (retries > 0) {
          console.warn(`[TRANSFER] Retrying after network error... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return checkPendingTransfer(retries - 1);
        }
        console.warn('[TRANSFER] Network error after all retries. No pending transfer.');
        setPendingTransfer(null);
        return;
      }

      if (err?.name === 'AbortError' || errMsg?.includes('aborted')) {
        console.warn('[TRANSFER] Operation aborted (timeout or cancellation)');
        if (retries > 0) {
          console.warn(`[TRANSFER] Retrying after abort... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return checkPendingTransfer(retries - 1);
        }
        console.warn('[TRANSFER] AbortError after all retries. No pending transfer.');
        setPendingTransfer(null);
        return;
      }

      if (err?.code === 'PGRST116' || err?.status === 406 || errMsg?.includes('0 rows')) {
        setPendingTransfer(null);
        return;
      }

      console.error('[TRANSFER] Error checking pending transfer:', err);
      setPendingTransfer(null);
    }
  };

  const handleAccept = async () => {
    setLoading(true);
    setError('');

    try {
      if (!pendingTransfer) return;

      const { data: fromProfile, error: fromError } = await supabase?.from('profiles')?.select('full_name')?.eq('id', pendingTransfer?.from_user_id)?.single();

      if (fromError) throw fromError;

      const { data: toProfile, error: toError } = await supabase?.from('profiles')?.select('full_name')?.eq('id', user?.id)?.single();

      if (toError) throw toError;

      const { error: updateNewError } = await supabase?.from('tenant_members')?.update({ role: 'COMMAND' })?.eq('tenant_id', pendingTransfer?.tenant_id)?.eq('user_id', user?.id);

      if (updateNewError) throw updateNewError;

      const { error: updateOldError } = await supabase?.from('tenant_members')?.update({ role: 'CHIEF' })?.eq('tenant_id', pendingTransfer?.tenant_id)?.eq('user_id', pendingTransfer?.from_user_id);

      if (updateOldError) throw updateOldError;

      const { error: updateTransferError } = await supabase?.from('admin_transfer_requests')?.update({
          status: 'ACCEPTED',
          resolved_at: new Date()?.toISOString()
        })?.eq('id', pendingTransfer?.id);

      if (updateTransferError) throw updateTransferError;

      const { error: auditError } = await supabase?.from('admin_transfer_audit')?.insert({
          tenant_id: pendingTransfer?.tenant_id,
          from_user_id: pendingTransfer?.from_user_id,
          to_user_id: user?.id,
          from_user_name: fromProfile?.full_name,
          to_user_name: toProfile?.full_name
        });

      if (auditError) throw auditError;

      onAccept?.();
      window.location?.reload();
    } catch (err) {
      console.error('Error accepting admin role:', err);
      setError(err?.message || 'Failed to accept admin role');
    } finally {
      setLoading(false);
    }
  };

  if (!pendingTransfer) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 dark:bg-amber-600 shadow-lg">
      <div className="max-w-[1800px] mx-auto px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <Icon name="Shield" size={24} className="text-white flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-white font-semibold text-lg mb-1">
                You have been assigned as Vessel Admin for {vesselName}
              </h3>
              <p className="text-white/90 text-sm mb-3">
                Please confirm to accept this role and gain full vessel admin access.
              </p>
              {error && (
                <div className="bg-white/20 border border-white/30 rounded-lg p-2 mb-3">
                  <p className="text-white text-sm">{error}</p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleAccept}
                  disabled={loading}
                  className="bg-white text-amber-600 hover:bg-white/90"
                >
                  {loading ? 'Processing...' : 'Accept Admin Role'}
                </Button>
                <p className="text-white/80 text-xs">
                  You currently have read-only access until you accept.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcceptAdminBanner;