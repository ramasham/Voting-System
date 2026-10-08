import { useCallback, useEffect, useState } from "react";
import { type Language } from "./data/config";
import { countries } from "./data/countries";
import { copy } from "./i18n/copy";
import type { Screen } from "./types";
import { api, errorCode, setSessionExpiredHandler } from "./services/api";
import type { ApiErrorCode, AppConfig, Catalog, Session } from "./services/types";
import { StateScreen } from "./components/StateScreen";
import { Welcome } from "./pages/Welcome";
import { OnSiteCheck } from "./pages/OnSiteCheck";
import { Registration } from "./pages/Registration";
import { OTP } from "./pages/OTP";
import { Voting } from "./pages/Voting";
import { ThankYou } from "./pages/ThankYou";

type Blocked = "closed" | "not_started" | "session" | "server" | "offline";

export default function App() {
  const [lang, setLang] = useState<Language>("ar");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [booting, setBooting] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [returningSession, setReturningSession] = useState<Session | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryIndex, setCountryIndex] = useState(0);
  const [e164, setE164] = useState("");
  const [resendAfter, setResendAfter] = useState(30);
  const [votes, setVotes] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const t = copy[lang];

  const enterSession = (session: Session) => {
    setVotes(session.votes);
    if (session.visitor.name) setName(session.visitor.name);
    setScreen(Object.keys(session.votes).length >= 3 ? "thanks" : "voting");
  };

  // First load: voting status + restore the visitor's session (so a refresh keeps their votes).
  const boot = useCallback(async () => {
    setBooting(true);
    setBlocked(null);
    try {
      const nextConfig = await api.getConfig();
      setConfig(nextConfig);
      if (nextConfig.status !== "open") {
        setBlocked(nextConfig.status === "closed" ? "closed" : "not_started");
        return;
      }
      const session = await api.getMe();
      if (session) {
        if (nextConfig.requireNetworkCheck || nextConfig.requirePresentationCheck || nextConfig.requireLocation) {
          setReturningSession(session);
          setScreen("check");
        } else enterSession(session);
      }
    } catch (error) {
      setBlocked(errorCode(error) === "NETWORK" ? "offline" : "server");
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void boot();
    setSessionExpiredHandler(() => setBlocked("session"));
    return () => setSessionExpiredHandler(null);
  }, [boot]);

  const loadCatalog = useCallback(async () => {
    setCatalogState("loading");
    try {
      setCatalog(await api.getCatalog());
      setCatalogState("ready");
    } catch {
      setCatalogState("error");
    }
  }, []);

  useEffect(() => {
    if ((screen === "voting" || screen === "thanks") && !catalog && catalogState !== "error") void loadCatalog();
  }, [screen, catalog, catalogState, loadCatalog]);

  const reset = () => {
    setName("");
    setPhone("");
    setCountryIndex(0);
    setE164("");
    setVotes({});
    setReturningSession(null);
    setBlocked(null);
    setScreen("welcome");
  };
  const unavailable = (code: ApiErrorCode) => {
    if (code === "VOTING_CLOSED") setBlocked("closed");
    else if (code === "VOTING_NOT_STARTED") setBlocked("not_started");
    else setBlocked("session");
  };

  if (booting) return <StateScreen lang={lang} setLang={setLang} spinner title={t.loading} />;

  if (blocked) {
    const common = { lang, setLang };
    if (blocked === "closed") return <StateScreen {...common} body={t.closedBody} icon="lock" title={t.closedTitle} />;
    if (blocked === "not_started") return <StateScreen {...common} body={t.notStartedBody} icon="lock" title={t.notStartedTitle} tone="blue" />;
    if (blocked === "session")
      return <StateScreen {...common} action={{ label: t.startAgain, onClick: reset }} body={t.sessionBody} icon="lock" title={t.sessionTitle} tone="yellow" />;
    if (blocked === "offline")
      return <StateScreen {...common} action={{ label: t.retry, onClick: () => void boot() }} body={t.offlineBody} icon="wifi" title={t.offlineTitle} tone="blue" />;
    return <StateScreen {...common} action={{ label: t.retry, onClick: () => void boot() }} body={t.serverBody} icon="alert" title={t.serverTitle} tone="error" />;
  }

  if (screen === "welcome") {
    const needsCheck = Boolean(config && (config.requireNetworkCheck || config.requirePresentationCheck || config.requireLocation));
    return <Welcome lang={lang} onStart={() => setScreen(needsCheck ? "check" : "register")} setLang={setLang} />;
  }
  if (screen === "check" && config) {
    return <OnSiteCheck config={config} lang={lang} onBack={() => setScreen("welcome")} onVerified={() => {
      if (returningSession) {
        enterSession(returningSession);
        setReturningSession(null);
      } else setScreen("register");
    }} setLang={setLang} />;
  }
  if (screen === "register" || screen === "check") {
    return (
      <Registration
        countryIndex={countryIndex}
        lang={lang}
        name={name}
        onBack={() => setScreen("welcome")}
        onContinue={(info) => {
          setE164(info.e164);
          setResendAfter(info.resendAfterSeconds);
          setScreen("otp");
        }}
        phone={phone}
        setCountryIndex={setCountryIndex}
        setLang={setLang}
        setName={setName}
        setPhone={setPhone}
      />
    );
  }
  if (screen === "otp") {
    return (
      <OTP
        e164={e164}
        lang={lang}
        name={name}
        onBack={() => setScreen("register")}
        onVerified={enterSession}
        phone={`${countries[countryIndex].dial} ${phone}`}
        resendAfter={resendAfter}
        setLang={setLang}
      />
    );
  }
  if (screen === "voting") {
    return (
      <Voting
        catalog={catalog}
        catalogState={catalogState}
        lang={lang}
        onComplete={() => setScreen("thanks")}
        onRetryCatalog={() => void loadCatalog()}
        onUnavailable={unavailable}
        setLang={setLang}
        setVotes={setVotes}
        votes={votes}
      />
    );
  }
  return <ThankYou catalog={catalog} lang={lang} onFinish={reset} setLang={setLang} votes={votes} />;
}
