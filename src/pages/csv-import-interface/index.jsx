import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';

import UploadStep from './components/UploadStep';
import FieldMappingStep from './components/FieldMappingStep';
import PreviewStep from './components/PreviewStep';
import ImportProgressStep from './components/ImportProgressStep';

const CSVImportInterface = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [csvData, setCsvData] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [fieldMapping, setFieldMapping] = useState({});
  const [validationResults, setValidationResults] = useState([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importComplete, setImportComplete] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

  const steps = [
    { number: 1, label: 'Upload CSV', icon: 'Upload' },
    { number: 2, label: 'Map Fields', icon: 'GitBranch' },
    { number: 3, label: 'Preview & Validate', icon: 'Eye' },
    { number: 4, label: 'Import', icon: 'Download' }
  ];

  const handleFileUploaded = (data, headers) => {
    setCsvData(data);
    setCsvHeaders(headers);
    setCurrentStep(2);
  };

  const handleMappingComplete = (mapping) => {
    setFieldMapping(mapping);
    setCurrentStep(3);
  };

  const handleValidationComplete = (results) => {
    setValidationResults(results);
    setCurrentStep(4);
  };

  const handleImportComplete = (errors) => {
    setImportErrors(errors);
    setImportComplete(true);
  };

  const handleBackToInventory = () => {
    navigate('/inventory');
  };

  const handleStartOver = () => {
    setCsvData(null);
    setCsvHeaders([]);
    setFieldMapping({});
    setValidationResults([]);
    setImportProgress(0);
    setImportComplete(false);
    setImportErrors([]);
    setCurrentStep(1);
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBackToInventory}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Import CSV</h1>
            <p className="text-base text-muted-foreground">Bulk import inventory items from CSV file</p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between">
            {steps?.map((step, index) => (
              <React.Fragment key={step?.number}>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-smooth ${
                      currentStep >= step?.number
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {currentStep > step?.number ? (
                      <Icon name="Check" size={20} />
                    ) : (
                      <Icon name={step?.icon} size={20} />
                    )}
                  </div>
                  <div className="hidden md:block">
                    <p className="text-sm font-medium text-foreground">{step?.label}</p>
                    <p className="text-xs text-muted-foreground">Step {step?.number}</p>
                  </div>
                </div>
                {index < steps?.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-4 rounded-full transition-smooth ${
                      currentStep > step?.number ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          {currentStep === 1 && (
            <UploadStep onFileUploaded={handleFileUploaded} />
          )}
          {currentStep === 2 && (
            <FieldMappingStep
              csvHeaders={csvHeaders}
              csvData={csvData}
              onMappingComplete={handleMappingComplete}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && (
            <PreviewStep
              csvData={csvData}
              fieldMapping={fieldMapping}
              onValidationComplete={handleValidationComplete}
              onBack={() => setCurrentStep(2)}
            />
          )}
          {currentStep === 4 && (
            <ImportProgressStep
              csvData={csvData}
              fieldMapping={fieldMapping}
              validationResults={validationResults}
              onImportComplete={handleImportComplete}
              onStartOver={handleStartOver}
              onBackToInventory={handleBackToInventory}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default CSVImportInterface;