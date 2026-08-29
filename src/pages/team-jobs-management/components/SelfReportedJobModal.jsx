import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import '../job-modals.css';
import { useAuth } from '../../../contexts/AuthContext';
import { createCard } from '../utils/cardStorage';


import ModalShell from '../../../components/ui/ModalShell';
const SelfReportedJobModal = ({ onClose, onSuccess }) => {
  const { currentUser } = useAuth();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    timeSpent: '',
    attachments: []
  });
  const [uploadingFile, setUploadingFile] = useState(false);

  const handleFileUpload = (e) => {
    const files = Array.from(e?.target?.files || []);
    if (files?.length === 0) return;

    setUploadingFile(true);
    
    // Simulate file upload (in production, upload to server/storage)
    setTimeout(() => {
      const newAttachments = files?.map(file => ({
        id: crypto.randomUUID(),
        name: file?.name,
        url: URL.createObjectURL(file),
        type: file?.type,
        size: file?.size
      }));
      
      setFormData(prev => ({
        ...prev,
        attachments: [...prev?.attachments, ...newAttachments]
      }));
      setUploadingFile(false);
    }, 500);
  };

  const handleRemoveAttachment = (attachmentId) => {
    setFormData(prev => ({
      ...prev,
      attachments: prev?.attachments?.filter(a => a?.id !== attachmentId)
    }));
  };

  const handleSubmit = () => {
    if (!formData?.title?.trim()) {
      alert('Please enter a job title');
      return;
    }

    // Create self-reported job
    const selfReportedJob = {
      boardId: null, // Self-reported jobs don't belong to a board initiallytype: 'task',jobType: 'self-reported',
      title: formData?.title,
      description: formData?.description,
      department: currentUser?.department,
      assignees: [], // Self-reported jobs have no assignees
      dueDate: new Date()?.toISOString(),
      priority: 'medium',status: 'completed',
      attachments: formData?.attachments,
      notes: formData?.timeSpent ? [{
        id: crypto.randomUUID(),
        text: `Time spent: ${formData?.timeSpent}`,
        author: currentUser?.name,
        authorId: currentUser?.id,
        timestamp: new Date()?.toISOString()
      }] : [],
      completedBy: currentUser?.id,
      completedAt: new Date()?.toISOString()
    };

    const newCard = createCard(
      selfReportedJob,
      currentUser?.id,
      currentUser?.name,
      currentUser?.tier
    );

    onSuccess(newCard);
    onClose();
  };

  return (
    <ModalShell
      onClose={onClose}
      isDirty={!!formData?.title?.trim() || !!formData?.description?.trim()}
      panelClassName="jm-panel lg"
    >
      <div className="jm-head">
        <div>
          <p className="jm-eyebrow">Jobs</p>
          <h2 className="jm-title">Report work done</h2>
          <p className="jm-sub">Record work you have completed so it can be reviewed.</p>
        </div>
        <button onClick={onClose} className="jm-x" title="Close">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="jm-body">
        <div className="jm-section">
          <label className="jm-label" htmlFor="srj-title">
            What did you complete<span className="req">required</span>
          </label>
          <input
            id="srj-title"
            autoFocus
            type="text"
            className="jm-titlefield"
            placeholder="e.g. Deep cleaned the main saloon"
            value={formData?.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="srj-desc">
            Description<span className="opt">optional</span>
          </label>
          <textarea
            id="srj-desc"
            className="jm-textarea"
            rows={4}
            placeholder="Detail about the work completed…"
            value={formData?.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label" htmlFor="srj-time">
            Time spent<span className="opt">optional</span>
          </label>
          <input
            id="srj-time"
            type="text"
            className="jm-input"
            placeholder="e.g. 2 hours, 30 minutes"
            value={formData?.timeSpent}
            onChange={(e) => setFormData(prev => ({ ...prev, timeSpent: e?.target?.value }))}
          />
        </div>

        <div className="jm-section">
          <label className="jm-label">
            Photos &amp; attachments<span className="opt">optional</span>
          </label>
          <input
            type="file"
            id="file-upload"
            multiple
            accept="image/*,.pdf,.doc,.docx"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <label htmlFor="file-upload" className="jm-drop">
            <span className="jm-drop-ico"><Icon name="Upload" size={18} /></span>
            <span className="jm-drop-t">Click to upload files</span>
            <span className="jm-drop-s">Images, PDFs or documents</span>
          </label>

          {formData?.attachments?.length > 0 && (
            <div className="jm-filelist">
              {formData?.attachments?.map(attachment => (
                <div key={attachment?.id} className="jm-file">
                  <Icon name="Paperclip" size={14} />
                  <span className="name">{attachment?.name}</span>
                  <span className="size">{(attachment?.size / 1024)?.toFixed(1)} KB</span>
                  <button
                    onClick={() => handleRemoveAttachment(attachment?.id)}
                    className="jm-file-x"
                    title="Remove attachment"
                  >
                    <Icon name="X" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="jm-section">
          <div className="jm-notice info">
            <Icon name="Info" size={15} />
            <span>
              <strong>What happens next?</strong> Your HOD and chief review this report — they can
              accept it, edit it, or turn it into a planned job. You will be notified either way.
            </span>
          </div>
        </div>
      </div>

      <div className="jm-foot">
        <button className="jm-btn ghost" onClick={onClose}>Cancel</button>
        <div className="spacer" />
        <button
          className="jm-btn primary"
          onClick={handleSubmit}
          disabled={!formData?.title?.trim() || uploadingFile}
        >
          {uploadingFile ? <span className="jm-spin sm" /> : <Icon name="Send" size={15} />}
          {uploadingFile ? 'Uploading…' : 'Submit for review'}
        </button>
      </div>
    </ModalShell>
  );
};

export default SelfReportedJobModal;