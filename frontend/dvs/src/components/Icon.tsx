import { type ReactNode } from "react";

export function Icon({
  name,
  size = 22,
}: {
  name: "alert" | "arrow" | "check" | "chevron" | "close" | "lock" | "message" | "pin" | "search" | "wifi";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    alert: <><path d="M12 4 3 20h18L12 4Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
    pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    wifi: <><path d="M3 9a14 14 0 0 1 18 0" /><path d="M6 12.5a9 9 0 0 1 12 0" /><path d="M9 16a4.5 4.5 0 0 1 6 0" /><path d="M12 19.5h.01" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    message: <><path d="M4 5h16v12H8l-4 3V5Z" /><path d="m7 9 5 4 5-4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></>,
  };
  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      {paths[name]}
    </svg>
  );
}
