/**
 * The photo a vision route was sent (#33, 10-16 audit: `image` was cast to a string and `mediaType` taken on trust).
 * A non-string, non-base64 or non-picture body used to reach the paid model call and fail there (or count a scan);
 * now it is a plain 400 first. The media type is read from the bytes, never from the client's label: the app always
 * sends a canvas JPEG, and a label that disagrees with the bytes makes the model call fail. Pure.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export type ImageInput = { ok: true; image: string; mediaType: ImageMediaType } | { ok: false; status: 400 | 413; error: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The picture format from the first bytes; null when it is not one the model reads. */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export function readImageInput(raw: unknown): ImageInput {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, status: 400, error: "Missing image" };
  // base64 inflates by ~4/3, so compare against the decoded size.
  if ((raw.length * 3) / 4 > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "Image too large" };
  if (raw.length < 16 || !BASE64.test(raw)) return { ok: false, status: 400, error: "That isn't a picture" };
  const head = Buffer.from(raw.slice(0, 16), "base64");
  const mediaType = sniffImageType(head);
  if (!mediaType) return { ok: false, status: 400, error: "That isn't a picture" };
  return { ok: true, image: raw, mediaType };
}
