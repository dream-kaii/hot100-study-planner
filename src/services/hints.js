const MAX_HINT_LEVEL = 4;

function normalizeLevel(value, fallback = 0) {
  const level = Number(value);
  if (!Number.isInteger(level)) return fallback;
  return Math.min(MAX_HINT_LEVEL, Math.max(0, level));
}

function normalizeUsed(value) {
  return normalizeLevel(value, 0);
}

export function getHintLevel(hint, index = 0) {
  return normalizeLevel(typeof hint === "object" && hint !== null ? hint.level : undefined, index + 1);
}

function hintWithLevel(hint, index) {
  const level = getHintLevel(hint, index);
  return { hint, level };
}

function availableHints(hints) {
  if (!Array.isArray(hints)) return [];
  return hints
    .map(hintWithLevel)
    .filter(({ level }) => level > 0)
    .sort((left, right) => left.level - right.level);
}

export function nextHintLevel(hintsUsed = 0, hints = []) {
  const used = normalizeUsed(hintsUsed);
  const next = availableHints(hints).find(({ level }) => level > used);
  return next?.level || 0;
}

export function getVisibleHints(hints = [], hintsUsed = 0) {
  const used = normalizeUsed(hintsUsed);
  return availableHints(hints)
    .filter(({ level }) => level <= used)
    .map(({ hint }) => hint);
}

export function recordHintUsage(progressItem = {}, level, now = new Date()) {
  const requestedLevel = normalizeLevel(level, 0);
  const hintHistory = Array.isArray(progressItem.hintHistory) ? [...progressItem.hintHistory] : [];
  const updated = { ...progressItem, hintHistory };

  if (requestedLevel === 0) return updated;

  const createdAt = now instanceof Date ? new Date(now.getTime()).toISOString() : new Date(now).toISOString();
  const previousLevel = normalizeUsed(progressItem.hintsUsed);
  const lastRecord = hintHistory[hintHistory.length - 1];
  if (lastRecord?.level !== requestedLevel) {
    hintHistory.push({ level: requestedLevel, createdAt });
  }

  updated.hintsUsed = Math.max(previousLevel, requestedLevel);
  updated.lastHintAt = createdAt;
  return updated;
}

export { MAX_HINT_LEVEL };
