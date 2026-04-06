export function formatPhp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeAge(value: string | null | undefined, nowMs: number = Date.now()): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  const diffMs = nowMs - d.getTime();
  if (!Number.isFinite(diffMs)) return "—";
  if (diffMs < 30_000) return "just now";

  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 14) return `${day}d ago`;

  // If it's older, show a compact date (still avoids "fake" hour/minute precision).
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function stripEmojiFromTitle(value: string | null | undefined): string {
  const raw = (value || "").toString();
  if (!raw.trim()) return "Untitled listing";
  const without = raw
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/[\u200D\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return without || "Untitled listing";
}
