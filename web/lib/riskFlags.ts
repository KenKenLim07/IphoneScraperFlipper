export type ParsedRiskFlags = Record<string, boolean>;

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseRiskFlags(value: unknown): ParsedRiskFlags {
  const raw =
    typeof value === "string"
      ? tryParseJson(value)
      : value && typeof value === "object"
        ? value
        : null;

  if (!raw || typeof raw !== "object") return {};

  const out: ParsedRiskFlags = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
    else if (v === 1) out[k] = true;
    else if (v === 0) out[k] = false;
  }
  return out;
}

export function triStateFromFlags(
  flags: ParsedRiskFlags,
  yesKey: string,
  noKey: string
): "yes" | "no" | "—" {
  if (flags[noKey]) return "no";
  if (flags[yesKey]) return "yes";
  return "—";
}

