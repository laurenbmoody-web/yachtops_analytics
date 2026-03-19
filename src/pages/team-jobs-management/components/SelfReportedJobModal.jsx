import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { useAuth } from '../../../contexts/AuthContext';
import { createCard } from '../utils/cardStorage';


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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Report Task Completed</h2>
            <p className="text-sm text-gray-500 mt-1">Record work you've completed for review</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Icon name="x" size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Task Title <span className="text-red-500">*</span>
            </label>
            <Input
              value={formData?.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
              placeholder="What did you complete?"
              className="w-full"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData?.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
              placeholder="Provide details about the work completed..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Time Spent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Time Spent
            </label>
            <Input
              value={formData?.timeSpent}
              onChange={(e) => setFormData(prev => ({ ...prev, timeSpent: e?.target?.value }))}
              placeholder="e.g., 2 hours, 30 minutes"
              className="w-full"
            />
          </div>

          {/* Photos/Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Photos / Attachments
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
              <input
                type="file"
                id="file-upload"
                multiple
                accept="image/*,.pdf,.doc,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
              <label
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center cursor-pointer"
              >
                <Icon name="upload" size={32} className="text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">Click to upload files</span>
                <span className="text-xs text-gray-400 mt-1">Images, PDFs, or documents</span>
              </label>
            </div>

            {/* Attachment List */}
            {formData?.attachments?.length > 0 && (
              <div className="mt-3 space-y-2">
                {formData?.attachments?.map(attachment => (
                  <div
                    key={attachment?.id}
                    className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md"
                  >
                    <div className="flex items-center gap-2">
                      <Icon name="paperclip" size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-700">{attachment?.name}</span>
                      <span className="text-xs text-gray-400">
                        ({(attachment?.size / 1024)?.toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveAttachment(attachment?.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-3">
              <Icon name="info" size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">What happens next?</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>Your HOD and Chief will review this task</li>
                  <li>They can accept, edit, or convert it to a planned job</li>
                  <li>You'll be notified of their decision</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
          <Button
            onClick={onClose}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formData?.title?.trim() || uploadingFile}
          >
            {uploadingFile ? 'Uploading...' : 'Submit for Review'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SelfReportedJobModal;
