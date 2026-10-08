import { copy } from "../i18n/copy";
import type { Language } from "../data/config";
import { ApiError } from "../services/errors";

// Turns an API error into a short message for the visitor (Arabic or English).
export function errorMessage(lang: Language, error: unknown): string {
  const t = copy[lang];
  if (!(error instanceof ApiError)) return t.errServer;
  switch (error.code) {
    case "NETWORK":
      return t.errNetwork;
    case "SMS_UNAVAILABLE":
      return t.errSms;
    case "RATE_LIMITED":
      return t.errRate.replace("{s}", String(error.retryAfterSeconds ?? 60));
    case "OTP_INVALID":
      return t.otpInvalid;
    case "OTP_EXPIRED":
      return t.otpExpired;
    case "ALREADY_VOTED":
      return t.alreadyVoted;
    default:
      return t.errServer;
  }
}
