const { supabaseRequest } = require('./_utils/supabase');
const { makePasswordRecord, generateToken } = require('./_utils/auth');
const { setTokenCookie } = require('./_utils/cookies');
const { revokeAllSessionsForUser, sessionExpiresAt } = require('./_utils/session');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const users = await supabaseRequest(
      `users?invite_token=eq.${encodeURIComponent(token)}&select=id,email,role,name,invite_expires`
    );
    const user = users && users[0];
    if (!user) {
      return res.status(400).json({ error: 'Invalid or already-used invite link' });
    }
    if (new Date(user.invite_expires) < new Date()) {
      return res.status(400).json({ error: 'This invite link has expired' });
    }

    await supabaseRequest(`users?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        password: makePasswordRecord(password),
        invite_token: null,
        invite_expires: null,
      }),
    });

    // A password change should invalidate any session created under the old
    // password -- otherwise a compromised-credential scenario survives the
    // very reset meant to end it.
    await revokeAllSessionsForUser(user.id);

    // Log them straight in (with a fresh session, created after the revoke above)
    const sessionToken = generateToken();
    await supabaseRequest('sessions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        token: sessionToken,
        user_id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        expires_at: sessionExpiresAt(),
      }),
    });

    setTokenCookie(req, res, sessionToken);
    return res.status(200).json({ success: true, role: user.role, name: user.name });
  } catch (err) {
    console.error('set-password error:', err);
    return res.status(500).json({ error: 'Failed to set password' });
  }
};
