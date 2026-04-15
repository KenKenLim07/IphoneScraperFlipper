const ALLOWED_STORAGE_GB = new Set([64, 128, 256, 512, 1024, 2048]);

function toInt(s) {
  const n = Number.parseInt(String(s || ""), 10);
  return Number.isFinite(n) ? n : null;
}

function looksLikeIphoneContextToken(tok) {
  if (!tok) return false;
  if (tok === "iphone" || tok === "ip") return true;
  if (/^iphone\d{1,2}$/.test(tok)) return true;
  if (/^ip\d{1,2}$/.test(tok)) return true;
  return false;
}

function looksLikeIphoneModelToken(tok) {
  const t = String(tok || "");
  const m = /^(?:iphone|ip)(\d{1,2})$/.exec(t);
  if (!m) return false;
  const n = toInt(m[1]);
  return Number.isFinite(n) && n >= 7 && n <= 20;
}

function looksLikeStorageContextToken(tok) {
  if (!tok) return false;
  return (
    tok === "gb" ||
    tok === "g" ||
    tok === "tb" ||
    tok === "t" ||
    tok === "storage" ||
    tok === "rom" ||
    tok === "memory" ||
    tok === "mem" ||
    tok === "capacity" ||
    tok === "internal" ||
    tok === "space"
  );
}

function normalizeUnitToken(tok) {
  // Accept common suffixes like "gbna"/"gbnga".
  const t = String(tok || "").toLowerCase();
  if (!t) return null;
  if (t === "gb" || t === "g" || t === "tb" || t === "t") return t;
  if (t.startsWith("gb")) return "gb";
  if (t.startsWith("tb")) return "tb";
  if (t.startsWith("g")) return "g";
  if (t.startsWith("t")) return "t";
  return null;
}

function toGb(num, unit) {
  if (!Number.isFinite(num) || num <= 0) return null;
  const u = String(unit || "").toLowerCase();
  if (u === "tb" || u === "t") return num * 1024;
  return num;
}

/**
 * Extract iPhone storage size in GB from free text.
 *
 * Supports:
 * - "256gb", "256 GB", "256gb na", "1tb"
 * - bare sizes like "iphone 13 128" (without "gb") in iPhone context
 *
 * Returns integer GB or null.
 */
export function parseStorageGb(text) {
  const raw = String(text || "");
  if (!raw) return null;

  // Keep it simple: lowercase + tokenization.
  const s = raw.toLowerCase().replace(/[\u00A0\u2007\u202F]/g, " ");
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return null;

  const candidates = [];
  const push = (gb, score, idx) => {
    if (!ALLOWED_STORAGE_GB.has(gb)) return;
    candidates.push({ gb, score, idx });
  };

  // 1) Strong matches: single token forms like "256gb", "256gbna", "1tb"
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const m = /^(\d{1,4})(gb|g|tb|t)(?:na|nga)?$/.exec(tok);
    if (!m) continue;
    const num = toInt(m[1]);
    const unit = m[2];
    const gb = toGb(num, unit);
    if (gb != null) push(gb, 4, i);
  }

  // 2) Strong matches: split tokens like "256" "gb"
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!/^\d{1,4}$/.test(tokens[i])) continue;
    const num = toInt(tokens[i]);
    const unit = normalizeUnitToken(tokens[i + 1]);
    if (!num || !unit) continue;
    const gb = toGb(num, unit);
    if (gb != null) push(gb, 4, i);
  }

  // 3) Weak matches: bare sizes like "iphone 13 128"
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d{2,4}$/.test(tokens[i])) continue;
    const num = toInt(tokens[i]);
    if (!num || !ALLOWED_STORAGE_GB.has(num)) continue;

    // Reject if immediately followed by a unit token (handled above) to avoid duplicates.
    const nextUnit = normalizeUnitToken(tokens[i + 1]);
    if (nextUnit === "gb" || nextUnit === "g" || nextUnit === "tb" || nextUnit === "t") continue;

    let hasIphone = false;
    let hasStorageCtx = false;
    let hasModel = false;

    const start = Math.max(0, i - 3);
    const end = Math.min(tokens.length - 1, i + 3);
    for (let j = start; j <= end; j++) {
      const t = tokens[j];
      if (looksLikeIphoneContextToken(t)) hasIphone = true;
      if (looksLikeStorageContextToken(t)) hasStorageCtx = true;
      if (looksLikeIphoneModelToken(t)) hasModel = true;
      if (/^\d{1,2}$/.test(t)) {
        const n = toInt(t);
        if (n && n >= 7 && n <= 20) hasModel = true;
      }
    }
    // Only accept bare numbers when:
    // - storage context is present ("storage 128"), OR
    // - iPhone model context is present ("iphone 13 128").
    if (!hasStorageCtx && !(hasIphone && hasModel)) continue;

    const score = hasStorageCtx ? 3 : 2;
    push(num, score, i);
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx || b.gb - a.gb);
  return candidates[0].gb;
}
