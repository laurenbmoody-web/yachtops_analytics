import { jsPDF } from 'jspdf';
import { getComplianceStatus, getMonthCalendarData, detectBreaches, getCrewWorkEntries, BREACH_TYPES, BREACH_DISPLAY_INFO } from './horStorage';
import { getBreachNotesForMonth } from './horBreachNotesStorage';

// Human-readable labels for enforced breach types (for PDF display)
const ENFORCED_BREACH_LABELS = {
  [BREACH_TYPES?.REST_LT_10_IN_24H]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_10_IN_24H]?.displayName + ` (${BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_10_IN_24H]?.code})`,
  [BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]?.displayName + ` (${BREACH_DISPLAY_INFO?.[BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]?.code})`,
  [BREACH_TYPES?.REST_LT_77_IN_7D]: BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_77_IN_7D]?.displayName + ` (${BREACH_DISPLAY_INFO?.[BREACH_TYPES?.REST_LT_77_IN_7D]?.code})`
};

// Filter only enforced breach types
const ENFORCED_BREACH_TYPES = [
  BREACH_TYPES?.REST_LT_10_IN_24H,
  BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H,
  BREACH_TYPES?.REST_LT_77_IN_7D
];

export const generateHORAuditPDF = async ({ crew, month, includeAuditTrail }) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc?.internal?.pageSize?.getWidth();
  const pageHeight = doc?.internal?.pageSize?.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  let yPosition = margin;

  // Get HOR data
  const year = month?.getFullYear();
  const monthIndex = month?.getMonth();
  const complianceStatus = getComplianceStatus(crew?.id);
  const calendarData = getMonthCalendarData(crew?.id, year, monthIndex);
  const breaches = detectBreaches(crew?.id);
  const entries = getCrewWorkEntries(crew?.id);
  const breachNotes = getBreachNotesForMonth(crew?.id, year, monthIndex);

  // Filter entries for this month
  const monthEntries = entries?.filter(entry => {
    const entryDate = new Date(entry?.date);
    return entryDate?.getMonth() === monthIndex && entryDate?.getFullYear() === year;
  });

  const monthName = month?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // === HEADER ===
  doc?.setFontSize(16);
  doc?.setFont('helvetica', 'bold');
  doc?.text('Hours of Rest Audit Report', margin, yPosition);
  
  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  doc?.text(`Generated: ${new Date()?.toLocaleString('en-GB')} | Timezone: UTC`, pageWidth - margin, yPosition, { align: 'right' });
  yPosition += 8;

  // === CREW INFO & SUMMARY (Side by side) ===
  const leftColX = margin;
  const rightColX = margin + (contentWidth / 2);
  const startY = yPosition;

  // Left: Crew Info
  doc?.setFontSize(10);
  doc?.setFont('helvetica', 'bold');
  doc?.text('Crew Member', leftColX, yPosition);
  yPosition += 5;
  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  doc?.text(`Name: ${crew?.fullName}`, leftColX, yPosition);
  yPosition += 4;
  doc?.text(`Role: ${crew?.roleTitle}`, leftColX, yPosition);
  yPosition += 4;
  doc?.text(`Department: ${crew?.department}`, leftColX, yPosition);
  yPosition += 4;
  doc?.text(`Month: ${monthName}`, leftColX, yPosition);

  // Right: Summary
  yPosition = startY;
  doc?.setFontSize(10);
  doc?.setFont('helvetica', 'bold');
  doc?.text('Compliance Summary', rightColX, yPosition);
  yPosition += 5;
  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  doc?.text(`Last 24h Rest: ${complianceStatus?.last24HoursRest}h | Last 7d Rest: ${complianceStatus?.last7DaysRest}h`, rightColX, yPosition);
  yPosition += 4;
  doc?.text(`Status: ${complianceStatus?.isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'} | Days Logged: ${monthEntries?.length}`, rightColX, yPosition);
  yPosition += 4;
  
  if (breaches?.length > 0) {
    doc?.setTextColor(200, 0, 0);
    doc?.text(`Breaches: ${breaches?.length}`, rightColX, yPosition);
    doc?.setTextColor(0, 0, 0);
  } else {
    doc?.setTextColor(0, 150, 0);
    doc?.text('No Breaches', rightColX, yPosition);
    doc?.setTextColor(0, 0, 0);
  }

  yPosition = Math.max(startY + 20, yPosition + 6);

  // === DAILY BREAKDOWN TABLE WITH 48 INCREMENTS ===
  // Table configuration
  const daysInMonth = calendarData?.length;
  const cellWidth = 5.5; // Width for each 30-min increment cell
  const cellHeight = 4; // Height for each day row
  const rowLabelWidth = 8; // Width for day number column
  const tableStartX = margin;
  const tableStartY = yPosition;

  // Draw column headers (hour increments)
  doc?.setFontSize(5);
  doc?.setFont('helvetica', 'normal');
  
  // Draw hour labels (00:00, 01:00, 02:00, ... 23:00)
  for (let hour = 0; hour < 24; hour++) {
    const x = tableStartX + rowLabelWidth + (hour * 2 * cellWidth) + cellWidth; // Center of 2 cells (1 hour)
    const hourLabel = String(hour)?.padStart(2, '0') + ':00';
    doc?.text(hourLabel, x, tableStartY, { align: 'center' });
  }

  yPosition = tableStartY + 3;

  // Draw table rows for each day
  calendarData?.forEach((dayData, dayIndex) => {
    const dayNum = dayData?.day;
    const rowY = yPosition + (dayIndex * cellHeight);

    // Draw day number (row label on left)
    doc?.setFontSize(7);
    doc?.setFont('helvetica', 'normal');
    doc?.text(String(dayNum), tableStartX + rowLabelWidth / 2, rowY + cellHeight / 2 + 1, { align: 'center' });

    // Get actual work entries for this specific day
    const dateStr = `${year}-${String(monthIndex + 1)?.padStart(2, '0')}-${String(dayNum)?.padStart(2, '0')}`;
    const dayEntries = monthEntries?.filter(entry => entry?.date === dateStr);
    
    // Build set of worked segments for this day
    const workedSegments = new Set();
    dayEntries?.forEach(entry => {
      entry?.workSegments?.forEach(segmentIndex => {
        workedSegments?.add(segmentIndex);
      });
    });

    // Draw 48 increment cells (30-minute intervals)
    for (let increment = 0; increment < 48; increment++) {
      let cellX = tableStartX + rowLabelWidth + (increment * cellWidth);
      const cellY = rowY;

      // Check if this specific increment was worked based on actual data
      const isWorkPeriod = workedSegments?.has(increment);

      if (isWorkPeriod) {
        // Work period - shaded
        doc?.setFillColor(100, 100, 100);
        doc?.rect(cellX, cellY, cellWidth, cellHeight, 'F');
      } else {
        // Rest period - clear/white
        doc?.setFillColor(255, 255, 255);
        doc?.rect(cellX, cellY, cellWidth, cellHeight, 'F');
      }

      // Draw cell border
      doc?.setDrawColor(180, 180, 180);
      doc?.setLineWidth(0.1);
      doc?.rect(cellX, cellY, cellWidth, cellHeight, 'S');
    }

    // Draw outer border for row
    doc?.setDrawColor(0, 0, 0);
    doc?.setLineWidth(0.3);
    doc?.rect(tableStartX, rowY, rowLabelWidth, cellHeight, 'S');
  });

  // Draw outer border for entire table
  doc?.setDrawColor(0, 0, 0);
  doc?.setLineWidth(0.4);
  const tableWidth = rowLabelWidth + (48 * cellWidth);
  const tableHeight = daysInMonth * cellHeight;
  doc?.rect(tableStartX, yPosition, tableWidth, tableHeight, 'S');

  yPosition += tableHeight + 6;

  // Legend
  doc?.setFontSize(7);
  doc?.setFont('helvetica', 'normal');
  const legendX = margin;
  doc?.text('Legend:', legendX, yPosition);
  
  // Shaded box
  doc?.setFillColor(100, 100, 100);
  doc?.rect(legendX + 12, yPosition - 2.5, 4, 3, 'F');
  doc?.text('Work Hours', legendX + 17, yPosition);
  
  // Clear box
  doc?.setFillColor(255, 255, 255);
  doc?.setDrawColor(150, 150, 150);
  doc?.rect(legendX + 35, yPosition - 2.5, 4, 3, 'FD');
  doc?.text('Rest Hours', legendX + 40, yPosition);
  
  doc?.text('(Each cell = 30 minutes)', legendX + 55, yPosition);

  yPosition += 8;

  // === BREACHES SECTION (Page 2 if breaches exist) ===
  // Filter breach episodes to only enforced types and within selected month
  const allBreachEpisodes = detectBreaches(crew?.id);
  const monthBreachEpisodes = allBreachEpisodes?.filter(episode => {
    // Only include enforced breach types
    if (!ENFORCED_BREACH_TYPES?.includes(episode?.breachType)) {
      return false;
    }
    
    // Check if any affected ship date is within the selected month
    return episode?.affectedShipDates?.some(dateStr => {
      const dateObj = new Date(dateStr);
      return dateObj?.getFullYear() === year && dateObj?.getMonth() === monthIndex;
    });
  });

  if (monthBreachEpisodes?.length > 0) {
    // Add Page 2
    doc?.addPage();
    yPosition = 15; // 15mm top margin

    // === HEADER (TOP) ===
    doc?.setFontSize(16);
    doc?.setFont('helvetica', 'bold');
    doc?.text('Hours of Rest — Breach Summary', margin, yPosition);
    yPosition += 8;

    // Subtitle (single line)
    doc?.setFontSize(9);
    doc?.setFont('helvetica', 'normal');
    const timezone = 'Ship Time (UTC±0)'; // Default, can be made dynamic
    const subtitleText = `${monthName} · ${crew?.fullName} · ${crew?.roleTitle} · ${crew?.vessel || 'Vessel'} · ${timezone}`;
    doc?.text(subtitleText, margin, yPosition);
    yPosition += 10;

    // === MONTH SUMMARY (COMPACT BOX) ===
    const daysInMonth = new Date(year, monthIndex + 1, 0)?.getDate();
    const daysLogged = monthEntries?.length;
    const isMonthComplete = daysLogged >= daysInMonth;
    const monthConfirmation = getMonthConfirmation(crew?.id, year, monthIndex);
    const isMonthLocked = monthConfirmation?.locked || false;

    // Calculate unique breach days and types
    const breachDatesSet = new Set();
    const breachTypesSet = new Set();
    monthBreachEpisodes?.forEach(episode => {
      episode?.affectedShipDates?.forEach(dateStr => {
        const dateObj = new Date(dateStr);
        if (dateObj?.getFullYear() === year && dateObj?.getMonth() === monthIndex) {
          breachDatesSet?.add(dateStr);
        }
      });
      breachTypesSet?.add(episode?.breachType);
    });

    const totalBreachDays = breachDatesSet?.size;

    // Human-readable breach type labels (no codes)
    const breachTypeLabels = Array.from(breachTypesSet)?.map(type => {
      const displayInfo = BREACH_DISPLAY_INFO?.[type];
      return displayInfo?.displayName || type;
    })?.join(', ');

    // Draw summary box
    doc?.setDrawColor(180, 180, 180);
    doc?.setLineWidth(0.3);
    doc?.rect(margin, yPosition, contentWidth, 22, 'S');

    const boxPadding = 3;
    let boxY = yPosition + boxPadding + 3;

    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    
    // Line 1: Month progress
    doc?.text(`Month progress: Days logged ${daysLogged} / ${daysInMonth}`, margin + boxPadding, boxY);
    boxY += 4.5;

    // Line 2: Compliance status
    let statusText = '';
    if (!isMonthComplete || !isMonthLocked) {
      statusText = 'Compliance status: Provisional (month in progress)';
    } else {
      statusText = 'Compliance status: Final';
    }
    doc?.text(statusText, margin + boxPadding, boxY);
    boxY += 4.5;

    // Line 3: Breach days identified
    doc?.text(`Breach days identified: ${totalBreachDays}`, margin + boxPadding, boxY);
    boxY += 4.5;

    // Line 4: Breach types (human-readable only)
    const breachTypesLine = `Breach types: ${breachTypeLabels}`;
    const breachTypesWrapped = doc?.splitTextToSize(breachTypesLine, contentWidth - (boxPadding * 2));
    breachTypesWrapped?.forEach(line => {
      doc?.text(line, margin + boxPadding, boxY);
      boxY += 4.5;
    });

    yPosition += 24;

    // Add vertical spacing before Breach Details section (changed from 20mm to 10mm)
    yPosition += 10;

    // === BREACH DETAILS (REPLACE TABLE WITH COMPACT ROW TABLE) ===
    doc?.setFontSize(11);
    doc?.setFont('helvetica', 'bold');
    doc?.text('Breach Details', margin, yPosition);
    yPosition += 6;

    // Group episodes by date and sort
    const breachesByDate = new Map();
    monthBreachEpisodes?.forEach(episode => {
      episode?.affectedShipDates?.forEach(dateStr => {
        const dateObj = new Date(dateStr);
        if (dateObj?.getFullYear() === year && dateObj?.getMonth() === monthIndex) {
          if (!breachesByDate?.has(dateStr)) {
            breachesByDate?.set(dateStr, []);
          }
          breachesByDate?.get(dateStr)?.push(episode);
        }
      });
    });

    const sortedDates = Array.from(breachesByDate?.keys())?.sort();

    // Define table column widths (fixed to prevent wrapping)
    const colWidths = {
      date: 22,
      breachType: 50,
      evidence: 50,
      window: 70,
      note: contentWidth - 22 - 50 - 50 - 70 - 5 // Remaining space
    };

    const tableStartY = yPosition;
    const rowHeight = 8; // Base row height
    let currentY = tableStartY;

    // Draw table header
    doc?.setFillColor(240, 240, 240);
    doc?.rect(margin, currentY, contentWidth, rowHeight, 'F');
    doc?.setDrawColor(180, 180, 180);
    doc?.setLineWidth(0.3);
    doc?.rect(margin, currentY, contentWidth, rowHeight, 'S');

    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'bold');
    let colX = margin + 2;
    
    doc?.text('Date', colX, currentY + 5);
    colX += colWidths?.date;
    doc?.text('Breach Type', colX, currentY + 5);
    colX += colWidths?.breachType;
    doc?.text('Evidence', colX, currentY + 5);
    colX += colWidths?.evidence;
    doc?.text('Assessment Window', colX, currentY + 5);
    colX += colWidths?.window;
    doc?.text('Note / Reason', colX, currentY + 5);

    currentY += rowHeight;

    // Track row count for pagination
    let rowCount = 0;
    const maxRowsPerPage = 20; // Adjust based on page size

    // Render table rows
    sortedDates?.forEach((dateStr, dateIndex) => {
      const dateEpisodes = breachesByDate?.get(dateStr);
      const dateObj = new Date(dateStr);

      // Get breach note for this date
      const breachNote = breachNotes?.find(note => note?.date === dateStr);
      const noteText = breachNote?.noteText || null;

      dateEpisodes?.forEach((episode, episodeIdx) => {
        // Check if we need a new page
        if (rowCount >= maxRowsPerPage || currentY > pageHeight - 30) {
          doc?.addPage();
          currentY = 15;
          rowCount = 0;

          // Repeat header on new page
          doc?.setFillColor(240, 240, 240);
          doc?.rect(margin, currentY, contentWidth, rowHeight, 'F');
          doc?.setDrawColor(180, 180, 180);
          doc?.setLineWidth(0.3);
          doc?.rect(margin, currentY, contentWidth, rowHeight, 'S');

          doc?.setFontSize(8);
          doc?.setFont('helvetica', 'bold');
          let headerX = margin + 2;
          
          doc?.text('Date', headerX, currentY + 5);
          headerX += colWidths?.date;
          doc?.text('Breach Type', headerX, currentY + 5);
          headerX += colWidths?.breachType;
          doc?.text('Evidence', headerX, currentY + 5);
          headerX += colWidths?.evidence;
          doc?.text('Assessment Window', headerX, currentY + 5);
          headerX += colWidths?.window;
          doc?.text('Note / Reason', headerX, currentY + 5);

          currentY += rowHeight;
        }

        // Alternate row shading
        if (rowCount % 2 === 0) {
          doc?.setFillColor(250, 250, 250);
          doc?.rect(margin, currentY, contentWidth, rowHeight, 'F');
        }

        // Draw row border
        doc?.setDrawColor(220, 220, 220);
        doc?.setLineWidth(0.2);
        doc?.rect(margin, currentY, contentWidth, rowHeight, 'S');

        doc?.setFontSize(7);
        doc?.setFont('helvetica', 'normal');
        let cellX = margin + 2;
        const cellY = currentY + 5;

        // Column 1: Date (DD/MM/YY format)
        const dateDisplay = dateObj?.toLocaleDateString('en-GB', { 
          day: '2-digit', 
          month: '2-digit', 
          year: '2-digit' 
        });
        doc?.text(dateDisplay, cellX, cellY);
        cellX += colWidths?.date;

        // Column 2: Breach Type (human-readable only, no codes)
        const displayInfo = BREACH_DISPLAY_INFO?.[episode?.breachType];
        let humanTitle = displayInfo?.displayName || episode?.breachType;
        
        // Map to compact human-readable text
        if (episode?.breachType === BREACH_TYPES?.REST_LT_10_IN_24H) {
          humanTitle = '< 10 hours rest in 24 hours';
        } else if (episode?.breachType === BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H) {
          humanTitle = 'No continuous 6-hour rest';
        } else if (episode?.breachType === BREACH_TYPES?.REST_LT_77_IN_7D) {
          humanTitle = '< 77 hours rest in 7 days';
        }
        
        // Truncate if too long
        const breachTypeText = doc?.splitTextToSize(humanTitle, colWidths?.breachType - 2);
        doc?.text(breachTypeText?.[0] || humanTitle, cellX, cellY);
        cellX += colWidths?.breachType;

        // Column 3: Evidence (short)
        let evidenceText = '';
        if (episode?.breachType === BREACH_TYPES?.REST_LT_10_IN_24H) {
          evidenceText = `Rest: ${episode?.worstValue?.toFixed(1)}h (min 10h)`;
        } else if (episode?.breachType === BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H) {
          evidenceText = `Longest rest: ${episode?.worstValue?.toFixed(1)}h (min 6h)`;
        } else if (episode?.breachType === BREACH_TYPES?.REST_LT_77_IN_7D) {
          evidenceText = `7-day rest: ${episode?.worstValue?.toFixed(1)}h (min 77h)`;
        }
        const evidenceWrapped = doc?.splitTextToSize(evidenceText, colWidths?.evidence - 2);
        doc?.text(evidenceWrapped?.[0] || evidenceText, cellX, cellY);
        cellX += colWidths?.evidence;

        // Column 4: Assessment Window (DD/MM/YY HH:MM - DD/MM/YY HH:MM format)
        // Parse episodeStartDisplay and episodeEndDisplay to required format
        let windowText = '';
        if (episode?.episodeStartDisplay && episode?.episodeEndDisplay) {
          // episodeStartDisplay format from toLocaleDateString: "13 Jan 2026 at 00:30" or "13 Jan 2026, 00:30"
          // Target format: "13/01/26 00:30 - 14/01/26 00:30"
          
          const parseDisplayDate = (displayStr) => {
            try {
              // Handle format: "13 Jan 2026 at 00:30" or "13 Jan 2026, 00:30"
              // Remove comma and 'at' keyword, normalize spaces
              const normalized = displayStr?.trim()?.replace(/,/g, '')?.replace(/\sat\s/g, ' ');
              const parts = normalized?.split(/\s+/); // Split by any whitespace
              
              if (parts?.length >= 4) {
                const day = parts?.[0]?.padStart(2, '0');
                const monthMap = {
                  'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
                  'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
                  'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                };
                const month = monthMap?.[parts?.[1]] || '01';
                const year = parts?.[2]?.slice(-2); // Last 2 digits
                const time = parts?.[3] || '00:00';
                return `${day}/${month}/${year} ${time}`;
              }
              
              // Fallback: try to parse as Date object
              const dateObj = new Date(displayStr);
              if (!isNaN(dateObj?.getTime())) {
                const day = String(dateObj?.getDate())?.padStart(2, '0');
                const month = String(dateObj?.getMonth() + 1)?.padStart(2, '0');
                const year = String(dateObj?.getFullYear())?.slice(-2);
                const hours = String(dateObj?.getHours())?.padStart(2, '0');
                const minutes = String(dateObj?.getMinutes())?.padStart(2, '0');
                return `${day}/${month}/${year} ${hours}:${minutes}`;
              }
            } catch (e) {
              // Fallback: return original
            }
            return displayStr;
          };

          const startFormatted = parseDisplayDate(episode?.episodeStartDisplay);
          const endFormatted = parseDisplayDate(episode?.episodeEndDisplay);
          windowText = `${startFormatted} - ${endFormatted}`;
        } else {
          windowText = 'Window unavailable';
        }
        
        const windowWrapped = doc?.splitTextToSize(windowText, colWidths?.window - 2);
        doc?.text(windowWrapped?.[0] || windowText, cellX, cellY);
        cellX += colWidths?.window;

        // Column 5: Note / Reason (truncate to 60 chars, show "—" if empty)
        let noteDisplay = '—'; // Em dash
        if (noteText) {
          noteDisplay = noteText?.length > 60 ? noteText?.substring(0, 60) + '...' : noteText;
        }
        const noteWrapped = doc?.splitTextToSize(noteDisplay, colWidths?.note - 2);
        doc?.text(noteWrapped?.[0] || noteDisplay, cellX, cellY);

        currentY += rowHeight;
        rowCount++;
      });
    });

    yPosition = currentY + 6;

    // Optional: Codes as footnote only (small text at bottom)
    doc?.setFontSize(6);
    doc?.setFont('helvetica', 'italic');
    doc?.setTextColor(120, 120, 120);
    doc?.text('Breach codes available in system export.', margin, yPosition);
    doc?.setTextColor(0, 0, 0);
    yPosition += 8;

    // === AUDIT TRAIL (BOTTOM, COMPRESSED) ===
    if (includeAuditTrail) {
      const correctionRequests = getCorrectionRequests(crew?.id)?.filter(req => {
        const reqDate = new Date(req?.requestedAt);
        return reqDate?.getFullYear() === year && reqDate?.getMonth() === monthIndex;
      });

      if (yPosition > pageHeight - 35) {
        doc?.addPage();
        yPosition = 15;
      }

      yPosition += 5;
      doc?.setFontSize(10);
      doc?.setFont('helvetica', 'bold');
      doc?.text('Audit Trail', margin, yPosition);
      yPosition += 5;

      doc?.setFontSize(8);
      doc?.setFont('helvetica', 'normal');

      // Crew confirmed month
      if (monthConfirmation?.confirmed) {
        const confirmDate = new Date(monthConfirmation?.confirmedAt)?.toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        doc?.text(`- Crew confirmed month: Yes (${confirmDate})`, margin, yPosition);
      } else {
        doc?.text('- Crew confirmed month: No', margin, yPosition);
      }
      yPosition += 4;

      // Locked by command
      if (isMonthLocked) {
        const lockDate = new Date(monthConfirmation?.lockedAt)?.toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        doc?.text(`- Locked by command: Yes (${lockDate})`, margin, yPosition);
      } else {
        doc?.text('- Locked by command: No', margin, yPosition);
      }
      yPosition += 4;

      // Correction requests
      doc?.text(`- Correction requests issued: ${correctionRequests?.length}`, margin, yPosition);
      yPosition += 6;
    }

    // === FOOTER LINE ===
    const auditId = `AUDIT-${Date.now()}`;
    const generatedTimestamp = new Date()?.toLocaleString('en-GB');
    
    doc?.setFontSize(7);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(100, 100, 100);
    const footerText = `Generated by Cargo · Generated on ${generatedTimestamp} · Audit ID: ${auditId}`;
    doc?.text(footerText, pageWidth / 2, pageHeight - 8, { align: 'center' });
    doc?.setTextColor(0, 0, 0);
    doc?.text('Page 2 of 2', pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  // Add spacing before signature section
  yPosition += 10;

  // === SIGNATURE LINES ===
  // Calculate signature position dynamically based on content, ensuring it doesn't overlap
  // Signature section needs approximately 15mm height (2 lines with labels side by side)
  const signatureHeight = 15;
  const minSpacingBeforeSignature = 10;
  const maxContentY = pageHeight - signatureHeight - margin;
  
  // If content extends too far, use the calculated position; otherwise use current yPosition
  let signatureY = Math.max(yPosition, maxContentY);
  
  // Ensure signature doesn't go beyond safe area
  if (signatureY + signatureHeight > pageHeight - margin) {
    signatureY = pageHeight - signatureHeight - margin;
  }
  
  const signatureLineWidth = 50;
  const labelWidth = 35;
  
  // Crew Member Signature (left side)
  const crewLabelX = margin + 10;
  const crewLineX = crewLabelX + labelWidth;
  
  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  
  // Crew signature line
  doc?.text('Crew Member Signature:', crewLabelX, signatureY);
  doc?.line(crewLineX, signatureY, crewLineX + signatureLineWidth, signatureY);
  
  // Crew date line
  doc?.text('Date:', crewLabelX, signatureY + 7);
  doc?.line(crewLineX, signatureY + 7, crewLineX + signatureLineWidth, signatureY + 7);

  // Master of Vessel Signature (moved more towards middle)
  const masterLabelX = pageWidth / 2 - 10;
  const masterLineX = masterLabelX + labelWidth + 5;
  
  // Master signature line
  doc?.text('Master of Vessel Signature:', masterLabelX, signatureY);
  doc?.line(masterLineX, signatureY, masterLineX + signatureLineWidth, signatureY);
  
  // Master date line
  doc?.text('Date:', masterLabelX, signatureY + 7);
  doc?.line(masterLineX, signatureY + 7, masterLineX + signatureLineWidth, signatureY + 7);

  // === FOOTER ===
  doc?.setFontSize(7);
  doc?.setFont('helvetica', 'normal');
  doc?.text('Cargo - Hours of Rest Audit Report', pageWidth / 2, pageHeight - 8, { align: 'center' });
  doc?.text('Page 1', pageWidth - margin, pageHeight - 8, { align: 'right' });

  return doc?.output('blob');
};

/**
 * Generate HOR PDF and return blob URL for iOS-compatible downloads
 * This approach works better in iPad in-app browsers
 */
export const generateHORAuditPDFForDownload = async ({ crew, month, includeAuditTrail }) => {
  const blob = await generateHORAuditPDF({ crew, month, includeAuditTrail });
  const fileName = `HOR_${crew?.fullName?.replace(/\s+/g, '_')}_${month?.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })?.replace(/\s+/g, '_')}.pdf`;
  
  // Create a blob URL that persists longer for iOS
  const blobUrl = URL.createObjectURL(blob);
  
  return {
    blob,
    blobUrl,
    fileName,
    // Cleanup function to be called after download
    cleanup: () => URL.revokeObjectURL(blobUrl)
  };
};

/**
 * Generate multiple HOR PDFs for batch download
 */
export const generateMultipleHORAuditPDFs = async (crewList, month, includeAuditTrail) => {
  const results = [];
  
  for (const crew of crewList) {
    const pdfData = await generateHORAuditPDFForDownload({
      crew,
      month,
      includeAuditTrail
    });
    results?.push(pdfData);
  }
  
  return results;
};

/**
 * Share HOR PDF using Web Share API (iOS native share sheet)
 * Falls back to window.open for non-supporting browsers
 */
export const shareHORAuditPDF = async ({ crew, month, includeAuditTrail }) => {
  try {
    // Generate the PDF
    const pdfData = await generateHORAuditPDFForDownload({
      crew,
      month,
      includeAuditTrail
    });

    const { blob, fileName } = pdfData;

    // Check if Web Share API is available and supports files
    if (navigator?.share && navigator?.canShare) {
      const file = new File([blob], fileName, { type: 'application/pdf' });
      
      if (navigator?.canShare({ files: [file] })) {
        await navigator?.share({
          files: [file],
          title: 'HOR Audit Report',
          text: `Hours of Rest audit report for ${crew?.fullName}`
        });
        
        // Share succeeded or was cancelled
        return { success: true, method: 'share' };
      }
    }

    // Fallback A: iOS-friendly - open in new tab with native share controls
    if (/iPad|iPhone|iPod/?.test(navigator?.userAgent)) {
      window?.open(pdfData?.blobUrl, '_blank');
      
      // Clean up after delay
      setTimeout(() => pdfData?.cleanup(), 10000);
      
      return { success: true, method: 'window_open' };
    }

    // Fallback B: Download link for other browsers
    const a = document?.createElement('a');
    a.href = pdfData?.blobUrl;
    a.download = fileName;
    document?.body?.appendChild(a);
    a?.click();
    document?.body?.removeChild(a);
    
    // Clean up
    setTimeout(() => pdfData?.cleanup(), 10000);
    
    return { success: true, method: 'download' };
  } catch (error) {
    // User cancelled share or error occurred
    if (error?.name === 'AbortError') {
      // User cancelled - not an error
      return { success: false, cancelled: true };
    } else {
      console.error('Share failed:', error);
      throw error;
    }
  }
};

/**
 * Share multiple HOR PDFs using Web Share API
 * For iOS: shares files sequentially with delays for stability
 */
export const shareMultipleHORAuditPDFs = async (crewList, month, includeAuditTrail) => {
  const results = [];
  
  // Check if Web Share API is available
  const hasWebShare = navigator?.share && navigator?.canShare;
  
  for (let i = 0; i < crewList?.length; i++) {
    const crew = crewList?.[i];
    
    try {
      const result = await shareHORAuditPDF({
        crew,
        month,
        includeAuditTrail
      });
      
      results?.push({
        crewId: crew?.id,
        crewName: crew?.fullName,
        ...result
      });
      
      // Add delay between shares for iOS stability (only if using fallback methods)
      if (!hasWebShare && i < crewList?.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      results?.push({
        crewId: crew?.id,
        crewName: crew?.fullName,
        success: false,
        error: error?.message
      });
    }
  }
  
  return results;
};

// Helper function imports
function getMonthConfirmation(crewId, year, month) {
  try {
    const confirmations = JSON.parse(localStorage.getItem('cargo_hor_month_confirmations') || '[]');
    return confirmations?.find(c => c?.crewId === crewId && c?.year === year && c?.month === month) || null;
  } catch {
    return null;
  }
}

function getAuditLog(crewId, year, month) {
  try {
    const auditLog = JSON.parse(localStorage.getItem('cargo_hor_audit_log') || '[]');
    let filtered = auditLog?.filter(event => 
      event?.crewId === crewId || 
      event?.affectedCrew?.includes(crewId)
    );
    
    if (year !== null && month !== null) {
      filtered = filtered?.filter(event => 
        event?.year === year && event?.month === month
      );
    }
    
    return filtered?.sort((a, b) => new Date(b?.timestamp) - new Date(a?.timestamp));
  } catch {
    return [];
  }
}

function getCorrectionRequests(crewId) {
  try {
    const requests = JSON.parse(localStorage.getItem('cargo_hor_correction_requests') || '[]');
    return requests?.filter(r => r?.crewId === crewId);
  } catch {
    return [];
  }
}

function getReminderLog(crewId, year, month) {
  try {
    const log = JSON.parse(localStorage.getItem('cargo_hor_reminder_log') || '[]');
    let filtered = log?.filter(r => r?.userId === crewId);
    
    if (year !== null && month !== null) {
      filtered = filtered?.filter(r => {
        const reminderDate = new Date(r?.month);
        return reminderDate?.getFullYear() === year && reminderDate?.getMonth() === month;
      });
    }
    
    return filtered?.sort((a, b) => new Date(b?.sentAt) - new Date(a?.sentAt));
  } catch {
    return [];
  }
}

export default { generateHORAuditPDF };