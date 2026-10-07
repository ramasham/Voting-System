import { useCallback, useEffect, useRef, useState } from "react";
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
  | "blocked"
  | "unavailable"
  | "timeout"
  | "insecure"
  | "inaccurate"
  | "not_ready"
  | "off_site"
  | "error"
  | "ok";

// The server accepts the approved venue network or an accurate location inside
// the venue. Request GPS only when the network cannot verify the visitor.
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
  const [networkVerified, setNetworkVerified] = useState(false);
  const locationPending = useRef(false);
  const locationWasDenied = useRef(false);

  const finish = () => {
    setPhase("ok");
  };

  useEffect(() => {
    if (phase !== "network") return;
    let alive = true;
    api
      .checkNetwork()
      .then(() => {
        if (!alive) return;
        setNetworkVerified(true);
        setPhase("ok");
      })
      .catch((error) => alive && setPhase(errorCode(error) === "OFF_SITE_NETWORK" ? config.requireLocation ? "ask_location" : "wrong_network" : "error"));
    return () => {
      alive = false;
    };
  }, [phase, attempt, config.requireLocation]);

  useEffect(() => {
    if (phase !== "ok") return;
    const timer = window.setTimeout(onVerified, 1100);
    return () => window.clearTimeout(timer);
  }, [phase, onVerified]);

  const askLocation = useCallback(() => {
    if (locationPending.current) return;
    locationPending.current = true;
    setPhase("locating");
    const showResult = (result: Phase) => {
      locationPending.current = false;
      setPhase(result);
    };
    const denyLocation = () => {
      showResult(locationWasDenied.current ? "blocked" : "denied");
      locationWasDenied.current = true;
    };
    const sendLocation = (position: { latitude: number; longitude: number; accuracy: number }) =>
      api
        .checkLocation(position)
        .then(() => showResult("ok"))
        .catch((error) => {
          const code = errorCode(error);
          showResult(code === "OFF_SITE_LOCATION" ? "off_site" : code === "LOCATION_INACCURATE" ? "inaccurate" : code === "LOCATION_NOT_READY" ? "not_ready" : "error");
        });

    // Demo mode can simulate each browser outcome with ?demo=location_denied|location_unavailable|location_timeout|offsite_location
    const simulated: Record<string, Phase> = { location_denied: "denied", location_unavailable: "unavailable", location_timeout: "timeout", offsite_location: "off_site" };
    if (api.mode === "mock" && simulated[demo]) {
      window.setTimeout(() => demo === "location_denied" ? denyLocation() : showResult(simulated[demo]), 800);
      return;
    }
    if (api.mode === "http" && !window.isSecureContext) {
      showResult("insecure");
      return;
    }
    if (api.mode === "mock" && !navigator.geolocation) {
      void sendLocation({ latitude: 0, longitude: 0, accuracy: 10 });
      return;
    }
    if (!navigator.geolocation) {
      showResult("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationWasDenied.current = false;
        if (position.coords.accuracy > 100) {
          showResult("inaccurate");
          return;
        }
        void sendLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
      },
      (error) => error.code === 1 ? denyLocation() : showResult(error.code === 3 ? "timeout" : "unavailable"),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (api.mode !== "http" || (phase !== "denied" && phase !== "blocked") || !navigator.permissions) return;
    let alive = true;
    let permission: PermissionStatus | undefined;
    const retryIfAllowed = () => {
      if (alive && document.visibilityState === "visible" && permission?.state === "granted") askLocation();
    };
    // Browsers can remember a denial. Resume after the visitor allows the site
    // in browser settings; never try to override a saved block or keep prompting.
    void navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (!alive) return;
      permission = status;
      permission.addEventListener("change", retryIfAllowed);
    }).catch(() => {
      // Some browsers do not support querying geolocation permission. Manual retry still works.
    });
    window.addEventListener("focus", retryIfAllowed);
    document.addEventListener("visibilitychange", retryIfAllowed);
    return () => {
      alive = false;
      permission?.removeEventListener("change", retryIfAllowed);
      window.removeEventListener("focus", retryIfAllowed);
      document.removeEventListener("visibilitychange", retryIfAllowed);
    };
  }, [phase, askLocation]);

  const retryNetwork = () => {
    setNetworkVerified(false);
    setPhase("network");
    setAttempt((value) => value + 1);
  };
  const common = {
    lang, setLang, onBack,
    secondary: networkVerified && phase !== "locating" && phase !== "network"
      ? { label: t.continueOnNetwork, onClick: finish } : undefined,
  };

  if (phase === "network") return <StateScreen {...common} spinner title={t.checkNetTitle} body={t.checkNetBody} />;
  if (phase === "wrong_network")
    return <StateScreen {...common} action={{ label: t.retry, onClick: retryNetwork }} body={t.wrongNetBody} icon="wifi" notes={[t.wrongNetNote]} title={t.wrongNetTitle} tone="blue" />;
  if (phase === "ask_location")
    return <StateScreen {...common} action={{ label: t.allowLoc, onClick: askLocation }} body={t.askLocBody} icon="pin" title={t.askLocTitle} />;
  if (phase === "locating") return <StateScreen {...common} spinner title={t.locating} body={t.checkNetBody} />;
  if (phase === "denied" || phase === "blocked")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={networkVerified ? t.deniedNetworkBody : t.deniedBody} icon="pin" notes={[t.deniedBrowser, t.deniedIos, t.deniedAndroid]} title={phase === "blocked" ? t.blockedTitle : t.deniedTitle} tone="error" />;
  if (phase === "unavailable")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.unavailBody} icon="pin" title={t.unavailTitle} tone="yellow" />;
  if (phase === "timeout")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.timeoutBody} icon="pin" title={t.timeoutTitle} tone="yellow" />;
  if (phase === "insecure")
    return <StateScreen {...common} body={t.locationInsecureBody} icon="lock" title={t.locationInsecureTitle} tone="yellow" />;
  if (phase === "inaccurate")
    return <StateScreen {...common} action={{ label: t.retry, onClick: askLocation }} body={t.locationInaccurateBody} icon="pin" title={t.locationInaccurateTitle} tone="yellow" />;
  if (phase === "not_ready")
    return <StateScreen {...common} action={{ label: t.retry, onClick: config.requireNetworkCheck ? retryNetwork : askLocation }} body={t.locationNotReadyBody} icon="pin" title={t.locationNotReadyTitle} tone="yellow" />;
  if (phase === "off_site") return <StateScreen {...common} body={t.offSiteBody} icon="pin" title={t.offSiteTitle} tone="error" action={{ label: t.retry, onClick: askLocation }} />;
  if (phase === "error")
    return <StateScreen {...common} action={{ label: t.retry, onClick: config.requireNetworkCheck ? retryNetwork : askLocation }} body={t.serverBody} icon="alert" title={t.serverTitle} tone="error" />;
  return <StateScreen lang={lang} setLang={setLang} onBack={onBack} body={t.siteOkBody} icon="check" title={t.siteOkTitle} tone="success" />;
}
