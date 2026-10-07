import { useEffect, useRef, useState } from "react";
import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { StateScreen } from "../components/StateScreen";
import { api, errorCode } from "../services/api";
import { demo } from "../services/mock";
import type { AppConfig } from "../services/types";

type Phase =
  | "network"
  | "wrong_network"
  | "ask_location"
  | "locating"
  | "denied"
  | "unavailable"
  | "timeout"
  | "off_site"
  | "error"
  | "ok";

// Two layers: (1) network check (silent, the server compares the request IP with the venue network),
// (2) location check (browser GPS, the server compares the coordinates with the venue radius).
// The decision is always made by the server, never in the browser.
export function OnSiteCheck({
  lang,
  setLang,
  config,
  onBack,
  onVerified,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  config: AppConfig;
  onBack: () => void;
  onVerified: () => void;
}) {
  const t = copy[lang];
  const [phase, setPhase] = useState<Phase>(config.requireNetworkCheck ? "network" : config.requireLocation ? "ask_location" : "ok");
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  const finish = () => {
    setPhase("ok");
  };

  useEffect(() => {
    if (phase !== "network") return;
    let alive = true;
    api
      .checkNetwork()
      .then(() => alive && (config.requireLocation && api.mode === "mock" ? setPhase("ask_location") : finish()))
      .catch((error) => alive && setPhase(errorCode(error) === "OFF_SITE_NETWORK" ? config.requireLocation ? "ask_location" : "wrong_network" : "error"));
    return () => {
      alive = false;
    };
  }, [phase, attempt, config.requireLocation]);

  useEffect(() => {
    if (phase !== "ok" || done.current) return;
    done.current = true;
    const timer = window.setTimeout(onVerified, 1100);
    return () => window.clearTimeout(timer);
  }, [phase, onVerified]);

  const sendLocation = (position: { latitude: number; longitude: number; accuracy: number }) =>
    api
      .checkLocation(position)
      .then(finish)
      .catch((error) => {
        const code = errorCode(error);
        setPhase(code === "OFF_SITE_LOCATION" ? "off_site" : code === "LOCATION_INACCURATE" ? "unavailable" : "error");
      });

  const askLocation = () => {
    setPhase("locating");
    // Demo mode can simulate each browser outcome with ?demo=location_denied|location_unavailable|location_timeout|offsite_location
    const simulated: Record<string, Phase> = { location_denied: "denied", location_unavailable: "unavailable", location_timeout: "timeout", offsite_location: "off_site" };
    if (api.mode === "mock" && simulated[demo]) {
      window.setTimeout(() => setPhase(simulated[demo]), 800);
      return;
    }
    if (api.mode === "mock" && !navigator.geolocation) {
      void sendLocation({ latitude: 0, longitude: 0, accuracy: 10 });
      return;
    }
    if (!navigator.geolocation) {
      setPhase("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        void sendLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      (error) => setPhase(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const retryNetwork = () => {
    setPhase("network");
    setAttempt((value) => value + 1);
  };
  const common = { lang, setLang, onBack };

  if (phase === "network") return <StateScreen {...common} spinner title={t.checkNetTitle} body={t.checkNetBody} />;
  if (phase === "wrong_network")
    return <StateScreen {...common} action={{ label: t.retry, onClick: retryNetwork }} body={t.wrongNetBody} icon="wifi" notes={[t.wrongNetNote]} title={t.wrongNetTitle} tone="blue" />;
  if (phase === "ask_location")
    return <StateScreen {...common} action={{ label: t.allowLoc, onClick: askLocation }} body={t.askLocBody} icon="pin" title={t.askLocTitle} />;
  if (phase === "locating") return <StateScreen {...common} spinner title={t.locating} body={t.checkNetBody} />;
  if (phase === "denied")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.deniedBody} icon="pin" notes={[t.deniedIos, t.deniedAndroid]} title={t.deniedTitle} tone="error" />;
  if (phase === "unavailable")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.unavailBody} icon="pin" title={t.unavailTitle} tone="yellow" />;
  if (phase === "timeout")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.timeoutBody} icon="pin" title={t.timeoutTitle} tone="yellow" />;
  if (phase === "off_site") return <StateScreen {...common} body={t.offSiteBody} icon="pin" title={t.offSiteTitle} tone="error" action={{ label: t.retry, onClick: askLocation }} />;
  if (phase === "error")
    return <StateScreen {...common} action={{ label: t.retry, onClick: config.requireNetworkCheck ? retryNetwork : askLocation }} body={t.serverBody} icon="alert" title={t.serverTitle} tone="error" />;
  return <StateScreen {...common} body={t.siteOkBody} icon="check" title={t.siteOkTitle} tone="success" />;
}
