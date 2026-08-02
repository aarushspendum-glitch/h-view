const { supabaseRequest } = require('./supabase');
const { parseCookies } = require('./cookies');

// Shared session lookup used by every endpoint that needs an authenticated
// user. Previously latest.js and me.js each hand-rolled this independently,
// which meant the session-expiry check added here only had to be written
// once instead of drifting between copies.
//
// Returns the session object ({ user_id, email, role, name }) on success,
// or null if there's no valid, unexpired session -- or if allowedRoles was
// given and the session's role isn't in it. Callers respond 401 either way;
// this helper doesn't touch `res` itself so it stays usable from any handler.
async function requireSession(req, allowedRoles = null) {
  const { hview_token: token } = parseCookies(req);
  if (!token) return null;

  const sessions = await supabaseRequest(
    `sessions?token=eq.${encodeURIComponent(token)}&select=user_id,email,role,name,expires_at`
  );
  const session = sessions && sessions[0];
  if (!session) return null;

  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    // Expired session row is still sitting in the table -- clean it up so it
    // doesn't accumulate forever, but don't block the response on it.
    supabaseRequest(`sessions?token=eq.${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {});
    return null;
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) return null;

  return session;
}

// Deletes every session row for a given user -- used when a password
// changes, so a credential compromise that already has a live session
// doesn't survive the password reset meant to kick it out.
async function revokeAllSessionsForUser(userId) {
  await supabaseRequest(`sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the cookie's own Max-Age

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

module.exports = { requireSession, revokeAllSessionsForUser, sessionExpiresAt };
