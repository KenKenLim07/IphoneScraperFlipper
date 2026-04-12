export const ISSUE_PATTERNS = {
  face_id: {
    not_working: [
      /\b(no|wala|wla)\s+face\s*id\b/i,
      /\bface\s*id\b[^\n]{0,40}\b(not\s*work(?:ing)?|issue|broken|defect|dead|disable|disabled|guba|wala\s+ga\s*work|wala\s+ga?gana)\b/i,
      /\bfaceid\b[^\n]{0,40}\b(not\s*work(?:ing)?|issue|broken|defect|dead|guba|wala\s+ga\s*work|wala\s+ga?gana)\b/i,
      /\b(wala|wla|di)\s+ga\s*(work|gana)\s+face\s*id\b/i,
      /\bface\s*id\b[^\n]{0,20}\b(di|dli|dili)\s*na\s*(?:ga\s*)?(work|gana)\b/i,
      /\b(di|dli|dili)\s*na\s*(?:ga\s*)?(work|gana)\s+face\s*id\b/i,
      /\bface\s*id\b[^\n]{0,40}\b(not\s*available|unavailable|not\s*usable|can't\s*use|cannot\s*use|failed|failure|error)\b/i,
      /\bface\s*id\b[^\n]{0,40}\b(disabled|disable)\b[^\n]{0,24}\b(update|ios)\b/i,
      /\bface\s*id\b[^\n]{0,12}(?:❌|✖️|✗|x|×)/i,
      /(?:❌|✖️|✗)\s*face\s*id\b/i
    ],
    working: [
      /\bface\s*id\b[^\n]{0,40}\b(work(in|ing|s|)?|wrking|okay|ok|functional|gagana|naga\s*gana)\b/i,
      /\b(work(in|ing|s|)?|wrking|okay|ok|functional|gagana|naga\s*gana)\b[^\n]{0,40}\bface\s*id\b/i,
      /\b(all\s*working|allworking)\b[^\n]{0,24}\bface\s*id\b/i,
      /\bface\s*id\b[^\n]{0,24}\b(all\s*working|allworking)\b/i,
      /\b(with|w\/|may)\s*face\s*id\b/i,
      /\bface\s*id\b[^\n]{0,12}(?:✅|✔️|☑️)/i,
      /(?:✅|✔️|☑️)\s*face\s*id\b/i
    ]
  },
  trutone: {
    missing: [
      /\b(no|wala|wla)\s+(?:true\s*tone|trutone|trueton)\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b\s*(?:[:=\-]|is|:)?\s*(?:not\s*work(?:ing)?|dead|off|missing|wala|wala gagana|guba|naguba)\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,40}\b(not\s*work(?:ing)?|dead|off|missing|guba)\b[^\n]{0,24}\b(update|ios)\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,24}\b(due\s+to|after)\s*(?:ios\s*)?update\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,12}(?:❌|✖️|✗|x|×)/i,
      /(?:❌|✖️|✗)\s*(?:true\s*tone|trutone|trueton)\b/i
    ],
    working: [
      /\b(?:true\s*tone|trutone|trueton)\b\s*(?:[:=\-]|is|:)?\s*(?:work(in|ing|s|)?|wrking|okay|ok|functional|on)\b/i,
      /\b(?:work(in|ing|s|)?|wrking|okay|ok|functional|on)\b[^\n]{0,12}\b(?:true\s*tone|trutone|trueton)\b/i,
      /\b(?:all\s*)?working\b[^\n]{0,24}\b(?:true\s*tone|trutone|trueton)\b/i,
      /\b(?:all\s*working|allworking)\b[^\n]{0,24}\b(?:true\s*tone|trutone|trueton)\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,24}\bface\s*id\b[^\n]{0,24}\b(work(in|ing|s|)?|wrking|okay|ok|functional|gagana|naga\s*gana)\b/i,
      /\bface\s*id\b[^\n]{0,24}\b(?:and|&)\b[^\n]{0,12}\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,24}\b(work(in|ing|s|)?|wrking|okay|ok|functional|gagana|naga\s*gana)\b/i,
      /\b(?:work(in|ing|s|)?|wrking|okay|ok|functional|gagana|naga\s*gana)\b[^\n]{0,24}\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,24}\bface\s*id\b/i,
      /\b(with|w\/|may)\s*(?:true\s*tone|trutone|trueton)\b/i,
      /\b(?:true\s*tone|trutone|trueton)\b[^\n]{0,12}(?:✅|✔️|☑️)/i,
      /(?:✅|✔️|☑️)\s*(?:true\s*tone|trutone|trueton)\b/i
    ]
  },
  lcd: {
    negated: [
      /\boriginal\s+lcd\b/i,
      /\borig(?:inal)?\b[^\n]{0,12}\blcd\b/i,
      /\blcd\b[^\n]{0,24}\b(not|never)\s*(?:been\s*)?(?:replac|palit)\w*\b/i,
      /\b(not|never)\s*(?:been\s*)?(?:replac|palit)\w*\b[^\n]{0,24}\blcd\b/i,
      /\borig\b[^\n]{0,24}\blcd\b[^\n]{0,24}\bnot\s*replac\w*\b/i
    ],
    incell: [/\bincell\b/i, /\bin-?cell\b/i],
    replaced: [
      /\b(replace|replaced|replacement|palit|pinalitan)\b[^\n]{0,24}\b(lcd|oled|screen|display)\b/i,
      /\b(lcd|oled|screen|display)\b[^\n]{0,24}\b(replace|replaced|replacement|palit|pinalitan)\b/i,
      /\b(replaced)\s+(oled|lcd)\b/i,
      /\bpalit\s+(oled|lcd)\b/i
    ]
  },
  back_glass: {
    replaced: [
      /\bback\s*glass\b[^\n]{0,40}\b(replace|replaced|replacement|palit|pinalitan)\b/i,
      /\breplaced\s+back\s*glass\b/i
    ],
    cracked: [
      /\bcrack(?:ed)?\b[^\n]{0,24}\bback\s*glass\b/i,
      /\bback\s*glass\b[^\n]{0,24}\bcrack(?:ed)?\b/i,
      /\bcracked\s+back\s*glass\b/i,
      /\bcracked\s+backglass\b/i,
      /\bbackglass\b[^\n]{0,24}\bcrack(?:ed)?\b/i,
      /\bbasag\b[^\n]{0,24}\bback\s*glass\b/i,
      /\bback\s*glass\b[^\n]{0,24}\bbasag\b/i
    ]
  },
  camera: {
    ok: [
      /\bcamera\b[^\n]{0,20}\b(ok|okay|working|functional|good|good\s+quality|clear)\b/i,
      /\b(ok|okay|working|functional|good|good\s+quality|clear)\b[^\n]{0,20}\bcamera\b/i,
      /\bcamera\b[^\n]{0,12}(?:✅|✔️|☑️)/i,
      /(?:✅|✔️|☑️)\s*camera\b/i
    ],
    issue: [
      /\bcamera\b[^\n]{0,12}\b(issue|problem|broken|not\s*work(?:ing)?|blur|fog|defect)\b/i,
      /\b(issue|problem|broken|not\s*work(?:ing)?|blur|fog|defect)\b[^\n]{0,12}\bcamera\b/i,
      /\bno\s+camera\b/i
    ]
  },
  screen: {
    issue: [
      /\bscreen\b[^\n]{0,40}\b(issue|problem|broken|lines|green|pink|flicker|burn|dead|touch)\b/i,
      /\bghost\s*touch\b/i,
      /\bline(s)?\s+sa\s+screen\b/i
    ]
  },
  network: {
    locked: [
      /\bglobe\s*lock\b/i,
      /\bsmart\s*lock\b/i,
      /\btnt\s*lock\b/i,
      /\bsim\s*lock\b/i,
      /\bnetwork\s*lock\b/i,
      /\blocked\s+to\s+(globe|smart|tnt)\b/i,
      /\b(globe|smart|tnt)\b[^\n]{0,18}\bonly\b/i,
      /\b(globe|smart|tnt)\b[^\n]{0,18}\bonly\s*sim\b/i,
      /\bsmart\s*tnt\b[^\n]{0,18}\bonly\b/i
    ]
  },
  wifi: {
    only: [
      /\bwi[-\s]?fi\b[^\n]{0,16}\bonly\b/i,
      /\bwi[-\s]?fi\b[^\n]{0,16}\buse\s*only\b/i,
      /\bwi[-\s]?fi\b[^\n]{0,16}\blang\b/i
    ]
  },
  battery: {
    replaced: [
      /\bbattery\b[^\n]{0,24}\b(replace|replaced|replacement|palit|pinalitan)\b/i,
      /\b(replace|replaced|replacement|palit|pinalitan)\b[^\n]{0,24}\bbattery\b/i
    ]
  },
  icloud: {
    explicitly_clean: [
      /\b(clean|clear)\s+icloud\b/i,
      /\bicloud\s+(clean|clear|ready|ok)\b/i,
      /\bno\s+icloud\b/i,
      /\bicloud\s+ready\s+to\s+(sign\s*in|use)\b/i
    ],
    forgot_pass: [
      /\b(nalimtan|nalipatan|nalipat|nalimot|nakalimtan|nakalimot)\b[^\n]{0,24}\b(pass|password)\b[^\n]{0,24}\bicloud\b/i,
      /\b(pass|password)\b[^\n]{0,16}\bsa\b[^\n]{0,8}\bicloud\b/i,
      /\bforgot(?:ten)?\b[^\n]{0,24}\b(pass|password)\b[^\n]{0,24}\bicloud\b/i
    ],
    not_safe_reset: [/\bnot\s+safe\s+to\s+reset\b/i],
    activation_lock: [/\bactivation\s+lock\b/i],
    icloud_lock: [/\b(icloud)\b[^\n]{0,24}\b(lock|locked)\b/i],
    lock_icloud: [/\b(lock|locked)\b[^\n]{0,24}\b(icloud)\b/i],
    icloud_bypass: [/\b(icloud)\b[^\n]{0,24}\b(bypass)\b/i],
    bypass_icloud: [/\b(bypass)\b[^\n]{0,24}\b(icloud)\b/i],
    remove_icloud: [/\b(remove|tanggal|delete)\b[^\n]{0,24}\b(icloud)\b/i]
  }
};

