import type { ApiErrorCode, Votes } from "./types";

export class ApiError extends Error {
  code: ApiErrorCode;
  retryAfterSeconds?: number;
  votes?: Votes; // sent with ALREADY_VOTED so the UI can resync

  constructor(code: ApiErrorCode, options: { message?: string; retryAfterSeconds?: number; votes?: Votes } = {}) {
    super(options.message ?? code);
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.votes = options.votes;
  }
}

export const errorCode = (error: unknown): ApiErrorCode =>
  error instanceof ApiError ? error.code : "SERVER";
