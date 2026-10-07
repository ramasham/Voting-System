import { type ChangeEvent, useState } from "react";
import { type Language } from "../data/config";
import { copy } from "../i18n/copy";
import { countries } from "../data/countries";
import { normalizeDigits } from "../lib/digits";
import { toE164 } from "../lib/phone";
import { errorMessage } from "../lib/errors";
import { api } from "../services/api";
import { Icon } from "../components/Icon";
import { Button } from "../components/Button";
import { TextInput } from "../components/TextInput";
import { BrandHeader } from "../components/BrandHeader";
import { Organizer } from "../components/Organizer";
import { Frame } from "../components/Frame";
import VerificationArtwork from "../components/VerificationArtwork";

export function Registration({
  lang,
  setLang,
  name,
  setName,
  phone,
  setPhone,
  countryIndex,
  setCountryIndex,
  onBack,
  onContinue,
}: {
  lang: Language;
  setLang: (lang: Language) => void;
  name: string;
  setName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  countryIndex: number;
  setCountryIndex: (value: number) => void;
  onBack: () => void;
  onContinue: (info: { e164: string; resendAfterSeconds: number }) => void;
}) {
  const t = copy[lang];
  const eyebrow = "registerEyebrow" in t && typeof t.registerEyebrow === "string" ? t.registerEyebrow : "";
  const title = "registerTitle" in t && typeof t.registerTitle === "string" ? t.registerTitle : "";
  const body = "registerBody" in t && typeof t.registerBody === "string" ? t.registerBody : "";
  const namePlaceholder = "namePlaceholder" in t && typeof t.namePlaceholder === "string" ? t.namePlaceholder : undefined;
  const country = countries[countryIndex];
  const [errors, setErrors] = useState({ name: false, phone: false });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = countries.filter((item) =>
    `${item.ar} ${item.en} ${item.dial}`.toLowerCase().includes(query.toLowerCase()),
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const e164 = toE164(country.dial, phone); // validated per country, stored as E.164
    const nextErrors = {
      name: name.trim().length < 2, // any name works: first name only, or two or three names
      phone: e164 === null,
    };
    setErrors(nextErrors);
    setSubmitError("");
    if (nextErrors.name || !e164) return;
    setBusy(true);
    try {
      const { resendAfterSeconds } = await api.sendOtp({ name: name.trim(), phone: e164 });
      onContinue({ e164, resendAfterSeconds });
    } catch (error) {
      setSubmitError(errorMessage(lang, error));
    } finally {
      setBusy(false);
    }
  };
  const handlePhone = (event: ChangeEvent<HTMLInputElement>) => {
    const localNumber = normalizeDigits(event.target.value).replace(/\D/g, "").replace(/^0/, "");
    setPhone(localNumber.slice(0, country.length));
    setErrors((current) => ({ ...current, phone: false }));
  };
  return (
    <Frame lang={lang} screen="register">
      <main className="flow-page auth-page auth-page--register">
        <div className="auth-hero brand-surface">
          <BrandHeader
            lang={lang}
            onBack={onBack}
            onLanguage={() => setLang(lang === "ar" ? "en" : "ar")}
          />
          <VerificationArtwork variant="phone" />
          {(eyebrow || title || body) && (
            <div className="auth-heading">
              {eyebrow && <span className="eyebrow eyebrow--gold">{eyebrow}</span>}
              {title && <h1>{title}</h1>}
              {body && <p>{body}</p>}
            </div>
          )}
        </div>
        <div className="auth-surface">
          <form className="form-panel" onSubmit={submit}>
            <div className="field">
              <label htmlFor="registration-name">{t.fullName}</label>
              <TextInput
                id="registration-name"
                aria-describedby={errors.name ? "registration-name-error" : undefined}
                aria-invalid={errors.name}
                autoComplete="name"
                maxLength={60}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: false }));
                }}
                placeholder={namePlaceholder}
                value={name}
              />
              {errors.name && <small className="field-error" id="registration-name-error">{t.nameError}</small>}
            </div>
            <div className="field">
              <label htmlFor="registration-phone">{t.phone}</label>
              <div className={`phone-field ${errors.phone ? "is-error" : ""}`} dir="ltr">
                <Button
                  aria-label={t.countryCode}
                  className="country-trigger"
                  onClick={() => setPickerOpen(true)}
                  type="button"
                  variant="ghost"
                >
                  <img alt="" src={`https://flagcdn.com/${country.code.toLowerCase()}.svg`} />
                  <span>{country.dial}</span>
                  <Icon name="chevron" size={16} />
                </Button>
                <input
                  id="registration-phone"
                  aria-describedby={errors.phone ? "registration-phone-error" : undefined}
                  aria-invalid={errors.phone}
                  autoComplete="tel-national"
                  inputMode="numeric"
                  onChange={handlePhone}
                  placeholder={t.phonePlaceholder}
                  type="tel"
                  value={phone}
                />
              </div>
              {errors.phone && (
                <small className="field-error" id="registration-phone-error">
                  {t.phoneError} {country.length} {t.digits}
                </small>
              )}
            </div>
            {submitError && <small className="field-error centered" role="alert">{submitError}</small>}
            <Button className="auth-submit" disabled={busy} type="submit">
              <span>{busy ? t.sending : t.continue}</span>
              <span className="auth-submit__icon" aria-hidden="true">
                {busy ? <span className="auth-spinner" /> : <span className="flip-rtl"><Icon name="arrow" size={24} /></span>}
              </span>
            </Button>
            <p className="privacy-note"><Icon name="lock" size={16} />{t.privacy}</p>
          </form>
          <Organizer lang={lang} />
        </div>
      </main>
      {pickerOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setPickerOpen(false)}>
          <section
            aria-label={t.chooseCountry}
            aria-modal="true"
            className="sheet country-sheet"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="sheet-handle" />
            <div className="sheet-title-row">
              <h2>{t.chooseCountry}</h2>
              <Button aria-label={t.close} className="close-button" onClick={() => setPickerOpen(false)} variant="ghost">
                <Icon name="close" />
              </Button>
            </div>
            <label className="search-field">
              <Icon name="search" />
              <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={t.searchCountry} value={query} />
            </label>
            <div className="country-list">
              {filtered.map((item) => (
                <Button
                  className="country-option"
                  key={item.code}
                  onClick={() => {
                    setCountryIndex(countries.indexOf(item));
                    setPhone("");
                    setPickerOpen(false);
                    setQuery("");
                  }}
                  variant="ghost"
                >
                  <img alt="" src={`https://flagcdn.com/${item.code.toLowerCase()}.svg`} />
                  <span>{item[lang]}</span>
                  <b dir="ltr">{item.dial}</b>
                </Button>
              ))}
              {!filtered.length && <p className="empty-copy">{t.noCountries}</p>}
            </div>
          </section>
        </div>
      )}
    </Frame>
  );
}
