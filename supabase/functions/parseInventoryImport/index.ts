declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const headers = body.headers;
  const rows = body.rows;
  const source_type = body.source_type;
  const meta = body.meta || {};
  const vesselLocations: string[] = body.vesselLocations || [];

  if (!headers || !Array.isArray(headers)) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid "headers" field (must be string array)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!rows || !Array.isArray(rows)) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid "rows" field (must be array of string arrays)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiApiKey) {
    return new Response(
      JSON.stringify({ error: 'OpenAI API key not configured on server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const headerLine = headers.join(' | ');
  const sourceLabel = source_type === 'pdf' ? 'PDF document' : 'spreadsheet';

  const locationColumns: string[] = meta.locationColumns || [];
  const totalColumn: string | null = meta.totalColumn || null;
  const hasSuggestedFolderColumn: boolean = meta.hasSuggestedFolderColumn || false;
  const schemaContext: string = meta.schemaContext || '';
  const dynamicColumns: any[] = meta.dynamicColumns || [];
  const sourceFields: any[] = meta.sourceFields || [];

  const locationHint = locationColumns.length > 0
    ? `\nLOCATION COLS: ${locationColumns.join(', ')} → location_quantities entries.`
    : '';

  const totalHint = totalColumn
    ? `\nTOTAL COL: "${totalColumn}" is pre-calculated. Warn if sum differs.`
    : '';

  const folderHint = hasSuggestedFolderColumn
    ? '\nFIRST COL: category breadcrumb (e.g. "Spirits > Vodka") → suggested_folder base.'
    : '';

  const vesselLocationHint = vesselLocations.length > 0
    ? '\nVESSEL LOCATIONS (EXACT MATCH ONLY):\n' + vesselLocations.map((l: string) => '  - ' + l).join('\n') +
      '\nExact match → location_match + confidence "exact". No match → location_match null, confidence "none". NEVER fuzzy match.' :'';

  let dynamicSchemaHint = schemaContext ? '\n\n' + schemaContext : '';

  let sourceFieldsHint = '';
  if (sourceFields.length > 0) {
    sourceFieldsHint = '\nSOURCE FIELDS (preserve in source_fields):';
    for (const sf of sourceFields) {
      sourceFieldsHint += ` "${sf.header}"→source_fields.${sf.key}(${sf.inferredType});`;
    }
  }

  let dynamicColumnsHint = '';
  if (dynamicColumns.length > 0) {
    const customCols = dynamicColumns.filter((c: any) => c.type === 'custom' || c.type === 'source');
    if (customCols.length > 0) {
      dynamicColumnsHint = '\nCUSTOM COLS→source_fields:';
      for (const col of customCols) {
        dynamicColumnsHint += ` "${col.header}"→source_fields.${col.key}(${col.inferredType});`;
      }
    }
  }

  const systemPrompt = `You are an inventory parser for a yacht management system. Convert ${sourceLabel} rows into structured JSON.

CRITICAL: Return EVERY real inventory item row. NEVER return empty items array if rows exist. item_name is mandatory. quantity null if unknown.
${folderHint}${locationHint}${totalHint}${vesselLocationHint}${dynamicSchemaHint}${sourceFieldsHint}${dynamicColumnsHint}

SECTION HEADER EXCLUSION: Exclude rows that are ONLY a single category label with no quantity/brand/unit (e.g. "Vodka", "Spirits"). If "Grab Bag" appears under a real column like "Bag Name" in a data row, keep it as data.

YEAR EXTRACTION: If item_name contains a 4-digit year (1900-2099), extract to "year" (integer) and remove from item_name. Remove surrounding brackets/commas. Trim trailing punctuation.

SIZE EXTRACTION: Extract size patterns (ml, cl, L, g, kg, oz) from item_name. Clean item_name. Add warning "Size extracted from item name".

CATEGORY/SUBCATEGORY: Classify by brand/name:
- Vodka (Grey Goose, Belvedere, Absolut, Ketel One, Ciroc, Smirnoff, Tito's, Haku, Reyka, Finlandia, Chopin) → Alcohol/Vodka
- Gin (Hendrick's, Tanqueray, Bombay Sapphire, Monkey 47, The Botanist, Beefeater, Sipsmith, Roku, Malfy, Gin Mare) → Alcohol/Gin
- Tequila (Patron, Don Julio, Casamigos, Jose Cuervo, Herradura, Espolon, Olmeca, 1800, Clase Azul) → Alcohol/Tequila
- Rum (Bacardi, Captain Morgan, Diplomatico, Havana Club, Mount Gay, Appleton, Zacapa, Kraken, Plantation) → Alcohol/Rum
- Whisky (Johnnie Walker, Glenfiddich, Macallan, Chivas Regal, Jack Daniel's, Jameson, Bulleit, Woodford Reserve, Lagavulin, Laphroaig, Balvenie, Glenlivet, Ardbeg) → Alcohol/Whisky
- Cognac (Hennessy, Rémy Martin, Martell, Courvoisier, Hine, Camus) → Alcohol/Cognac
- Aperitif/Liqueur (Campari, Aperol, Lillet, Cointreau, Grand Marnier, Baileys, Kahlua, Amaretto, Disaronno, Malibu, Sambuca, Limoncello, Jägermeister, Drambuie, Chambord, Frangelico, Tia Maria, Passoa, Cynar, Fernet-Branca, Suze, Chartreuse, Galliano) → Alcohol/Aperitif
- Champagne (Moët, Veuve Clicquot, Dom Pérignon, Bollinger, Krug, Laurent-Perrier, Pol Roger, Taittinger, Ruinart, Perrier-Jouët, Cristal, Armand de Brignac) → Alcohol/Champagne
- Sparkling Wine (Prosecco, Cava, Crémant, Sekt) → Alcohol/Sparkling Wine
- Beer (Heineken, Peroni, Corona, Stella Artois, Budweiser, Guinness, San Miguel, Asahi, Modelo) → Alcohol/Beer
- Cider (Strongbow, Magners, Kopparberg, Rekorderlig, Aspall) → Alcohol/Cider
- Wine (red/white/rosé, Bordeaux, Burgundy, Barolo, Rioja, Malbec, Pinot Noir, Cabernet, Chardonnay, Sauvignon Blanc, Riesling, Pinot Grigio, Sancerre, Chablis) → Alcohol/Wine
- Water (San Pellegrino, Evian, Fiji, Perrier, Hildon) → Non-Alcoholic/Water
- Soft Drinks (Coca-Cola, Pepsi, Sprite, Fanta, Fever-Tree, tonic, ginger ale) → Non-Alcoholic/Soft Drinks
- Juice → Non-Alcoholic/Juice; Coffee/Tea → Non-Alcoholic/Hot Beverages; Red Bull/Monster → Non-Alcoholic/Energy Drinks

FOLDER MAPPING (suggested_folder):
Alcohol/Vodka→"Interior > Guest > Alcohol > Spirits > Vodka" Alcohol/Gin→"Interior > Guest > Alcohol > Spirits > Gin" Alcohol/Tequila→"Interior > Guest > Alcohol > Spirits > Tequila" Alcohol/Rum→"Interior > Guest > Alcohol > Spirits > Rum" Alcohol/Whisky→"Interior > Guest > Alcohol > Spirits > Whisky" Alcohol/Cognac→"Interior > Guest > Alcohol > Spirits > Cognac"
Alcohol/Aperitif→"Interior > Guest > Alcohol > Aperitif" Alcohol/Champagne→"Interior > Guest > Alcohol > Champagne" Alcohol/Sparkling Wine→"Interior > Guest > Alcohol > Sparkling Wine" Alcohol/Wine→"Interior > Guest > Alcohol > Wine" Alcohol/Beer→"Interior > Guest > Alcohol > Beer" Alcohol/Cider→"Interior > Guest > Alcohol > Cider" Non-Alcoholic/Water→"Interior > Guest > Non-Alcoholic > Water" Non-Alcoholic/Soft Drinks→"Interior > Guest > Non-Alcoholic > Soft Drinks" Non-Alcoholic/Juice→"Interior > Guest > Non-Alcoholic > Juice" Non-Alcoholic/Hot Beverages→"Interior > Guest > Hot Beverages" Non-Alcoholic/Energy Drinks→"Interior > Guest > Non-Alcoholic > Energy Drinks"

UNIT: Infer from type (bottle for wine/spirits/champagne, can if "can" in name). Add warning "Unit inferred from item type".
QUANTITY: number only (no unit text).

DYNAMIC SCHEMA: Core fields (item_name, brand, quantity, unit, size, expiry_date, batch_no, code, supplier) go top-level. All other source columns go in source_fields object. NEVER discard meaningful columns.

OUTPUT per item:
{item_name,brand,description,size,quantity,unit,category,subcategory,location,location_match,location_match_confidence,location_suggestions,location_quantities,calculated_total,imported_total,total_mismatch,suggested_folder,restock_level,supplier,expiry_date,barcode,year,batch_no,code,tasting_notes,notes,source_fields:{},warnings:[]}

Return ONLY valid JSON: {"items":[...],"warnings":[]}. No markdown, no explanation.`;

  // ── Batch processing ──────────────────────────────────────────────────────
  const BATCH_SIZE = 8;

  const validRows = rows.filter((row: any[]) =>
    row.some((cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== '')
  );

  const totalRows = validRows.length;
  const batches: any[][] = [];
  for (let i = 0; i < totalRows; i += BATCH_SIZE) {
    batches.push(validRows.slice(i, i + BATCH_SIZE));
  }

  console.log(`[parseInventoryImport] Total valid rows: ${totalRows}, Batches: ${batches.length} (size ${BATCH_SIZE})`);

  const allItems: any[] = [];
  const allWarnings: string[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = batchIndex * BATCH_SIZE;
    const batchEnd = batchStart + batch.length - 1;

    console.log(`[parseInventoryImport] Processing batch ${batchIndex + 1}/${batches.length} (rows ${batchStart}–${batchEnd})`);

    const rowLines = batch
      .map((row: any[]) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join(' | '))
      .join('\n');

    const userMessage = "Headers:\n" + headerLine + "\n\nRows:\n" + rowLines;

    let openAiResponse;
    try {
      openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + openAiApiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (fetchError) {
      console.error(`[parseInventoryImport] Batch ${batchIndex + 1} fetch error:`, fetchError);
      return new Response(
        JSON.stringify({
          message: `OpenAI fetch failed on batch ${batchIndex + 1} (rows ${batchStart}–${batchEnd})`,
          error: String(fetchError),
          batchIndex,
          batchStart,
          batchEnd,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text();
      console.error(`[parseInventoryImport] Batch ${batchIndex + 1} OpenAI API error:`, openAiResponse.status, errText);
      return new Response(
        JSON.stringify({
          message: `OpenAI API error on batch ${batchIndex + 1} (rows ${batchStart}–${batchEnd})`,
          status: openAiResponse.status,
          responseText: errText,
          batchIndex,
          batchStart,
          batchEnd,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let openAiData;
    try {
      openAiData = await openAiResponse.json();
    } catch (jsonParseError) {
      console.error(`[parseInventoryImport] Batch ${batchIndex + 1} failed to parse OpenAI response JSON:`, jsonParseError);
      return new Response(
        JSON.stringify({
          message: `Failed to parse OpenAI API response JSON on batch ${batchIndex + 1} (rows ${batchStart}–${batchEnd})`,
          error: String(jsonParseError),
          batchIndex,
          batchStart,
          batchEnd,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawContent = openAiData?.choices?.[0]?.message?.content || '';
    const cleaned = rawContent.replace(/`{3}json\n?/gi, '').replace(/`{3}\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Retry with smaller sub-batches (4 rows) if JSON was truncated
      console.warn(`[parseInventoryImport] Batch ${batchIndex + 1} JSON parse failed — retrying with sub-batches of 4`);
      const SUB_BATCH_SIZE = 4;
      let retrySuccess = true;
      for (let si = 0; si < batch.length; si += SUB_BATCH_SIZE) {
        const subBatch = batch.slice(si, si + SUB_BATCH_SIZE);
        const subRowLines = subBatch
          .map((row: any[]) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join(' | '))
          .join('\n');
        const subUserMessage = "Headers:\n" + headerLine + "\n\nRows:\n" + subRowLines;
        let subResponse;
        try {
          subResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + openAiApiKey,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: subUserMessage },
              ],
              temperature: 0.1,
              max_tokens: 4096,
              response_format: { type: 'json_object' },
            }),
          });
        } catch (subFetchErr) {
          retrySuccess = false;
          console.error(`[parseInventoryImport] Sub-batch fetch error:`, subFetchErr);
          break;
        }
        if (!subResponse.ok) {
          retrySuccess = false;
          console.error(`[parseInventoryImport] Sub-batch OpenAI error:`, subResponse.status);
          break;
        }
        let subData;
        try {
          subData = await subResponse.json();
        } catch {
          retrySuccess = false;
          break;
        }
        const subRaw = subData?.choices?.[0]?.message?.content || '';
        const subCleaned = subRaw.replace(/`{3}json\n?/gi, '').replace(/`{3}\n?/g, '').trim();
        let subParsed;
        try {
          subParsed = JSON.parse(subCleaned);
        } catch {
          retrySuccess = false;
          console.error(`[parseInventoryImport] Sub-batch JSON parse failed even at size 4`);
          break;
        }
        allItems.push(...(subParsed?.items ?? []));
        allWarnings.push(...(subParsed?.warnings ?? []));
      }
      if (!retrySuccess) {
        return new Response(
          JSON.stringify({
            message: `Failed to parse AI response as JSON on batch ${batchIndex + 1} (rows ${batchStart}–${batchEnd})`,
            error: String(parseErr),
            rawContentPreview: cleaned.slice(0, 500),
            batchIndex,
            batchStart,
            batchEnd,
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Sub-batch retry succeeded — skip normal item push below
      console.log(`[parseInventoryImport] Batch ${batchIndex + 1}: recovered via sub-batch retry`);
      continue;
    }

    const batchItems = parsed?.items ?? [];
    const batchWarnings = parsed?.warnings ?? [];

    console.log(`[parseInventoryImport] Batch ${batchIndex + 1}: ${batchItems.length} items, ${batchWarnings.length} warnings`);

    allItems.push(...batchItems);
    allWarnings.push(...batchWarnings);
  }

  const uniqueWarnings = [...new Set(allWarnings)];

  return new Response(
    JSON.stringify({ items: allItems, warnings: uniqueWarnings }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
