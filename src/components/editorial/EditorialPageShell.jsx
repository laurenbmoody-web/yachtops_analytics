import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import EditorialMetaStrip from './EditorialMetaStrip';
import EditorialHeadline from './EditorialHeadline';
import NowAndDutyStack from '../../pages/pantry/widgets/NowAndDutyStack';

/**
 * EditorialPageShell — header block for the editorial page language.
 *
 * Renders the canonical Pantry/Cargo editorial header pattern:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  ◇ LOCATION · DAY · DATE · …                [right rail]
 *   │                                              [optional]
 *   │  HEADLINE, *qualifier*.                              │
 *   │  Muted subtitle line.                                │
 *   │                                                       │
 *   │  [optional action strip]                              │
 *   │                                                       │
 *   │  {children — page content}                            │
 *   └────────────────────────────────────────────────────────┘
 *
 * The shell itself is presentational — it does NOT render the page
 * wrapper or `<Header />`. Consumers continue to render those:
 *
 *     <Header />
 *     <div id="pantry-root" className="pantry-page">
 *       <EditorialPageShell ...>
 *         {pageContent}
 *       </EditorialPageShell>
 *     </div>
 *
 * For non-Pantry consumers (e.g. Provisioning), use the `.editorial-page`
 * class on the wrapper instead — same tokens, same styles, no Pantry-
 * scoped scoping. See pantry.css token block for the shared selectors.
 *
 * Body background: the shell sets `document.body.style.background` to
 * the editorial cream (`#F5F1EA`) on mount and restores it on unmount.
 * This extends the cream past the inner content to the viewport edges.
 * Pass `manageBodyBg={false}` to opt out (e.g. when nesting under a
 * different page that already manages it). Pass `bodyBg='#XXXXXX'` to
 * lift the body to a different ground — e.g. cool dashboard surfaces
 * (`#F8FAFC` / `var(--d-bg)`) for provisioning consumers.
 */

const EDITORIAL_BG_WARM = '#F5F1EA';

export default function EditorialPageShell({
  // Headline pattern
  title = null,
  qualifier = 'Interior',
  subtitle = null,

  // Meta strip — undefined = default Pantry weather strip; null = hidden;
  // array = custom segments (see EditorialMetaStrip docs).
  meta,
  metaLocation,                     // override default location for default meta mode

  // Optional back link
  backTo = null,
  backLabel = 'Back to Standby',

  // Right rail — undefined = NowAndDutyStack when showDuty=true; null = none;
  // JSX = custom right-rail content.
  rightRail,
  showDuty = true,                  // legacy alias used only when rightRail is undefined

  // Optional action strip slot — sits below the headline, full width
  actionStrip = null,

  // Optional extra content inside the left column, below the headline but
  // ABOVE the action strip. Use for content that should "belong" to the
  // identity block (chips, status pills) so the right-rail's vertical
  // bottom alignment lines up with these extras instead of with the bare
  // headline — closes the empty void between a short title and a tall
  // right rail. First consumer: Provisioning board detail's chip row.
  headerExtra = null,

  // Body bg lift
  manageBodyBg = true,
  bodyBg = EDITORIAL_BG_WARM,

  // Page content
  children,
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!manageBodyBg) return;
    const prev = document.body.style.background;
    document.body.style.background = bodyBg;
    return () => { document.body.style.background = prev; };
  }, [manageBodyBg, bodyBg]);

  const resolvedRightRail =
    rightRail !== undefined
      ? rightRail
      : (showDuty ? <NowAndDutyStack /> : null);

  return (
    <>
      <div className="p-header-row">
        <div style={{ flex: 1 }}>
          {backTo && (
            <button
              className="p-back-link"
              onClick={() => navigate(backTo)}
              aria-label={backLabel}
            >
              {backLabel}
            </button>
          )}
          <EditorialMetaStrip meta={meta} location={metaLocation || 'PALMA DE MALLORCA'} />
          <EditorialHeadline
            title={title}
            qualifier={qualifier}
            subtitle={subtitle}
          />
          {headerExtra}
        </div>
        {resolvedRightRail}
      </div>

      {actionStrip}

      {children}
    </>
  );
}
