import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import '../pantry.css';

export default function ServicePlaceholder() {
  const { type } = useParams();
  const name = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Service';

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title={name}
          subtitle="This preset is coming in a future sprint."
          backTo="/pantry/standby"
        />
      </div>
    </>
  );
}
