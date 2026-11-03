import { randomInt } from "crypto";

// The shape of every joining code (students' and teachers'): 8 characters shown
// as "K7Q2M9TA". No look-alike characters (0/O, 1/I/L), and typed in any case,
// with or without spaces or dashes.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normaliseCode = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) : "";

/** Codes are shown, copied and shared as the plain 8 characters, no dash. */
export const formatCode = (code: string) => code;

export function newCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
