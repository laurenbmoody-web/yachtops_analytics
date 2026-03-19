import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

const TransferAdminModal = ({ onClose, onSuccess }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vesselMembers, setVesselMembers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserName, setSelectedUserName] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');

  useEffect(() => {
    fetchVesselMembers();
  }, []);

  const fetchVesselMembers = async () => {
    try {
      // Get current user's profile to find active tenant
      const { data: profile, error: profileError } = await supabase?.from('profiles')?.select('last_active_tenant_id, full_name')?.eq('id', user?.id)?.single();

      if (profileError) throw profileError;

      setCurrentUserName(profile?.full_name || 'Current Admin');

      const tenantId = profile?.last_active_tenant_id;
      if (!tenantId) {
        setError('No active vessel found');
        return;
      }

      // Fetch all active vessel members except current user and those with COMMAND role
      const { data: members, error: membersError } = await supabase?.from('tenant_members')?.select(`
          user_id,
          role,
          profiles:user_id (
            id,
            full_name,
            email
          )
        `)?.eq('tenant_id', tenantId)?.eq('active', true)?.neq('user_id', user?.id)?.neq('role', 'COMMAND');

      if (membersError) throw membersError;

      setVesselMembers(members || []);
    } catch (err) {
      console.error('Error fetching vessel members:', err);
      setError('Failed to load vessel members');
    }
  };

  const handleTransfer = async () => {
    if (!selectedUserId) {
      setError('Please select a user to transfer admin access to');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Get current user's profile to find active tenant
      const { data: profile, error: profileError } = await supabase?.from('profiles')?.select('last_active_tenant_id')?.eq('id', user?.id)?.single();

      if (profileError) throw profileError;

      const tenantId = profile?.last_active_tenant_id;
      if (!tenantId) throw new Error('No active vessel found');

      // Check if there's already a pending transfer
      const { data: existingTransfer, error: checkError } = await supabase?.from('admin_transfer_requests')?.select('id')?.eq('tenant_id', tenantId)?.eq('status', 'PENDING')?.maybeSingle();

      // Handle 406 or no rows found as normal (not an error)
      if (checkError) {
        // 406 means no rows found, which is fine - no existing transfer
        if (checkError?.code === 'PGRST116' || checkError?.status === 406 || checkError?.message?.includes('0 rows')) {
          console.log('No existing transfer found (expected)');
          // Continue to create new transfer
        } else {
          // Real error, throw it
          throw checkError;
        }
      } else if (existingTransfer) {
        setError('There is already a pending admin transfer');
        setLoading(false);
        return;
      }

      // Create transfer request
      const { error: insertError } = await supabase?.from('admin_transfer_requests')?.insert({
          tenant_id: tenantId,
          from_user_id: user?.id,
          to_user_id: selectedUserId,
          status: 'PENDING'
        });

      if (insertError) throw insertError;

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error creating transfer request:', err);
      setError(err?.message || 'Failed to initiate admin transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChange = (value) => {
    setSelectedUserId(value);
    const member = vesselMembers?.find(m => m?.profiles?.id === value);
    setSelectedUserName(member?.profiles?.full_name || '');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg">
        <div className="border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Transfer Vessel Admin</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            disabled={loading}
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Warning Message */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Icon name="AlertTriangle" size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900 dark:text-amber-100">
                <p className="font-medium mb-1">Important</p>
                <p className="text-amber-700 dark:text-amber-300">
                  This will transfer vessel admin access to another crew member. 
                  You will remain on the vessel with your current access level.
                </p>
              </div>
            </div>
          </div>

          {/* Select User */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Select New Vessel Admin <span className="text-error">*</span>
            </label>
            <Select
              value={selectedUserId}
              onChange={handleSelectChange}
              options={vesselMembers?.map(member => ({
                label: `${member?.profiles?.full_name} (${member?.profiles?.email})`,
                value: member?.profiles?.id
              }))}
              placeholder="Select a crew member"
              disabled={loading || vesselMembers?.length === 0}
            />
            {vesselMembers?.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                No eligible crew members found. Add crew members first.
              </p>
            )}
          </div>

          {/* Confirmation Text */}
          {selectedUserId && (
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <p className="text-sm text-foreground">
                This will transfer vessel admin access to <span className="font-semibold">{selectedUserName}</span>.
                You ({currentUserName}) will remain on the vessel with your current access level.
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
              <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleTransfer}
              disabled={loading || !selectedUserId || vesselMembers?.length === 0}
            >
              {loading ? 'Processing...' : 'Transfer Admin Access'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferAdminModal;