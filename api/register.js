const { supabaseRequest } = require('./_utils/supabase');
const { makePasswordRecord, timingSafeEqualStr } = require('./_utils/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, role, name, secret } = req.body || {};

  const expected = process.env.ADMIN_SECRET;
  if (!expected || !timingSafeEqualStr(secret || '', expected)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: 'email, password, role, and name are required' });
  }
  if (role !== 'admin' && role !== 'client') {
    return res.status(400).json({ error: 'role must be "admin" or "client"' });
  }

  try {
    const existing = await supabaseRequest(`users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const passwordRecord = makePasswordRecord(password);
    const inserted = await supabaseRequest('users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ email, password: passwordRecord, role, name }),
    });
    const user = inserted && inserted[0];

    return res.status(200).json({
      success: true,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
};
