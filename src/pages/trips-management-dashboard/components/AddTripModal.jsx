import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { createTrip, updateTrip, TripType } from '../utils/tripStorage';
import { useNavigate } from 'react-router-dom';
import ModalShell from '../../../components/ui/ModalShell';
import './AddTripModal.css';

const TRIP_TYPES = [
  { value: TripType?.OWNER, label: 'Owner' },
  { value: TripType?.CHARTER, label: 'Charter' },
  { value: TripType?.FRIENDS_FAMILY, label: 'Friends / Family' },
  { value: TripType?.OTHER, label: 'Other' },
];
const initials = (first, last) => `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';

const AddTripModal = ({ isOpen, onClose, onSave, editingTrip, guests }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '', startDate: '', endDate: '', notes: '',
    guestIds: [], activeGuestIds: [], tripType: TripType?.OWNER,
    itinerarySummary: '', billingBasis: 'inclusive',
  });
  const [errors, setErrors] = useState({});
  const [guestSearchQuery, setGuestSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const base = editingTrip || {};
    setFormData({
      name: base.name || '',
      startDate: base.startDate || '',
      endDate: base.endDate || '',
      notes: base.notes || '',
      guestIds: base.guestIds || [],
      activeGuestIds: base.activeGuestIds || [],
      tripType: base.tripType || TripType?.OWNER,
      itinerarySummary: base.itinerarySummary || '',
      billingBasis: base.billingBasis || 'inclusive',
    });
    setErrors({});
    setGuestSearchQuery('');
  }, [isOpen, editingTrip]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors?.[field]) setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const handleGuestToggle = (guestId) => {
    setFormData((prev) => {
      const isSelected = prev?.guestIds?.includes(guestId);
      if (isSelected) {
        return { ...prev, guestIds: prev.guestIds.filter((id) => id !== guestId), activeGuestIds: prev.activeGuestIds.filter((id) => id !== guestId) };
      }
      return { ...prev, guestIds: [...prev.guestIds, guestId] };
    });
    if (errors?.guests) setErrors((prev) => ({ ...prev, guests: null }));
  };

  const handleActiveToggle = (guestId) => {
    setFormData((prev) => {
      const isActive = prev?.activeGuestIds?.includes(guestId);
      return isActive
        ? { ...prev, activeGuestIds: prev.activeGuestIds.filter((id) => id !== guestId) }
        : { ...prev, activeGuestIds: [...prev.activeGuestIds, guestId] };
    });
  };

  const validate = () => {
    const next = {};
    if (!formData?.name?.trim()) next.name = 'Trip name is required';
    if (!formData?.startDate) next.startDate = 'Start date is required';
    if (!formData?.endDate) next.endDate = 'End date is required';
    if (formData?.startDate && formData?.endDate && new Date(formData.endDate) < new Date(formData.startDate)) {
      next.endDate = 'End date must be after start date';
    }
    if (formData?.guestIds?.length === 0) next.guests = 'Select at least one guest';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (editingTrip) {
      const updated = await updateTrip(editingTrip?.id, formData);
      if (updated) { showToast('Trip updated successfully', 'success'); onSave(); }
      else showToast('Failed to update trip', 'error');
    } else {
      const newTrip = await createTrip(formData);
      if (newTrip) { showToast('Trip created successfully', 'success'); onSave(); navigate(`/trips/${newTrip?.id}`); }
      else showToast('Failed to create trip', 'error');
    }
  };

  const filteredGuests = guests?.filter((guest) => {
    if (!guestSearchQuery?.trim()) return true;
    const q = guestSearchQuery.toLowerCase();
    const fullName = `${guest?.firstName} ${guest?.lastName}`.toLowerCase();
    const cabin = (guest?.cabinLocationPath || '').toLowerCase();
    return fullName.includes(q) || cabin.includes(q);
  });

  const cabinLeaf = (v) => {
    if (!v) return '';
    const parts = String(v).split('>').map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  };

  return (
    <ModalShell onClose={onClose} panelClassName="atm-panel">
      <div className="atm-head">
        <h2 className="atm-title">TRIP, <em>{editingTrip ? 'edit' : 'new'}</em></h2>
        <button className="atm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="atm-body">
        <div className="atm-section">
          <label className="atm-label">Trip name <span className="atm-req">required</span></label>
          <input className={`atm-field${errors?.name ? ' invalid' : ''}`} value={formData?.name}
            onChange={(e) => handleChange('name', e?.target?.value)} placeholder="e.g. Summer Mediterranean Charter" />
          {errors?.name && <div className="atm-err">{errors.name}</div>}
        </div>

        <div className="atm-section">
          <label className="atm-label">Trip type</label>
          <div className="atm-pills">
            {TRIP_TYPES.map((t) => (
              <button type="button" key={t.value} className={`atm-pill${formData?.tripType === t.value ? ' on' : ''}`} onClick={() => handleChange('tripType', t.value)}>{t.label}</button>
            ))}
          </div>
        </div>

        <div className="atm-section">
          <label className="atm-label">Billing basis</label>
          <div className="atm-opts">
            <button type="button" className={`atm-opt-card${formData?.billingBasis === 'inclusive' ? ' on' : ''}`} onClick={() => handleChange('billingBasis', 'inclusive')}>
              <div className="atm-opt-t">Inclusive</div>
              <div className="atm-opt-s">CYBA · nothing billed</div>
            </button>
            <button type="button" className={`atm-opt-card${formData?.billingBasis === 'plus_expenses' ? ' on' : ''}`} onClick={() => handleChange('billingBasis', 'plus_expenses')}>
              <div className="atm-opt-t">Plus expenses</div>
              <div className="atm-opt-s">MYBA · guest laundry billable</div>
            </button>
          </div>
          <div className="atm-hint">Whether guests’ personal laundry is charged. Set pricing in Vessel Settings → Charter Billing.</div>
        </div>

        <div className="atm-section">
          <label className="atm-label">Itinerary summary <span className="atm-opt">optional</span></label>
          <input className="atm-field" value={formData?.itinerarySummary}
            onChange={(e) => handleChange('itinerarySummary', e?.target?.value)} placeholder="e.g. Sardinia → Corsica → Monaco" />
        </div>

        <div className="atm-section">
          <div className="atm-grid2">
            <div>
              <label className="atm-label">Start date <span className="atm-req">required</span></label>
              <input type="date" className={`atm-field${errors?.startDate ? ' invalid' : ''}`} value={formData?.startDate} onChange={(e) => handleChange('startDate', e?.target?.value)} />
              {errors?.startDate && <div className="atm-err">{errors.startDate}</div>}
            </div>
            <div>
              <label className="atm-label">End date <span className="atm-req">required</span></label>
              <input type="date" className={`atm-field${errors?.endDate ? ' invalid' : ''}`} value={formData?.endDate} onChange={(e) => handleChange('endDate', e?.target?.value)} />
              {errors?.endDate && <div className="atm-err">{errors.endDate}</div>}
            </div>
          </div>
        </div>

        <div className="atm-section">
          <label className="atm-label">Notes <span className="atm-opt">optional</span></label>
          <textarea className="atm-field" rows={3} value={formData?.notes}
            onChange={(e) => handleChange('notes', e?.target?.value)} placeholder="Add any additional notes about this trip…" />
        </div>

        <div className="atm-section" style={{ marginBottom: 0 }}>
          <label className="atm-label">Guests <span className="atm-req">required</span></label>
          {errors?.guests && <div className="atm-err" style={{ marginTop: 0, marginBottom: 8 }}>{errors.guests}</div>}
          <div className="atm-search">
            <Icon name="Search" size={16} />
            <input className="atm-field" placeholder="Search guests…" value={guestSearchQuery} onChange={(e) => setGuestSearchQuery(e?.target?.value)} />
          </div>
          <div className="atm-glist">
            {filteredGuests?.length === 0 ? (
              <div className="atm-gempty">No guests found</div>
            ) : filteredGuests.map((guest) => {
              const isSelected = formData?.guestIds?.includes(guest?.id);
              const isActive = formData?.activeGuestIds?.includes(guest?.id);
              const cabin = cabinLeaf(guest?.cabinLocationPath);
              return (
                <div key={guest?.id} className={`atm-grow${isSelected ? ' sel' : ''}`} role="button" tabIndex={0}
                  onClick={() => handleGuestToggle(guest?.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGuestToggle(guest?.id); } }}>
                  <span className="atm-gcheck">{isSelected && <Icon name="Check" size={13} />}</span>
                  <span className="atm-gav">{guest?.photo ? <img src={guest.photo} alt="" loading="lazy" decoding="async" /> : initials(guest?.firstName, guest?.lastName)}</span>
                  <div className="atm-gmain">
                    <div className="atm-gname">{guest?.firstName} {guest?.lastName}</div>
                    {cabin && <div className="atm-gcabin">{cabin}</div>}
                  </div>
                  {isSelected && (
                    <button type="button" className={`atm-gactive${isActive ? ' on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleActiveToggle(guest?.id); }}>
                      {isActive ? 'Active' : 'Set active'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="atm-gcount">{formData?.guestIds?.length} guest{formData?.guestIds?.length !== 1 ? 's' : ''} selected</div>
        </div>
      </div>

      <div className="atm-foot">
        <button type="button" className="atm-btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="atm-btn primary" onClick={handleSubmit}>{editingTrip ? 'Save changes' : 'Create trip'}</button>
      </div>
    </ModalShell>
  );
};

export default AddTripModal;
