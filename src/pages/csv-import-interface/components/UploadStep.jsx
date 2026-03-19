import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const UploadStep = ({ onFileUploaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleDragOver = (e) => {
    e?.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e?.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e?.preventDefault();
    setIsDragging(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleFileSelect = (e) => {
    const file = e?.target?.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file) => {
    setError(null);
    setIsProcessing(true);

    // Validate file type
    if (!file?.name?.endsWith('.csv')) {
      setError('Please upload a CSV file');
      setIsProcessing(false);
      return;
    }

    // Validate file size
    if (file?.size > MAX_FILE_SIZE) {
      setError('File size exceeds 10MB limit');
      setIsProcessing(false);
      return;
    }

    setFileName(file?.name);

    // Read and parse CSV
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e?.target?.result;
        const lines = text?.split('\n')?.filter(line => line?.trim());
        
        if (lines?.length < 2) {
          setError('CSV file must contain headers and at least one data row');
          setIsProcessing(false);
          return;
        }

        // Parse headers
        const headers = lines?.[0]?.split(',')?.map(h => h?.trim()?.replace(/"/g, ''));
        
        // Parse data rows
        const data = lines?.slice(1)?.map((line, index) => {
          const values = line?.split(',')?.map(v => v?.trim()?.replace(/"/g, ''));
          const row = {};
          headers?.forEach((header, i) => {
            row[header] = values?.[i] || '';
          });
          row._rowIndex = index + 2; // +2 for header and 1-based indexing
          return row;
        });

        setIsProcessing(false);
        onFileUploaded(data, headers);
      } catch (err) {
        setError('Failed to parse CSV file. Please check the format.');
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setIsProcessing(false);
    };

    reader?.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const template = `Item Name,Category,Subcategory,Unit,Primary Location,Quantity,Par Level,Reorder Point,Supplier,Purchase Price,Notes
Sample Item,Pantry,Dry Goods,each,Pantry,10,20,5,Sample Supplier,15.99,Sample notes
`;
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cargo_inventory_template.csv';
    a?.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      {/* Upload Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-smooth ${
          isDragging
            ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50 hover:bg-muted/30'
        }`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon name="Upload" size={40} className="text-primary" />
          </div>
          
          <div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {fileName ? fileName : 'Drop your CSV file here'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              or click to browse files
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          <Button
            variant="default"
            iconName="FileUp"
            onClick={() => fileInputRef?.current?.click()}
            disabled={isProcessing}
            loading={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Select CSV File'}
          </Button>

          {error && (
            <div className="flex items-center gap-2 text-error mt-4">
              <Icon name="AlertCircle" size={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* File Requirements */}
      <div className="mt-8 bg-muted/30 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Icon name="Info" size={16} />
          File Requirements
        </h4>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Icon name="Check" size={16} className="text-success mt-0.5" />
            <span>CSV format (.csv extension)</span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="Check" size={16} className="text-success mt-0.5" />
            <span>Maximum file size: 10MB</span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="Check" size={16} className="text-success mt-0.5" />
            <span>First row must contain column headers</span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="Check" size={16} className="text-success mt-0.5" />
            <span>At least one data row required</span>
          </li>
        </ul>
      </div>

      {/* Template Download */}
      <div className="mt-6 flex justify-center">
        <Button
          variant="outline"
          iconName="Download"
          onClick={handleDownloadTemplate}
        >
          Download CSV Template
        </Button>
      </div>
    </div>
  );
};

export default UploadStep;