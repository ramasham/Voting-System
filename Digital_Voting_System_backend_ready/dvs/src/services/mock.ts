import { categories, makers } from "../data/config";
import { ApiError } from "./errors";
import type { Api, AppConfig, Session, Votes } from "./types";

// Demo back end that runs in the browser (used when VITE_API_URL is not set).
// Preview any state by adding ?demo=<name> to the URL:
//   closed | not_started | server_error | rate_limited | offsite_network | offsite_location
//   location_denied | location_unavailable | location_timeout | vote_fail | expired_session
// Demo OTP codes: 000000 = wrong code, 999999 = expired code, anything else = success.
// ?strict=1 turns on the location check in demo mode.

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const demo = params.get("demo") ?? "";
const KEY = "mc2026.mock.session";
const wait = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const write = (session: Session | null) => {
  if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
  else sessionStorage.removeItem(KEY);
};
let wrongAttempts = 0;

export const mockApi: Api = {
  mode: "mock",
  async getConfig(): Promise<AppConfig> {
    await wait(250);
    if (demo === "server_error") throw new ApiError("SERVER");
    return {
      status: demo === "closed" ? "closed" : demo === "not_started" ? "not_started" : "open",
      requireNetworkCheck: true,
      requireLocation: demo.startsWith("location_") || demo === "offsite_location" || params.get("strict") === "1",
      resendAfterSeconds: 30,
    };
  },
  async checkNetwork() {
    await wait(700);
    if (demo === "offsite_network") throw new ApiError("OFF_SITE_NETWORK");
  },
  async checkLocation() {
    await wait(700);
    if (demo === "offsite_location") throw new ApiError("OFF_SITE_LOCATION");
  },
  async sendOtp() {
    await wait();
    if (demo === "rate_limited") throw new ApiError("RATE_LIMITED", { retryAfterSeconds: 60 });
    if (demo === "server_error") throw new ApiError("SERVER");
    return { resendAfterSeconds: 30 };
  },
  async verifyOtp({ code }) {
    await wait();
    if (wrongAttempts >= 5) throw new ApiError("RATE_LIMITED", { retryAfterSeconds: 60 });
    if (code === "000000") {
      wrongAttempts += 1;
      throw new ApiError("OTP_INVALID");
    }
    if (code === "999999") throw new ApiError("OTP_EXPIRED");
    const session: Session = read() ?? { visitor: { id: "demo-visitor", name: "" }, votes: {} };
    write(session);
    return session;
  },
  async getMe() {
    await wait(200);
    return demo === "expired_session" ? null : read();
  },
  async getCatalog() {
    await wait(500);
    if (demo === "server_error") throw new ApiError("SERVER");
    return { categories, makers };
  },
  async castVote({ categoryId, makerId }) {
    await wait(600);
    const session = read();
    if (!session) throw new ApiError("SESSION_EXPIRED");
    if (demo === "closed") throw new ApiError("VOTING_CLOSED");
    if (demo === "vote_fail") throw new ApiError("SERVER");
    if (session.votes[categoryId]) throw new ApiError("ALREADY_VOTED", { votes: session.votes });
    const votes: Votes = { ...session.votes, [categoryId]: makerId };
    write({ ...session, votes });
    return { votes };
  },
};
