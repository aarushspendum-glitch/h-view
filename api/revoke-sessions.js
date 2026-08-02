const { supabaseRequest } = require('./_utils/supabase');
const { timingSafeEqualStr } = require('./_utils/auth');
const { requireSession, revokeAllSessionsForUser } = require('./_utils/session');

// Admin-triggered session revocation -- e.g. a client reports a lost
// device or suspects their account was accessed by someone else, and the
// admin wants to kick out any live session for that account without
// waiting for a password change to do it implicitly.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userEmail, secret } = req.body || {};

  const session = await requireSession(req, ['admin']);
  if (!session) return res.status(401).json({ error: 'Admin login required' });

  const expected = process.env.ADMIN_SECRET;
  if (!expected || !timingSafeEqualStr(secret || '', expected)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!userEmail) return res.status(400).json({ error: 'userEmail is required' });

  try {
    const users = await supabaseRequest(`users?email=eq.${encodeURIComponent(userEmail)}&select=id`);
    const user = users && users[0];
    if (!user) return res.status(404).json({ error: 'No user with that email' });

    await revokeAllSessionsForUser(user.id);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('revoke-sessions error:', err);
    return res.status(500).json({ error: 'Failed to revoke sessions' });
  }
};
