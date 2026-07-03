import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import SignaturePad from '../../../components/SignaturePad';
import { showToast } from '../../../utils/toast';
import {
  fetchCaptainCredentials, saveCaptainSignature, saveCaptainStamp,
  clearCaptainSignature, clearCaptainStamp, signedCaptainCredentialUrl,
} from '../utils/captainCredentials';

// Personal, self-service only — RLS restricts every read/write to the owning
// user (see 20260703120000_captain_credentials.sql), so this only ever
// renders for the captain looking at his own profile.
const CaptainCredentialsTab = ({ userId, tenantId, isOwnProfile }) => {
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [busy, setBusy] = useState(false);

  const [signaturePath, setSignaturePath] = useState(null);
  const [stampPath, setStampPath] = useState(null);
  const [signatureUrl, setSignatureUrl] = useState(null);
  const [stampUrl, setStampUrl] = useState(null);

  const [drawnSig, setDrawnSig] = useState(null);
  const [stampFile, setStampFile] = useState(null);
  const [stampPreview, setStampPreview] = useState(null);
  const [stampError, setStampError] = useState('');
  const stampInputRef = useRef(null);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const cred = await fetchCaptainCredentials(userId);
    setSignaturePath(cred.signature_path || null);
    setStampPath(cred.stamp_path || null);
    const [sigUrl, stUrl] = await Promise.all([
      signedCaptainCredentialUrl(cred.signature_path),
      signedCaptainCredentialUrl(cred.stamp_path),
    ]);
    setSignatureUrl(sigUrl);
    setStampUrl(stUrl);
    setLoading(false);
  };

  useEffect(() => { if (isOwnProfile) load(); else setLoading(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId, isOwnProfile]);

  if (!isOwnProfile) {
    return (
      <div>
        <div className="cp-section-head"><span className="cp-section-num">★ /</span><h3>Signature &amp; Stamp</h3></div>
        <p className="cp-set-note-empty">This is personal to the captain — only they can save their signature and vessel stamp from their own profile.</p>
      </div>
    );
  }

  const saveSignature = async () => {
    if (!drawnSig) return;
    setBusy(true);
    try {
      await saveCaptainSignature(userId, tenantId, drawnSig);
      setDrawnSig(null);
      await load();
      showToast('Signature saved', 'success');
    } catch (e) { showToast(e?.message || 'Could not save signature', 'error'); }
    finally { setBusy(false); }
  };

  const removeSignature = async () => {
    setBusy(true);
    try {
      await clearCaptainSignature(userId);
      setSignaturePath(null); setSignatureUrl(null);
      showToast('Signature removed', 'success');
    } catch (e) { showToast(e?.message || 'Could not remove signature', 'error'); }
    finally { setBusy(false); }
  };

  const onStampFile = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file?.type)) { setStampError('Stamp image must be a PNG or JPEG.'); return; }
    if (file?.size > 2097152) { setStampError('Image must be smaller than 2MB'); return; }
    setStampError('');
    setStampFile(file);
    setStampPreview(URL.createObjectURL(file));
  };

  const saveStamp = async () => {
    if (!stampFile) return;
    setBusy(true);
    try {
      await saveCaptainStamp(userId, tenantId, stampFile);
      setStampFile(null); setStampPreview(null);
      await load();
      showToast('Vessel stamp saved', 'success');
    } catch (e) { showToast(e?.message || 'Could not save stamp', 'error'); }
    finally { setBusy(false); }
  };

  const removeStamp = async () => {
    setBusy(true);
    try {
      await clearCaptainStamp(userId);
      setStampPath(null); setStampUrl(null);
      showToast('Vessel stamp removed', 'success');
    } catch (e) { showToast(e?.message || 'Could not remove stamp', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="cp-tab-head">
        <div className="cp-section-head">
          <span className="cp-section-num">★ /</span>
          <h3>Signature &amp; Stamp</h3>
        </div>
        <div className="cp-tab-actions">
          {editMode
            ? <Button iconName="Check" size="sm" onClick={() => setEditMode(false)} disabled={busy}>Done</Button>
            : <Button variant="outline" iconName="Pencil" size="sm" onClick={() => setEditMode(true)}>Edit</Button>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : (
        <>
          <p className="kit-sub">Saved privately to your own account, for signing off documents you produce (contracts, discharge paperwork, and similar). No one else on the vessel can see or use these.</p>

          <div className="cp-group">
            <div className="cp-group-head"><span className="dia">◆</span><span className="t">Signature</span><span className="line" /></div>
            {editMode ? (
              <div className="cc-edit-block">
                {signatureUrl && !drawnSig && (
                  <div className="cc-current">
                    <img src={signatureUrl} alt="Current signature" className="cc-sig-preview" />
                    <Button variant="outline" size="sm" iconName="Trash2" onClick={removeSignature} disabled={busy}>Remove</Button>
                  </div>
                )}
                <SignaturePad onSign={setDrawnSig} height={120} />
                <div className="cc-edit-actions">
                  <Button size="sm" iconName="Check" onClick={saveSignature} disabled={busy || !drawnSig}>Save signature</Button>
                </div>
              </div>
            ) : signatureUrl ? (
              <img src={signatureUrl} alt="Your signature" className="cc-sig-preview" />
            ) : (
              <div className="kit-empty">
                <Icon name="PenLine" size={22} />
                <p>No signature saved yet — Edit to draw one.</p>
              </div>
            )}
          </div>

          <div className="cp-group">
            <div className="cp-group-head"><span className="dia">◆</span><span className="t">Vessel stamp</span><span className="line" /></div>
            {editMode ? (
              <div className="cc-edit-block">
                {(stampPreview || stampUrl) && (
                  <div className="cc-current">
                    <img src={stampPreview || stampUrl} alt="Vessel stamp" className="cc-stamp-preview" />
                    {!stampPreview && <Button variant="outline" size="sm" iconName="Trash2" onClick={removeStamp} disabled={busy}>Remove</Button>}
                  </div>
                )}
                <input ref={stampInputRef} type="file" accept="image/png,image/jpeg" onChange={onStampFile} hidden />
                <Button variant="outline" size="sm" iconName="Upload" onClick={() => stampInputRef.current?.click()}>
                  {stampUrl ? 'Replace image' : 'Upload image'}
                </Button>
                {stampError && <p className="cc-error">{stampError}</p>}
                {stampFile && (
                  <div className="cc-edit-actions">
                    <Button size="sm" iconName="Check" onClick={saveStamp} disabled={busy}>Save stamp</Button>
                  </div>
                )}
              </div>
            ) : stampUrl ? (
              <img src={stampUrl} alt="Vessel stamp" className="cc-stamp-preview" />
            ) : (
              <div className="kit-empty">
                <Icon name="Stamp" size={22} />
                <p>No vessel stamp uploaded yet — Edit to add one.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CaptainCredentialsTab;
