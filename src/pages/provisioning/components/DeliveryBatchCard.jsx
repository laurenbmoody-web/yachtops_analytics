import React from 'react';

// ── DeliveryBatchCard ──────────────────────────────────────────────────────
// Option B from the mockup: shared header + page-specific body. Used by:
//   - DeliveryHistory's LedgerEntry (standalone Delivered page)
//   - ProvisioningBoardDetail's renderBatchBlock (in-board Deliveries tab)
//
// What's shared (this component):
//   - Outer card chrome (white bg, rounded corners, bottom accent edge)
//   - Header row (chevron · serif supplier name · source pill · meta line ·
//     right-side action slot)
//   - Typography (supplier name in Georgia serif matching OrderCard, meta
//     line in Plus Jakarta Sans uppercase letterspaced)
//
// What's page-specific (children slot):
//   - DH: items detail table (revealed on expand)
//   - Board: dense items grid + payment status per row
//
// Props:
//   supplierName       — string. Card title in Georgia serif.
//   sourceLabel        — string. Source pill copy (Delivery / Manual / etc).
//   sourceChipBg       — string. Source pill background hex.
//   sourceChipFg       — string. Source pill foreground hex.
//   accentBorder       — string. Bottom-edge accent colour (signals source type).
//   metaParts          — array of strings. Joined with · in the meta line.
//   rightSlot          — ReactNode. Right-aligned action (Upload invoice button)
//                        or summary (item count + total). Card lays it out;
//                        caller owns the content.
//   chevron            — bool | null. Show chevron at left. null = hidden.
//                        true = expanded (ChevronDown), false = collapsed
//                        (ChevronRight). DH uses it; board sets null.
//   onClick            — optional. Header band click handler (DH uses it for
//                        expand toggle).
//   children           — body content rendered below header with hairline
//                        separator. Optional — if omitted, only the header
//                        renders (no body section).

export default function DeliveryBatchCard({
  supplierName,
  sourceLabel,
  sourceChipBg = 'rgba(30,158,117,0.12)',
  sourceChipFg = '#0F6E56',
  accentBorder = '#1D9E75',
  metaParts = [],
  rightSlot = null,
  chevron = null,
  onClick = null,
  children = null,
}) {
  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    cursor: onClick ? 'pointer' : 'default',
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid rgba(30, 39, 66, 0.06)',
        borderRadius: 12,
        borderBottom: `5px solid ${accentBorder}`,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      <div style={headerStyle} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
        {/* Optional chevron — DH uses it, board doesn't. */}
        {chevron !== null && (
          <span
            aria-hidden="true"
            style={{
              fontSize: 18,
              color: 'rgba(30, 39, 66, 0.35)',
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {chevron ? '▾' : '›'}
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Supplier name — Georgia serif. Matches .cargo-order-card-supplier
              so both card families share the same typographic moment. */}
          <h3
            style={{
              fontFamily: "Georgia, 'DM Serif Text', 'Times New Roman', serif",
              fontSize: 18,
              fontWeight: 500,
              color: '#1E2742',
              letterSpacing: '-0.005em',
              lineHeight: 1.2,
              margin: '0 0 4px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {supplierName}
            {sourceLabel && (
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: sourceChipBg,
                  color: sourceChipFg,
                }}
              >
                {sourceLabel}
              </span>
            )}
          </h3>

          {/* Meta line — Plus Jakarta Sans uppercase letterspaced. Same
              typography as the OrderCard meta row. */}
          {metaParts.length > 0 && (
            <p
              style={{
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'rgba(30, 39, 66, 0.55)',
                margin: 0,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {metaParts.map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 1,
                        height: 10,
                        background: 'rgba(30, 39, 66, 0.18)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span>{part}</span>
                </React.Fragment>
              ))}
            </p>
          )}
        </div>

        {rightSlot && (
          <div style={{ flexShrink: 0, marginLeft: 'auto' }}>
            {rightSlot}
          </div>
        )}
      </div>

      {/* Body slot — page-specific content. Hairline separator above. */}
      {children && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '12px 18px 16px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
