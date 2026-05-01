import React, { useEffect } from 'react';
import Icon from '../../../components/AppIcon';

// Sprint 9c.1a follow-up: this file had two layered bugs.
//
//   1. Three Tailwind arbitrary-value classes (max-w-[480px], bg-black/50,
//      bg-black/20) never survived Tailwind's content-scan purge — the
//      compiled CSS had zero matches. Panel rendered at full viewport
//      width, backdrop was transparent. Fixed in the previous commit by
//      moving them to inline styles.
//
//   2. The dark-theme branch referenced var(--card), var(--border),
//      var(--foreground) — but the codebase only defines --color-card,
//      --color-border, --color-foreground (Tailwind config aliases the
//      bare names but the bare CSS vars themselves don't exist at :root).
//      Result: panel surface was transparent because var(--card) resolved
//      to nothing, the title was unstyled-text, and the footer had no bg.
//      Light theme used concrete hex values and worked, which masked the
//      issue for ItemDrawer (which always passes theme="light"). The
//      kanban BoardDrawer doesn't pass a theme so it got the broken dark
//      branch.
//
// Both branches now use concrete editorial-language values:
//   - White card surface (#FFFFFF)
//   - Hairline navy-tinted border (rgba(30, 39, 66, 0.06))
//   - Deep navy title text (#1E2742)
//   - Slate close-button with navy hover
//
// `theme` prop kept on the signature for back-compat but is now visually
// equivalent across both values. Future restyles (e.g. a true dark drawer)
// can branch on it again with intentional concrete values.
const PANEL_BG_DEFAULT = '#FFFFFF';
const HAIRLINE     = '1px solid rgba(30, 39, 66, 0.06)';
const TITLE_INK    = '#1E2742';
const CLOSE_INK    = '#94A3B8';
const CLOSE_HOVER  = '#1E2742';

const Drawer = ({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  theme = 'dark',
  // Sprint 9c.2 Commit 1.5c (drawer redesign):
  //   - panelBg: override the default white panel surface (e.g. #FFFEFB
  //     for the editorial paper feel — slightly warmer than the page bg).
  //   - hideHeader: skip the built-in title bar so the drawer body
  //     extends to the top edge. Consumer renders its own close button
  //     inside the body (typical for editorial hero layouts).
  panelBg = PANEL_BG_DEFAULT,
  hideHeader = false,
  // Optional content padding override — defaults to px-6 py-5 (Tailwind).
  // When the consumer wants edge-to-edge content (e.g. hero section
  // bleeding to drawer edges), pass null to drop padding entirely.
  bodyClassName = 'flex-1 overflow-y-auto px-6 py-5',
}) => {
  const isLight = theme === 'light';
  const maxWidth = typeof width === 'number' ? `${width}px` : width;
  const backdropBg = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.5)';

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ background: backdropBg }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full z-50 transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ maxWidth }}
      >
        <div
          className="h-full flex flex-col shadow-2xl"
          style={{ background: panelBg, borderLeft: HAIRLINE }}
        >
          {/* Header (optional) */}
          {!hideHeader && (
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ background: panelBg, borderBottom: HAIRLINE }}
            >
              <h2
                className="text-base font-semibold truncate"
                style={{ color: TITLE_INK }}
              >{title}</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: CLOSE_INK }}
                onMouseEnter={(e) => { e.currentTarget.style.color = CLOSE_HOVER; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = CLOSE_INK; }}
              >
                <Icon name="X" className="w-5 h-5" />
              </button>
            </div>
          )}
          {/* Body */}
          <div className={bodyClassName}>
            {children}
          </div>
          {/* Footer (optional) */}
          {footer && (
            <div
              className="flex-shrink-0"
              style={{ borderTop: HAIRLINE, background: panelBg }}
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
