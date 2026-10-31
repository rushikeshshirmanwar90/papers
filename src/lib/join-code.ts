import { randomInt } from "crypto";
import Tuition, { type TuitionDoc } from "@/models/Tuition";

// A tuition's join code, which teachers sign up with: 8 characters shown as
// "K7Q2-M9TA". No look-alike characters (0/O, 1/I/L), and typed in any case,
// with or without the dash.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normaliseCode = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) : "";

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function newCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/** Gives the tuition a new code (replacing any old one, which stops working). */
export async function renewJoinCode(tuition: TuitionDoc): Promise<string> {
  for (let tries = 0; tries < 5; tries++) {
    tuition.joinCode = newCode();
    try {
      await tuition.save();
      return tuition.joinCode;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new Error("Couldn't make a unique join code");
}

/** The tuition's code, made on first use. */
export async function joinCodeOf(tuition: TuitionDoc): Promise<string> {
  return tuition.joinCode ?? renewJoinCode(tuition);
}

/** The active tuition with this code, or null. */
export async function tuitionByCode(value: unknown): Promise<TuitionDoc | null> {
  const code = normaliseCode(value);
  if (code.length !== 8) return null;
  return (await Tuition.findOne({ joinCode: code, active: true })) as TuitionDoc | null;
}
