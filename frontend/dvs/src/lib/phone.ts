import { isValidPhoneNumber, parsePhoneNumberFromString } from "libphonenumber-js";

// dial = "+962", local = "791234567"  ->  "+962791234567" (E.164), or null when the number is not valid for that country.
export function toE164(dial: string, local: string): string | null {
  const full = `${dial}${local}`;
  if (!isValidPhoneNumber(full)) return null;
  return parsePhoneNumberFromString(full)?.number ?? null;
}
