const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const REQUEST_TIMEOUT_MS = 10_000;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_KEY env vars are not set');
  }

  // Without this, a hung Supabase call rides the platform's own kill timer
  // (tens of seconds) instead of failing fast -- every caller inherits a
  // bounded worst case instead.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Supabase ${res.status}: ${text}`);
    err.status = res.status;
    // Postgres unique-violation code, surfaced by PostgREST in the response
    // body -- callers that need to distinguish "duplicate row" from other
    // failures (e.g. register.js's email-conflict handling) can check this
    // instead of string-matching the raw error text.
    try {
      err.code = JSON.parse(text).code;
    } catch {
      // body wasn't JSON -- leave err.code undefined
    }
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { supabaseRequest };
