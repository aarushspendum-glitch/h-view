const { supabaseRequest } = require('./_utils/supabase');
const { verifyPassword, generateToken } = require('./_utils/auth');
const { setTokenCookie } = require('./_utils/cookies');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const users = await supabaseRequest(
      `users?email=eq.${encodeURIComponent(email)}&select=id,email,password,role,name`
    );
    const user = users && users[0];

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken();
    await supabaseRequest('sessions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        token,
        user_id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      }),
    });

    setTokenCookie(req, res, token);
    return res.status(200).json({ role: user.role, name: user.name });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
};
