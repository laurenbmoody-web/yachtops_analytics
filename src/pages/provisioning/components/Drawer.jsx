import React, { useEffect } from 'react';
import Icon from '../../../components/AppIcon';

const Drawer = ({ open, onClose, title, children, footer, width = 'max-w-[480px]', theme = 'dark' }) => {
  const isLight = theme === 'light';

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'} ${isLight ? 'bg-black/20' : 'bg-black/50'}`}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full ${width} w-full z-50 transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div
          className="h-full flex flex-col shadow-2xl"
          style={isLight ? { background: '#ffffff', borderLeft: '1px solid #E2E8F0' } : { background: 'var(--card)', borderLeft: '1px solid var(--border)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4"
            style={isLight ? { background: '#ffffff', borderBottom: '1px solid #E2E8F0' } : { borderBottom: '1px solid var(--border)' }}
          >
            <h2
              className="text-base font-semibold truncate"
              style={isLight ? { color: '#1E3A5F' } : { color: 'var(--foreground)' }}
            >{title}</h2>
            <button
              onClick={onClose}
              className={isLight ? 'p-1.5 rounded-lg transition-colors' : 'p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'}
              style={isLight ? { color: '#94A3B8' } : undefined}
              onMouseEnter={isLight ? e => e.currentTarget.style.color = '#1E3A5F' : undefined}
              onMouseLeave={isLight ? e => e.currentTarget.style.color = '#94A3B8' : undefined}
            >
              <Icon name="X" className="w-5 h-5" />
            </button>
          </div>
          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
          {/* Footer (optional) */}
          {footer && (
            <div
              className="flex-shrink-0"
              style={isLight
                ? { borderTop: '1px solid #E2E8F0', background: '#ffffff' }
                : { borderTop: '1px solid var(--border)', background: 'var(--card)' }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Drawer;
