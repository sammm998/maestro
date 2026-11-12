import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const fmt = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (d: string | Date | null | undefined) => (d ? fmt.format(new Date(d)) : "–");

const rel = new Intl.RelativeTimeFormat("sv-SE", { numeric: "auto" });
export function timeAgo(d: string | Date) {
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rel.format(Math.round(s), "second");
  if (abs < 3600) return rel.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rel.format(Math.round(s / 3600), "hour");
  return rel.format(Math.round(s / 86400), "day");
}
