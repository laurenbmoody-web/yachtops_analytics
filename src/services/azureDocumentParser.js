/**
 * Azure Document Intelligence Service
 *
 * Routes document parsing through the Supabase edge function
 * (supabase/functions/azureDocumentParser) to avoid CORS restrictions
 * that prevent direct browser-to-Azure API calls.
 *
 * This service handles ONLY document structure extraction.
 * Folder routing and Cargo schema mapping are separate concerns.
 */

import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Send a file to Azure Document Intelligence via the Supabase edge function.
 * Returns normalized { tables, paragraphs } or { error }.
 *
 * @param {File} file
 * @returns {Promise<{tables: Array, paragraphs: Array, raw?: any} | {error: string}>}
 */
export async function parseDocumentWithAzure(file) {
  try {
    if (!file) {
      return { error: 'No file provided' };
    }

    // Convert file to base64 to send as JSON (avoids multipart CORS preflight issues)
    const arrayBuffer = await file?.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array?.length; i++) {
      binary += String.fromCharCode(uint8Array?.[i]);
    }
    const fileBase64 = btoa(binary);
    const mimeType = file?.type || 'application/pdf';

    // Call the Supabase edge function which proxies to Azure
    const { data, error } = await supabase?.functions?.invoke('azureDocumentParser', {
      body: {
        fileBase64,
        mimeType,
      },
    });

    if (error) {
      // Supabase functions.invoke wraps HTTP errors — extract the message
      const msg = error?.message || error?.context?.errorMessage || String(error);
      return { error: `Azure parse failed: ${msg}` };
    }

    if (data?.error) {
      return { error: data?.error };
    }

    return data;
  } catch (err) {
    return { error: err?.message || 'Failed to parse document with Azure' };
  }
}

// ---------------------------------------------------------------------------
// Helper: check if result is an error
// ---------------------------------------------------------------------------
export function isAzureParseError(result) {
  return result && typeof result === 'object' && 'error' in result;
}

// ---------------------------------------------------------------------------
// Helper: get a display label for a table
// ---------------------------------------------------------------------------
export function getTableLabel(table, index) {
  const pages = table?.pageNumbers?.length
    ? `Page${table?.pageNumbers?.length > 1 ? 's' : ''} ${table?.pageNumbers?.join(', ')}`
    : '';
  return `Table ${index + 1}${pages ? ` — ${pages}` : ''} (${table?.rowCount} rows × ${table?.columnCount} cols)`;
}
