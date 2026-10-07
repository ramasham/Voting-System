import type { Category, Maker } from "../data/config";

export type ApiErrorCode =
  | "NETWORK" // the device could not reach the server (offline, timeout)
  | "SERVER" // 5xx or unexpected response
  | "VALIDATION" // bad input (name/phone/code format)
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "RATE_LIMITED" // too many attempts, see retryAfterSeconds
  | "OFF_SITE_NETWORK" // request did not come from the exhibition network
  | "OFF_SITE_LOCATION" // location is outside the venue radius
  | "LOCATION_INACCURATE" // GPS accuracy too weak to decide
  | "VOTING_CLOSED"
  | "VOTING_NOT_STARTED"
  | "ALREADY_VOTED" // this visitor already voted in this category
  | "SESSION_EXPIRED"
  | "UNAUTHORIZED";

export type VotingStatus = "open" | "closed" | "not_started";
export type Votes = Record<string, string>; // categoryId -> makerId

export type AppConfig = {
  status: VotingStatus;
  requireNetworkCheck: boolean;
  requireLocation: boolean;
  resendAfterSeconds: number;
};

export type Visitor = { id: string; name: string };
export type Catalog = { categories: Category[]; makers: Maker[] };
export type Session = { visitor: Visitor; votes: Votes };

export type Api = {
  mode: "mock" | "http";
  getConfig(): Promise<AppConfig>;
  checkNetwork(): Promise<void>;
  checkLocation(input: { latitude: number; longitude: number; accuracy: number }): Promise<void>;
  sendOtp(input: { name: string; phone: string }): Promise<{ resendAfterSeconds: number }>;
  verifyOtp(input: { phone: string; code: string }): Promise<Session>;
  getMe(): Promise<Session | null>;
  getCatalog(): Promise<Catalog>;
  castVote(input: { categoryId: string; makerId: string }): Promise<{ votes: Votes }>;
};
