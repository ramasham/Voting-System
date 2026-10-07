import { type ClipboardEvent, useEffect, useRef, useState } from "react";
import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { normalizeDigits } from "../lib/digits";
import { errorMessage } from "../lib/errors";
import { api } from "../services/api";
import type { Session } from "../services/types";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";

export function OTP({
  lang,
  setLang,
  phone,
  e164,
  name,
  resendAfter,
  onBack,
  onVerified,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  phone: string; // shown to the visitor
  e164: string; // sent to the server
  name: string;
  resendAfter: number;
  onBack: () => void;
  onVerified: (session: Session) => void;
}) {
  const t = copy[lang];
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(resendAfter);
  const [notice, setNotice] = useState("");
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((current) => current - 1), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  const fillCode = (value: string) => {
    const digits = normalizeDigits(value).replace(/\D/g, "").slice(0, 6).split("");
    setCode(Array.from({ length: 6 }, (_, index) => digits[index] ?? ""));
    refs.current[Math.min(digits.length, 5)]?.focus();
    setMessage("");
  };
  const changeDigit = (index: number, value: string) => {
    const digit = normalizeDigits(value).replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    setMessage("");
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (code.join("").length < 6) {
      setMessage(t.otpError);
      return;
    }
    setBusy(true);
    try {
      onVerified(await api.verifyOtp({ phone: e164, code: code.join("") }));
    } catch (error) {
      setMessage(errorMessage(lang, error));
      setBusy(false);
    }
  };
  const resend = async () => {
    setNotice("");
    setMessage("");
    try {
      const { resendAfterSeconds } = await api.sendOtp({ name, phone: e164 });
      setSeconds(resendAfterSeconds);
      setCode(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
      setNotice(t.sent);
    } catch (error) {
      setMessage(errorMessage(lang, error));
    }
  };
  return (
    <Frame lang={lang} screen="otp">
      <main className="flow-page flow-page--white">
        <BrandHeader
          lang={lang}
          light
          onBack={onBack}
          onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
        />
        <form className="otp-panel" onSubmit={submit}>
          <div className="message-icon"><Icon name="message" size={34} /></div>
          <span className="eyebrow">{t.otpEyebrow}</span>
          <h1>{t.otpTitle}</h1>
          <p>{t.otpBody}</p>
          <b className="phone-display" dir="ltr">{phone}</b>
          <div className="otp-inputs" dir="ltr" onPaste={(event: ClipboardEvent) => {
            event.preventDefault();
            fillCode(event.clipboardData.getData("text"));
          }}>
            {code.map((digit, index) => (
              <input
                aria-label={`${index + 1}`}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                inputMode="numeric"
                key={index}
                maxLength={1}
                onChange={(event) => changeDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !code[index] && index > 0) refs.current[index - 1]?.focus();
                }}
                ref={(node) => { refs.current[index] = node; }}
                value={digit}
              />
            ))}
          </div>
          {message && <small className="field-error centered" role="alert">{message}</small>}
          <Button className="wide-button" disabled={busy} type="submit">{busy ? t.verifying : t.verify}</Button>
          <div className="resend-row">
            {seconds > 0 ? (
              <span>{t.resendIn} <b dir="ltr">0:{String(seconds).padStart(2, "0")}</b></span>
            ) : (
              <Button onClick={resend} type="button" variant="ghost">{t.resend}</Button>
            )}
          </div>
          {notice && <p className="success-text">{notice}</p>}
          {api.mode === "mock" && <small className="demo-note">{t.demo}</small>}
        </form>
        <Organizer lang={lang} />
      </main>
    </Frame>
  );
}
