export const LISTING_ID_RE = /\/marketplace\/item\/(\d+)/;
export const PRICE_RE =
  /((?:\u20b1|PHP|\$)\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s*(?:PHP))/i;
export const TITLE_NOISE_RE =
  /(?:\b\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|wk|week|weeks|mo|month|months)\b|\bkm away\b|^sponsored$|^boosted$)/i;
export const LISTED_IN_RE = /listed .+ in (.+)$/i;
export const LOCATION_LINE_RE = /.+,\s*PH-\d{2}$/i;

export const DETAIL_STOP_RE =
  /(location is approximate|seller information|seller details|today's picks|similar items|message seller|send seller a message)/i;
export const DETAIL_NOISE_RE = /^(details|detail|save|share|message|send|listed .+ in .+|location)$/i;

export const MARKETPLACE_SELECTOR = "a[href*='/marketplace/item/']";
export const NETWORK_MAX_ITEMS = 200;

