const NEG_TOKENS = new Set([
  "no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay",
  "guba", "bypass", "hidden", "screenburn", "nalimtan",
  "ilis", "isli", "repl", "rep", "pullout", "buka", "basag",
  "issue", "problem", "broken", "defect", "dead", "disabled", "error", "fail", "failed"
]);

const POS_TOKENS = new Set([
  "working", "work", "ok", "okay", "good", "goods", "gagana", "naga", "gana",
  "hamis", "hamis2", "makinis", "orig", "original", "clean", "fresh", "unli",
  "tanan", "lahat"
]);

const ALL_WORKING_PHRASES = [
  "all working",
  "working tanan",
  "working lahat",
  "okay lahat",
  "ok lahat",
  "all goods"
];

const FEATURE_RULES = {
  face_id: {
    sequences: [["face", "id"]],
    singles: ["faceid", "face_id"],
    collapsed: ["faceid", "face_id"],
    positives: ["with", "may", "working", "ok", "okay", "gagana"],
    negatives: ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay", "guba", "issue", "problem", "broken", "defect", "dead", "disabled"],
    allowFallbackWorking: true
  },
  trutone: {
    sequences: [["true", "tone"]],
    singles: ["truetone", "trueton", "trutone", "trueton"],
    collapsed: ["truetone", "trueton", "trutone"],
    positives: ["working", "ok", "okay", "on", "gagana"],
    negatives: ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay", "missing", "off", "dead", "guba"],
    allowFallbackWorking: true
  },
  camera: {
    sequences: [["camera"]],
    singles: ["camera"],
    collapsed: ["camera"],
    positives: ["working", "ok", "okay", "clear", "good"],
    negatives: ["issue", "problem", "broken", "defect", "dead", "blur", "fog"],
    allowFallbackWorking: false
  },
  screen: {
    sequences: [["screen"]],
    singles: ["screen", "display"],
    collapsed: ["screen", "display"],
    positives: [],
    negatives: ["issue", "problem", "broken", "lines", "green", "pink", "flicker", "burn", "dead", "touch", "ghost"],
    allowFallbackWorking: false
  },
  lcd: {
    sequences: [["lcd"]],
    singles: ["lcd", "oled", "display"],
    collapsed: ["lcd", "oled", "display"],
    positives: ["orig", "original"],
    negatives: ["replace", "replaced", "replacement", "palit", "pinalitan", "ilis", "isli", "pullout", "incell"],
    allowFallbackWorking: false
  },
  back_glass: {
    sequences: [["back", "glass"]],
    singles: ["backglass", "back_glass", "glass"],
    collapsed: ["backglass", "backglass", "glass"],
    positives: [],
    negatives: ["crack", "cracked", "buka", "basag", "replace", "replaced", "replacement", "palit", "pinalitan"],
    allowFallbackWorking: false
  },
  network: {
    sequences: [["network"], ["sim", "lock"], ["network", "lock"]],
    singles: ["lock", "locked", "simlock"],
    collapsed: ["networklock", "simlock"],
    positives: [],
    negatives: ["lock", "locked", "globe", "smart", "tnt"],
    allowFallbackWorking: false
  },
  wifi_only: {
    sequences: [["wifi", "only"], ["wi", "fi"]],
    singles: ["wifi", "wifionly"],
    collapsed: ["wifionly"],
    positives: [],
    negatives: ["only"],
    allowFallbackWorking: false
  },
  battery: {
    sequences: [["battery"], ["batt"]],
    singles: ["battery", "batt"],
    collapsed: ["battery", "batt"],
    positives: [],
    negatives: ["replace", "replaced", "replacement", "palit", "pinalitan", "ilis", "isli"],
    allowFallbackWorking: false
  }
};

function normalizeLower(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildViews(text) {
  const raw = String(text || "");
  const lower = normalizeLower(raw);
  const collapsed = lower.replace(/[^a-z0-9]+/g, "");
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return { raw, lower, collapsed, tokens };
}

function findSequencePositions(tokens, seq) {
  const positions = [];
  if (!seq.length) return positions;
  for (let i = 0; i <= tokens.length - seq.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) {
        ok = false;
        break;
      }
    }
    if (ok) positions.push(i);
  }
  return positions;
}

function findFeaturePositions(tokens, rule) {
  const positions = [];
  for (const seq of rule.sequences || []) {
    positions.push(...findSequencePositions(tokens, seq));
  }
  for (let i = 0; i < tokens.length; i++) {
    if ((rule.singles || []).includes(tokens[i])) positions.push(i);
  }
  return positions;
}

