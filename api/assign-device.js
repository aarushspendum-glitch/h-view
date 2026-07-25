const { supabaseRequest } = require('./_utils/supabase');
const { timingSafeEqualStr } = require('./_utils/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { deviceId, userEmail, secret } = req.body || {};

  const expected = process.env.ADMIN_SECRET;
  if (!expected || !timingSafeEqualStr(secret || '', expected)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!deviceId || !userEmail) {
    return res.status(400).json({ error: 'deviceId and userEmail are required' });
  }

  try {
    const users = await supabaseRequest(`users?email=eq.${encodeURIComponent(userEmail)}&select=id`);
    const user = users && users[0];
    if (!user) return res.status(404).json({ error: 'No user with that email' });

    await supabaseRequest('devices?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: deviceId, user_id: user.id, name: deviceId }),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('assign-device error:', err);
    return res.status(500).json({ error: 'Failed to assign device' });
  }
};
