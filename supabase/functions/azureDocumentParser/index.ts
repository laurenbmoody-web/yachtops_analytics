import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// @ts-ignore: Deno is available in the Deno runtime environment
declare const Deno: { env: { get(key: string): string | undefined } };

const AZURE_ENDPOINT = Deno.env.get('AZURE_DOC_INTELLIGENCE_ENDPOINT') || '';
const AZURE_KEY = Deno.env.get('AZURE_DOC_INTELLIGENCE_KEY') || '';
const AZURE_API_VERSION = Deno.env.get('AZURE_DOC_INTELLIGENCE_API_VERSION') || '2024-11-30';

// ---------------------------------------------------------------------------
// Normalize Azure Layout result into a table-friendly structure
// ---------------------------------------------------------------------------
function normalizeAzureResult(analyzeResult: any) {
  const tables = (analyzeResult?.tables || []).map((table: any, tableIdx: number) => {
    const rowCount = table.rowCount || 0;
    const columnCount = table.columnCount || 0;

    // Build a 2D grid
    const grid: string[][] = Array.from({ length: rowCount }, () =>
      Array.from({ length: columnCount }, () => '')
    );

    // Build a parallel 2D grid of bounding regions for color sampling
    const cellRegions: (any | null)[][] = Array.from({ length: rowCount }, () =>
      Array.from({ length: columnCount }, () => null)
    );

    for (const cell of table.cells || []) {
      const r = cell.rowIndex ?? 0;
      const c = cell.columnIndex ?? 0;
      const text = cell.content || '';
      if (r < rowCount && c < columnCount) {
        grid[r][c] = text;
        // Store the first bounding region (polygon + pageNumber) for color sampling
        const region = cell.boundingRegions?.[0] || null;
        if (region) {
          cellRegions[r][c] = {
            pageNumber: region.pageNumber ?? 1,
            polygon: region.polygon || [],
          };
        }
      }
    }

    // Determine page numbers
    const pageNumbers: number[] = [];
    for (const region of table.boundingRegions || []) {
      if (region.pageNumber && !pageNumbers.includes(region.pageNumber)) {
        pageNumbers.push(region.pageNumber);
      }
    }

    return {
      id: `table_${tableIdx}`,
      pageNumbers,
      rows: grid,
      cellRegions,
      rowCount,
      columnCount,
    };
  });

  const paragraphs = (analyzeResult?.paragraphs || []).map((p: any) => ({
    content: p.content || '',
    role: p.role || null,
    pageNumber: p.boundingRegions?.[0]?.pageNumber || null,
  }));

  // Also expose page dimensions for coordinate normalisation
  const pages = (analyzeResult?.pages || []).map((p: any) => ({
    pageNumber: p.pageNumber ?? 1,
    width: p.width ?? 0,
    height: p.height ?? 0,
    unit: p.unit ?? 'inch',
  }));

  return {
    tables,
    paragraphs,
    pages,
    raw: analyzeResult,
  };
}

// ---------------------------------------------------------------------------
// Poll Azure operation until succeeded or failed
// ---------------------------------------------------------------------------
async function pollOperation(operationLocation: string, maxAttempts = 60, intervalMs = 2000): Promise<any> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollRes = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY },
    });

    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`Azure poll error ${pollRes.status}: ${errText}`);
    }

    const pollData = await pollRes.json();
    const status = pollData?.status;

    if (status === 'succeeded') {
      return pollData?.analyzeResult;
    }

    if (status === 'failed') {
      const errMsg = pollData?.error?.message || 'Azure analysis failed';
      throw new Error(`Azure analysis failed: ${errMsg}`);
    }

    // Still running — wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Azure analysis timed out after maximum polling attempts');
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!AZURE_ENDPOINT || !AZURE_KEY) {
      return new Response(
        JSON.stringify({ error: 'Azure Document Intelligence credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contentType = req.headers.get('content-type') || '';

    let fileBytes: Uint8Array;
    let mimeType = 'application/pdf';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided in form data' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      mimeType = file.type || 'application/pdf';
      const arrayBuffer = await file.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuffer);
    } else if (contentType.includes('application/json')) {
      // Accept base64-encoded file in JSON body
      const body = await req.json();
      if (!body?.fileBase64) {
        return new Response(
          JSON.stringify({ error: 'No fileBase64 provided in JSON body' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      mimeType = body?.mimeType || 'application/pdf';
      const binaryStr = atob(body.fileBase64);
      fileBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        fileBytes[i] = binaryStr.charCodeAt(i);
      }
    } else {
      // Raw binary body
      const arrayBuffer = await req.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuffer);
    }

    // Submit to Azure Layout model
    const analyzeUrl = `${AZURE_ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${AZURE_API_VERSION}`;

    const submitRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
        'Content-Type': mimeType,
      },
      body: fileBytes,
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return new Response(
        JSON.stringify({ error: `Azure submission failed (${submitRes.status}): ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get operation-location header for polling
    const operationLocation = submitRes.headers.get('operation-location');
    if (!operationLocation) {
      return new Response(
        JSON.stringify({ error: 'Azure did not return an operation-location header' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Poll until complete
    const analyzeResult = await pollOperation(operationLocation);

    // Normalize output
    const normalized = normalizeAzureResult(analyzeResult);

    return new Response(JSON.stringify(normalized), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[azureDocumentParser] Error:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
