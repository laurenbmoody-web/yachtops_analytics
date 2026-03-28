import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';

const ProvisioningBoardDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <>
      <Header />
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <button
            onClick={() => navigate('/provisioning')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <Icon name="ArrowLeft" className="w-4 h-4" />
            Back to boards
          </button>
          <div className="bg-card border border-border rounded-xl p-10 text-center shadow-sm">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="LayoutDashboard" className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-2">Board Detail View</h1>
            <p className="text-muted-foreground text-sm mb-1">Full detail view coming soon</p>
            <p className="text-xs text-muted-foreground/60 font-mono">Board ID: {id}</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProvisioningBoardDetail;
