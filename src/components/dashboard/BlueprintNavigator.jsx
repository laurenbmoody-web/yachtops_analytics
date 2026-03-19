import React, { useState } from 'react';
import Icon from '../AppIcon';

const BlueprintNavigator = ({ heroImageUrl, useCustomHero }) => {
  const [imageError, setImageError] = useState(false);

  const handleImageError = () => {
    setImageError(true);
  };

  // Determine which image to show
  const shouldShowCustom = useCustomHero && heroImageUrl && !imageError;
  const imageSrc = shouldShowCustom 
    ? heroImageUrl 
    : '/assets/images/yacht_blueprint-1770460015354.png';

  return (
    <div 
      style={{
        display: 'inline-block',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
        borderRadius: '16px',
        background: 'transparent',
        width: '100%'
      }}
    >
      {!imageError || shouldShowCustom ? (
        <img
          src={imageSrc}
          alt={shouldShowCustom ? 'Custom vessel hero' : 'Yacht blueprint'}
          onError={handleImageError}
          style={{
            display: 'block',
            width: shouldShowCustom ? '100%' : 'auto',
            height: shouldShowCustom ? '100%' : 'auto',
            maxWidth: '100%',
            objectFit: shouldShowCustom ? 'cover' : 'unset'
          }}
        />
      ) : (
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px',
            background: 'var(--color-card)'
          }}
        >
          <div style={{ textAlign: 'center', color: 'var(--color-muted-foreground)' }}>
            <Icon name="Image" size={48} color="var(--color-muted-foreground)" style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '14px', margin: 0 }}>Blueprint preview unavailable</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlueprintNavigator;