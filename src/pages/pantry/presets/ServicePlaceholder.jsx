import React from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import { EditorialPageShell } from '../../../components/editorial';
import '../pantry.css';

export default function ServicePlaceholder() {
  const { type } = useParams();
  const name = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Service';

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <EditorialPageShell
          title={name}
          subtitle="This preset is coming in a future sprint."
          backTo="/pantry/standby"
        />
      </div>
    </>
  );
}
