// Resumable uploads to the vessel-scans bucket via Supabase's TUS endpoint.
// Scan files run 20–150MB and come off phones on marina wifi: tus-js-client
// gives real byte progress, 6MB chunking, and automatic resume across
// network blips — none of which supabase-js's single-POST upload() offers.
import * as tus from 'tus-js-client';
import { supabase } from '../../../lib/supabaseClient';

export const SCAN_EXTENSIONS = ['spz', 'ply', 'splat', 'ksplat'];
export const SCAN_MAX_BYTES = 209715200; // the bucket's 200MB ceiling

export const fileExtension = (name) => (name.split('.').pop() || '').toLowerCase();

// Human message, not an error code. Returns null when the file is fine.
export const validateScanFile = (file) => {
  const ext = fileExtension(file.name);
  if (!SCAN_EXTENSIONS.includes(ext)) {
    return `“.${ext}” isn't a splat format we can read — export as SPZ, PLY, SPLAT or KSPLAT.`;
  }
  if (file.size > SCAN_MAX_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    return `That file is ${mb}MB — the ceiling is 200MB. Export as SPZ from Scaniverse for a much smaller file.`;
  }
  return null;
};

// Starts (or resumes) an upload. Returns { promise, abort } — the promise
// settles on completion/error; abort() stops the transfer, leaving the TUS
// fingerprint behind so re-selecting the same file resumes where it left off.
export async function createScanUpload({ path, file, onProgress }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error('Your session has expired — sign in again to upload.');
  }

  let upload;
  const promise = new Promise((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 6 * 1024 * 1024, // Supabase's resumable endpoint requires exactly 6MB
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${sessionData.session.access_token}`,
        'x-upsert': 'true', // retrying an incomplete upload reuses the row's path
      },
      metadata: {
        bucketName: 'vessel-scans',
        objectName: path,
        contentType: 'application/octet-stream',
        cacheControl: '3600',
      },
      onError: (err) => reject(err),
      onProgress: (sent, total) => onProgress?.(sent, total),
      onSuccess: () => resolve(),
    });

    upload.findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch((err) => {
        // Fingerprint store unavailable (private mode) — upload from zero.
        console.warn('[scan-upload] resume lookup failed, starting fresh', err);
        upload.start();
      });
  });

  return { promise, abort: () => upload.abort() };
}
