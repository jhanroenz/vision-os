import {
  isCodingTask,
  userOptedOutOfWebResearch,
  isSimpleFilesystemTask,
} from "./codingResearch.js";

/** Questions that need live/current external facts — not answerable from training data alone. */
const EXTERNAL_FACT_PATTERNS = [
  /\b(latest|current|today|recent|now|as of|release date|stable version|version)\b/i,
  /\bwhat'?s?\s+new\b/i,
  /\b(20\d{2})\b/,
  /\b(news|changelog|release notes|what changed)\b/i,
  /\b(price of|population of|weather)\b/i,
];

/** Greeting only — entire message, nothing else. */
const GREETING_ONLY_PATTERNS = [
  /^(?:hi+|hey+|heya+|hello+|yo+|sup+|hiya+|howdy+)(?:\s+(?:there|brother|bro|jarvis|master(?:\s+jan)?))?[\s!.,?]*$/i,
  /^(?:good\s+(?:morning|afternoon|evening|night))[\s!.,?]*$/i,
  /^how(?:'s|\s+are)\s+you(?:\s+doing)?[\s!.,?]*$/i,
  /^(?:what's up|whats up|wassup)[\s!.,?]*$/i,
  /^nice to meet you[\s!.,?]*$/i,
];

const CASUAL_REPLY_PATTERNS = [
  /^(?:that'?s?\s+(?:cool|great|good|nice|awesome|perfect|fine|helpful|amazing)|thanks?(?:\s+you)?|thank you|thx|ok(?:ay)?|got it|nice|cool|perfect|awesome|lol|haha|sure|yep|yeah|yes|no|sounds good|looks good|works for me|will do|understood|noted|appreciate it|good to know|makes sense|i see|fair enough)[!.?\s]*$/i,
];

/** Strip a leading greeting so "hey, find coffee" is judged on the rest. */
const LEADING_GREETING =
  /^(?:hi+|hey+|hello+|yo+|sup+|hiya+|howdy+|good\s+(?:morning|afternoon|evening|night))(?:\s+(?:there|jarvis|master(?:\s+jan)?))?\s*[,!.]?\s*/i;

const SEARCH_INTENT_PATTERNS = [
  /\b(search the web|web search|look up online|google it|search online)\b/i,
  /\b(search for|look up|look for|find out about|find out)\b/i,
  /\b(show me|recommend|where can i find|where to find|where is the nearest)\b/i,
  /\b(near me|nearby|around here|close to me|in my area|in this area)\b/i,
  /\b(latest|current|today|recent|news|weather|release notes|breaking change)\b/i,
  /\b(what is|who is|when did|where is|how much|price of)\b/i,
  /\bwhat'?s?\s+new\b/i,
  /\b(release notes|changelog|what changed)\b/i,
  /\b20\d{2}\b/,
  // "find coffee shops", "find me a plumber" — not "find the handler in my app"
  /\bfind(?:\s+(?:a|an|some|me)\s+\w|\s+\w+\s+(?:near(?:by)?|near me))/i,
];

const CODEBASE_LOOKUP_PATTERNS = [
  /\b(grep|codebase|repo|repository|in my app|in the app|in this project|in the codebase)\b/i,
  /\bfind (?:the )?(?:bug|error|file|function|handler|class|module|component|route|symbol)\b/i,
  /\b(where is .+ (?:defined|implemented|handled))\b/i,
];

function hasCodebaseLookupIntent(message) {
  return CODEBASE_LOOKUP_PATTERNS.some((p) => p.test(message));
}

function messageWithoutLeadingGreeting(message) {
  return String(message ?? "")
    .trim()
    .replace(LEADING_GREETING, "")
    .trim();
}

/** User wants live / web lookup — checked before casual heuristics. */
export function hasSearchIntent(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (hasCodebaseLookupIntent(text)) return false;

  if (SEARCH_INTENT_PATTERNS.some((p) => p.test(text))) return true;

  const afterGreeting = messageWithoutLeadingGreeting(text);
  if (afterGreeting && afterGreeting !== text) {
    if (hasCodebaseLookupIntent(afterGreeting)) return false;
    return SEARCH_INTENT_PATTERNS.some((p) => p.test(afterGreeting));
  }

  return false;
}

/** Single vague words — likely a ping, not a task ("Testing", "test", "ping"). */
const BARE_VAGUE_PING =
  /^(?:testing|test|ping|check|hello|hi|hey|yo|sup)[!.?\s]*$/i;

const CONCRETE_SHORT_TASK =
  /\b(npm|yarn|pnpm|cargo|make)\s+(test|run|build|install)\b|\bnpm test\b/i;

export function isBareVaguePing(message) {
  return BARE_VAGUE_PING.test(String(message ?? "").trim());
}

/** User question likely needs the web (versions, news, current events). */
export function needsExternalFacts(message) {
  const text = String(message ?? "").trim();
  if (!text) return false;
  if (hasCodebaseLookupIntent(text)) return false;
  return EXTERNAL_FACT_PATTERNS.some((p) => p.test(text)) || hasSearchIntent(text);
}

/** Greetings, thanks, and other small talk — no web search. */
export function isCasualChatMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return true;

  if (isBareVaguePing(text)) return true;

  if (hasSearchIntent(text)) return false;
  if (isSimpleFilesystemTask(text)) return false;
  if (isCodingTask(text)) return false;
  if (CONCRETE_SHORT_TASK.test(text)) return false;

  if (GREETING_ONLY_PATTERNS.some((p) => p.test(text))) return true;
  if (CASUAL_REPLY_PATTERNS.some((p) => p.test(text))) return true;

  const afterGreeting = messageWithoutLeadingGreeting(text);
  if (
    afterGreeting &&
    afterGreeting !== text &&
    (GREETING_ONLY_PATTERNS.some((p) => p.test(afterGreeting)) ||
      CASUAL_REPLY_PATTERNS.some((p) => p.test(afterGreeting)))
  ) {
    return true;
  }

  if (text.length <= 48 && !/\?/.test(text)) return true;

  return false;
}

/** Whether web_search should be offered / executed for this user turn. */
export function webSearchAllowed(userMessage, executionProfile = "chat") {
  if (userOptedOutOfWebResearch(userMessage)) return false;
  if (hasSearchIntent(userMessage)) return true;
  if (needsExternalFacts(userMessage)) return true;
  if (isCasualChatMessage(userMessage)) return false;
  if (isCodingTask(userMessage)) return true;
  if (executionProfile === "code" || executionProfile === "research") return true;
  return false;
}

export function webSearchSkipMessage() {
  return (
    "Web search is not needed for casual chat or this message. " +
    "Reply in plain text — do not call web_search."
  );
}
