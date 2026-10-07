export default function VerificationArtwork({ variant }: { variant: "phone" | "message" }) {
  return (
    <div className="auth-artwork" aria-hidden="true">
      <svg viewBox="0 0 200 160" fill="none">
        <circle cx="100" cy="79" r="62" stroke="white" strokeOpacity=".13" />
        <circle cx="31" cy="91" r="4" stroke="var(--gold-soft)" strokeWidth="1.5" />
        <circle cx="166" cy="40" r="3" fill="var(--gold-soft)" />
        <circle cx="38" cy="42" r="5" fill="var(--gold)" />
        <circle cx="166" cy="118" r="5" stroke="white" strokeOpacity=".45" strokeWidth="1.5" />
        <g stroke="var(--brand-dark)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {variant === "phone" ? (
            <>
              <rect x="66" y="23" width="64" height="115" rx="12" fill="var(--white)" />
              <rect x="73" y="38" width="50" height="83" rx="5" fill="var(--soft)" stroke="none" />
              <path d="M88 30h20" />
              <circle cx="98" cy="130" r="2" fill="var(--brand-dark)" stroke="none" />
              <circle cx="98" cy="66" r="9" fill="var(--gold-soft)" />
              <path d="M82 96v-5a16 16 0 0 1 32 0v5" />
              <path d="M114 55h41a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8h-22l-14 11V95h-5a8 8 0 0 1-8-8V63a8 8 0 0 1 8-8Z" fill="var(--gold-soft)" />
              <path d="M117 69h34M117 79h22" />
            </>
          ) : (
            <>
              <path d="m48 71 52-34 52 34v56H48V71Z" fill="var(--gold)" />
              <rect x="70" y="25" width="60" height="82" rx="7" fill="var(--gold-soft)" />
              <path d="M90 36h20" strokeOpacity=".35" />
              <text x="100" y="66" textAnchor="middle" fill="var(--brand-dark)" stroke="none" fontFamily="Manrope, sans-serif" fontSize="17" fontWeight="800">OTP</text>
              <path d="M85 78h30" strokeOpacity=".35" />
              <path d="m48 71 52 34 52-34v56H48V71Z" fill="var(--white)" />
              <path d="m48 127 36-32m68 32-36-32" />
            </>
          )}
        </g>
      </svg>
    </div>
  );
}
