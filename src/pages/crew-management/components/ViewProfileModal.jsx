import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';

const ViewProfileModal = ({ isOpen, onClose, userId }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && userId) {
      loadProfile();
    }
  }, [isOpen, userId]);

  const loadProfile = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('VIEW PROFILE: Loading profile for user_id:', userId);
      
      const { data, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('*')
        ?.eq('id', userId)
        ?.single();

      if (profileError) {
        console.error('VIEW PROFILE error:', profileError);
        throw profileError;
      }

      console.log('VIEW PROFILE: Profile loaded:', data);
      setProfile(data);
    } catch (err) {
      console.error('Failed to load profile:', err);
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setProfile(null);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-card border-b border-border p-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="Eye" size={20} className="text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              View Profile
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : error ? (
            <div className="bg-error/10 border border-error/20 rounded-lg p-4 flex items-start gap-3">
              <Icon name="AlertCircle" size={20} className="text-error mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-error mb-1">Error Loading Profile</p>
                <p className="text-sm text-error/80">{error}</p>
              </div>
            </div>
          ) : profile ? (
            <div className="space-y-6">
              {/* Personal Details Section */}
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Icon name="User" size={16} className="text-primary" />
                  Personal Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name</label>
                    <p className="text-sm text-foreground">{profile?.full_name || '—'}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                    <p className="text-sm text-foreground">{profile?.email || '—'}</p>
                  </div>
                  {profile?.phone && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
                      <p className="text-sm text-foreground">{profile?.phone}</p>
                    </div>
                  )}
                  {profile?.date_of_birth && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Date of Birth</label>
                      <p className="text-sm text-foreground">{new Date(profile?.date_of_birth)?.toLocaleDateString()}</p>
                    </div>
                  )}
                  {profile?.nationality && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Nationality</label>
                      <p className="text-sm text-foreground">{profile?.nationality}</p>
                    </div>
                  )}
                  {profile?.address && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Address</label>
                      <p className="text-sm text-foreground">{profile?.address}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Banking Details Section */}
              {(profile?.bank_name || profile?.bank_account_number || profile?.bank_routing_number || profile?.bank_swift_code) && (
                <div className="bg-muted/20 border border-border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Icon name="CreditCard" size={16} className="text-primary" />
                    Banking Details
                  </h3>
                  <div className="space-y-3">
                    {profile?.bank_name && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Bank Name</label>
                        <p className="text-sm text-foreground">{profile?.bank_name}</p>
                      </div>
                    )}
                    {profile?.bank_account_number && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Account Number</label>
                        <p className="text-sm text-foreground font-mono">{profile?.bank_account_number}</p>
                      </div>
                    )}
                    {profile?.bank_routing_number && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Routing Number</label>
                        <p className="text-sm text-foreground font-mono">{profile?.bank_routing_number}</p>
                      </div>
                    )}
                    {profile?.bank_swift_code && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">SWIFT/BIC Code</label>
                        <p className="text-sm text-foreground font-mono">{profile?.bank_swift_code}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Emergency Contact / Next of Kin Section */}
              {(profile?.emergency_contact_name || profile?.emergency_contact_phone || profile?.emergency_contact_relationship) && (
                <div className="bg-muted/20 border border-border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Icon name="Phone" size={16} className="text-primary" />
                    Emergency Contact / Next of Kin
                  </h3>
                  <div className="space-y-3">
                    {profile?.emergency_contact_name && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                        <p className="text-sm text-foreground">{profile?.emergency_contact_name}</p>
                      </div>
                    )}
                    {profile?.emergency_contact_relationship && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Relationship</label>
                        <p className="text-sm text-foreground">{profile?.emergency_contact_relationship}</p>
                      </div>
                    )}
                    {profile?.emergency_contact_phone && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
                        <p className="text-sm text-foreground">{profile?.emergency_contact_phone}</p>
                      </div>
                    )}
                    {profile?.emergency_contact_email && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                        <p className="text-sm text-foreground">{profile?.emergency_contact_email}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Additional Profile Fields (if any exist) */}
              {profile?.notes && (
                <div className="bg-muted/20 border border-border rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Icon name="FileText" size={16} className="text-primary" />
                    Additional Information
                  </h3>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{profile?.notes}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="User" size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">No profile data available</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-card border-t border-border p-4 flex items-center justify-end flex-shrink-0">
          <Button onClick={handleClose} variant="outline">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ViewProfileModal;