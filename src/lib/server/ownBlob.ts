import "server-only";

/**
 * Is this a URL in OUR Vercel Blob store? (10-01 sweep: the ticket and board image patterns took any store's host, so a
 * user could attach a file from their own store, and the admin's browser and the support mail loaded it.) Our store is
 * the host every social/ticket/board file has used; the Blob token names the store too, so a store change keeps working.
 */
const OUR_STORE = "mlwovvakovcpakbr";

function tokenStore(): string | null {
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? "");
  return m ? m[1].toLowerCase() : null;
}

export function isOwnBlobUrl(u: string): boolean {
  let host: string;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return false;
  }
  const stores = [OUR_STORE, tokenStore()].filter(Boolean);
  return stores.some((s) => host === `${s}.public.blob.vercel-storage.com`);
}
