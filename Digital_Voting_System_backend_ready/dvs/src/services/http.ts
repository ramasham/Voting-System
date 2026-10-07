import { ApiError } from "./errors";
import type { Api, ApiErrorCode } from "./types";

// Real back end. The server must answer errors as:
//   HTTP 4xx/5xx + { "error": { "code": "OTP_INVALID", "message": "...", "retryAfterSeconds": 60, "votes": {...} } }
// See docs/API_CONTRACT.md for every endpoint.

let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

export function createHttpApi(baseUrl: string): Api {
  const call = async <T,>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: "include", // httpOnly session cookie
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("NETWORK");
    }
    if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;
    let payload: { error?: { code?: ApiErrorCode; message?: string; retryAfterSeconds?: number; votes?: Record<string, string> } } = {};
    try {
      payload = await response.json();
    } catch {
      /* empty or non-JSON body */
    }
    const code: ApiErrorCode = payload.error?.code ?? (response.status >= 500 ? "SERVER" : response.status === 401 ? "UNAUTHORIZED" : "VALIDATION");
    if (code === "SESSION_EXPIRED") onSessionExpired?.();
    throw new ApiError(code, {
      message: payload.error?.message,
      retryAfterSeconds: payload.error?.retryAfterSeconds,
      votes: payload.error?.votes,
    });
  };

  return {
    mode: "http",
    getConfig: () => call("GET", "/config"),
    checkNetwork: () => call("POST", "/access/network-check"),
    checkLocation: (input) => call("POST", "/access/location-check", input),
    sendOtp: (input) => call("POST", "/auth/otp/send", input),
    verifyOtp: (input) => call("POST", "/auth/otp/verify", input),
    getMe: async () => {
      try {
        return await call("GET", "/me");
      } catch (error) {
        if (error instanceof ApiError && (error.code === "UNAUTHORIZED" || error.code === "SESSION_EXPIRED")) return null;
        throw error;
      }
    },
    getCatalog: () => call("GET", "/catalog"),
    castVote: (input) => call("POST", "/votes", input),
  };
}
