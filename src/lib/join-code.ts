import { randomInt } from "crypto";

// The shape of every joining code (students' and teachers'): 8 characters shown
// as "K7Q2-M9TA". No look-alike characters (0/O, 1/I/L), and typed in any case,
// with or without the dash.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normaliseCode = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) : "";

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function newCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
