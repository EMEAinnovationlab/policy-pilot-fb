// analysisSession.js
// ------------------------------------------------------------
// This file handles short-lived browser session recovery for
// the analysis tool.
//
// What it does:
// - saves the current analysis state in sessionStorage
// - restores it after accidental refresh in the same tab
// - expires saved state after a configurable TTL
// - clears saved state when the user starts over
//
// Why this file exists:
// The app is analysis-first, so the active analysis and its
// follow-up thread are the user's working context.
// This file protects that context against accidental refresh,
// without turning the app into long-term storage.
// ------------------------------------------------------------

const STORAGE_KEY = 'policy-pilot-analysis-session';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function now() {
  return Date.now();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function saveAnalysisSession(state, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!isObject(state)) return;

  const payload = {
    savedAt: now(),
    ttlMs,
    state
  };

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Could not save analysis session:', err);
  }
}

export function loadAnalysisSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const payload = safeParse(raw);
    if (!isObject(payload)) {
      clearAnalysisSession();
      return null;
    }

    const savedAt = Number(payload.savedAt || 0);
    const ttlMs = Number(payload.ttlMs || DEFAULT_TTL_MS);
    const state = payload.state;

    if (!savedAt || !isObject(state)) {
      clearAnalysisSession();
      return null;
    }

    const expired = now() - savedAt > ttlMs;
    if (expired) {
      clearAnalysisSession();
      return null;
    }

    return state;
  } catch (err) {
    console.warn('Could not load analysis session:', err);
    clearAnalysisSession();
    return null;
  }
}

export function clearAnalysisSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear analysis session:', err);
  }
}

export function hasAnalysisSession() {
  return !!loadAnalysisSession();
}