function hasTokenNear(tokens, positions, tokenSet, window = 3) {
  for (const pos of positions) {
    const start = Math.max(0, pos - window);
    const end = Math.min(tokens.length - 1, pos + window);
    for (let i = start; i <= end; i++) {
      if (tokenSet.has(tokens[i])) return true;
    }
  }
  return false;
}

function collapsedHasAny(collapsed, needles) {
  return (needles || []).some((n) => n && collapsed.includes(n));
}

function collapsedHasNegationPrefix(collapsed, feature) {
  const prefixes = ["no", "not", "wala", "wla", "di", "dili", "dli", "indi", "way", "waay"];
  return prefixes.some((p) => collapsed.includes(`${p}${feature}`));
}

function collapsedHasPositiveNear(collapsed, feature, positives) {
  const maxDist = 12;
  const featIdx = collapsed.indexOf(feature);
  if (featIdx === -1) return false;
  for (const p of positives) {
    const idx = collapsed.indexOf(p);
    if (idx === -1) continue;
    if (Math.abs(idx - featIdx) <= maxDist) return true;
  }
  return false;
}

function hasAllWorkingPhrase(lower) {
  return ALL_WORKING_PHRASES.some((p) => lower.includes(p));
}

function evaluateFeature(views, rule) {
  const positions = findFeaturePositions(views.tokens, rule);
  const negSet = new Set([...(rule.negatives || [])]);
  const posSet = new Set([...(rule.positives || [])]);
  const collapsedFeatureHit = collapsedHasAny(views.collapsed, rule.collapsed || []);
  const featureHit = positions.length > 0 || collapsedFeatureHit;

  const negTokenHit = positions.length ? hasTokenNear(views.tokens, positions, negSet, 3) : false;
  const posTokenHit = positions.length ? hasTokenNear(views.tokens, positions, posSet, 3) : false;

  const collapsedNeg =
    featureHit &&
    ((rule.collapsed || []).some((c) => collapsedHasNegationPrefix(views.collapsed, c)) ||
      collapsedHasAny(views.collapsed, rule.negatives || []));
  const collapsedPos =
    featureHit &&
    ((rule.collapsed || []).some((c) => collapsedHasPositiveNear(views.collapsed, c, rule.positives || [])) ||
      collapsedHasAny(views.collapsed, rule.positives || []));

  const negative = negTokenHit || collapsedNeg;
  const positive = !negative && (posTokenHit || collapsedPos);

  return { negative, positive };
}

export function detectIssues(text) {
  const views = buildViews(text);
  if (!views.raw) {
    return {
      face_id_working: null,
      face_id_not_working: false,
      trutone_working: null,
      trutone_missing: false,
      lcd_replaced: false,
      back_glass_replaced: false,
      back_glass_cracked: false,
      battery_replaced: false,
      camera_issue: false,
      screen_issue: false,
      network_locked: false,
      wifi_only: false
    };
  }

  const face = evaluateFeature(views, FEATURE_RULES.face_id);
  const truetone = evaluateFeature(views, FEATURE_RULES.trutone);
  const camera = evaluateFeature(views, FEATURE_RULES.camera);
  const screen = evaluateFeature(views, FEATURE_RULES.screen);
  const lcd = evaluateFeature(views, FEATURE_RULES.lcd);
  const back = evaluateFeature(views, FEATURE_RULES.back_glass);
  const network = evaluateFeature(views, FEATURE_RULES.network);
  const wifi = evaluateFeature(views, FEATURE_RULES.wifi_only);
  const battery = evaluateFeature(views, FEATURE_RULES.battery);

  const allWorking = hasAllWorkingPhrase(views.lower);

  const faceWorking = face.positive ? true : !face.negative && allWorking ? true : null;
  const truetoneWorking = truetone.positive ? true : !truetone.negative && allWorking ? true : null;

  return {
    face_id_working: faceWorking,
    face_id_not_working: !!face.negative,
    trutone_working: truetoneWorking,
    trutone_missing: !!truetone.negative,
    lcd_replaced: !!lcd.negative,
    back_glass_replaced: !!back.negative && views.lower.includes("replace"),
    back_glass_cracked: !!back.negative && (views.lower.includes("crack") || views.lower.includes("buka") || views.lower.includes("basag")),
    battery_replaced: !!battery.negative,
    camera_issue: !!camera.negative,
    screen_issue: !!screen.negative,
    network_locked: !!network.negative,
    wifi_only: !!wifi.negative && views.lower.includes("wifi")
  };
}

export function buildDebugReasons(text) {
  const views = buildViews(text);
  const reasons = {};
  for (const [key, rule] of Object.entries(FEATURE_RULES)) {
    const res = evaluateFeature(views, rule);
    reasons[key] = res;
  }
  return reasons;
}
