import React from 'react';
import SectionCard, { PlaceholderNote } from './_SectionCard';

export default function SectionHeader({ trip }) {
  const name = trip?.name || 'this';
  return (
    <SectionCard
      accent="navy"
      lead="The "
      italic={`${name} charter.`}
    >
      <PlaceholderNote>Trip header content coming in a later phase.</PlaceholderNote>
    </SectionCard>
  );
}
