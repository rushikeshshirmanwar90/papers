import { badRequest } from "@/lib/http";

// The institute's logo, printed in the header of its exam papers. Only PNG and
// JPEG, checked by their own bytes rather than by what the sender calls them,
// and small: it is stored with the institute and embedded in every paper.

export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** The largest logo accepted, in bytes. */
export const MAX_LOGO_BYTES = 600 * 1024;
/** Longest side accepted, in px; a logo is a small picture. */
export const MAX_LOGO_EDGE = 4096;
export const MIN_LOGO_EDGE = 16;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height of a PNG, from its header; null when the bytes aren't a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Width and height of a JPEG, from its first frame header; null when the bytes aren't a JPEG. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    // Fill bytes, and the markers that stand alone (no length follows).
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    // Start-of-frame markers carry the size (not DHT 0xC4, JPG 0xC8 or DAC 0xCC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * Checks an uploaded logo: base64 of a PNG or JPEG within the size limits,
 * whose bytes really are the type given. Returns what to store, or throws a 400.
 */
export function checkLogo(body: Record<string, unknown>): { contentType: LogoType; data: Buffer; width: number; height: number } {
  const contentType = body.contentType;
  if (typeof contentType !== "string" || !(LOGO_TYPES as readonly string[]).includes(contentType)) {
    throw badRequest("The logo must be a PNG or JPEG image.");
  }
  const encoded = body.data;
  if (typeof encoded !== "string" || encoded === "") throw badRequest("Choose an image for the logo.");
  // Refuse before decoding anything that couldn't be small enough.
  if (encoded.length > Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 8) throw badRequest(`The logo is too large. Use an image under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw badRequest("The logo's image data isn't valid.");
  const data = Buffer.from(encoded, "base64");
  if (data.length > MAX_LOGO_BYTES) throw badRequest(`The logo is too large. Use an image under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`);
  const size = contentType === "image/png" ? pngSize(data) : jpegSize(data);
  if (!size) throw badRequest(`That file isn't a ${contentType === "image/png" ? "PNG" : "JPEG"} image.`);
  if (size.width < MIN_LOGO_EDGE || size.height < MIN_LOGO_EDGE) throw badRequest("The logo is too small. Use an image at least 16 px on each side.");
  if (size.width > MAX_LOGO_EDGE || size.height > MAX_LOGO_EDGE) throw badRequest(`The logo is too large. Use an image up to ${MAX_LOGO_EDGE} px on each side.`);
  return { contentType: contentType as LogoType, data, ...size };
}

/** The logo as a data URI, which is how the paper's page embeds it (no address is ever fetched). */
export const logoDataUri = (logo: { contentType: string; data: Buffer }) => `data:${logo.contentType};base64,${logo.data.toString("base64")}`;
