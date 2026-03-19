import React from 'react';
import MarketingNav from './components/MarketingNav';
import MarketingFooter from './components/MarketingFooter';
import './marketing.css';

const MarketingLayout = ({ children }) => {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E3A5F] mkt-dmsans">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
};

export default MarketingLayout;
