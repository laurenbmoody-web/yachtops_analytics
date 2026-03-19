import React from 'react';
import MarketingNav from './components/MarketingNav';
import MarketingFooter from './components/MarketingFooter';

const MarketingLayout = ({ children }) => {
  return (
    <div className="min-h-screen bg-[#0B1220] text-white font-body">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
};

export default MarketingLayout;