function anyMatch(text, patterns) {
  const s = String(text || "");
  if (!s) return false;
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(s)) return true;
  }
  return false;
}

function detectLcdReplaced(text) {
  const raw = String(text || "");
  if (!raw) return false;

  if (anyMatch(raw, ISSUE_PATTERNS.lcd.negated)) return false;
  if (anyMatch(raw, ISSUE_PATTERNS.lcd.incell)) return true;
  return anyMatch(raw, ISSUE_PATTERNS.lcd.replaced);
}

export function detectIssues(text) {
  const raw = String(text || "");
  const s = raw.toLowerCase();
  if (!raw) {
    return {
      face_id_working: null,
      face_id_not_working: false,
      trutone_working: null,
      trutone_missing: false,
      lcd_replaced: false,
      back_glass_replaced: false,
      camera_issue: false,
      screen_issue: false,
      network_locked: false,
      wifi_only: false
    };
  }

  const faceIdNo = anyMatch(raw, ISSUE_PATTERNS.face_id.not_working);
  const faceIdYes = anyMatch(raw, ISSUE_PATTERNS.face_id.working);

  const faceIdNotWorking = !!faceIdNo;
  const faceIdWorking = !faceIdNo && !!faceIdYes;

  const trueToneNo = anyMatch(raw, ISSUE_PATTERNS.trutone.missing);
  const trueToneYes = anyMatch(raw, ISSUE_PATTERNS.trutone.working);
  const trueToneMissing = !!trueToneNo;
  const trueToneWorking = !trueToneNo && !!trueToneYes;

  const lcdReplaced = detectLcdReplaced(raw);

  const backGlassReplaced = anyMatch(raw, ISSUE_PATTERNS.back_glass.replaced);
  const backGlassCracked = anyMatch(raw, ISSUE_PATTERNS.back_glass.cracked);

  const cameraOk = anyMatch(raw, ISSUE_PATTERNS.camera.ok);
  const cameraIssue = anyMatch(raw, ISSUE_PATTERNS.camera.issue) && !cameraOk;

  const screenIssue = anyMatch(raw, ISSUE_PATTERNS.screen.issue);

  const networkLocked = anyMatch(raw, ISSUE_PATTERNS.network.locked);

  const wifiOnly = anyMatch(raw, ISSUE_PATTERNS.wifi.only);

  const batteryReplaced = anyMatch(raw, ISSUE_PATTERNS.battery.replaced);

  return {
    face_id_working: faceIdWorking ? true : null,
    face_id_not_working: !!faceIdNotWorking,
    trutone_working: trueToneWorking ? true : null,
    trutone_missing: !!trueToneMissing,
    lcd_replaced: !!lcdReplaced,
    back_glass_replaced: !!backGlassReplaced,
    back_glass_cracked: !!backGlassCracked,
    battery_replaced: !!batteryReplaced,
    camera_issue: !!cameraIssue,
    screen_issue: !!screenIssue,
    network_locked: !!networkLocked,
    wifi_only: !!wifiOnly
  };
}

export function hasIcloudRisk(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return false;

  const explicitlyClean =
    anyMatch(s, ISSUE_PATTERNS.icloud.explicitly_clean);

  if (anyMatch(s, ISSUE_PATTERNS.icloud.forgot_pass)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.not_safe_reset)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.activation_lock)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.icloud_lock)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.lock_icloud)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.icloud_bypass)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.bypass_icloud)) return true;
  if (anyMatch(s, ISSUE_PATTERNS.icloud.remove_icloud)) return true;

  if (explicitlyClean) return false;
  return false;
}
