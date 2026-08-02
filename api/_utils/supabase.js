const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_KEY env vars are not set');
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

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
