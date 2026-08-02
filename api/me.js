const { requireSession } = require('./_utils/session');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });

    return res.status(200).json({
      userId: session.user_id,
      email: session.email,
      role: session.role,
      name: session.name,
    });
  } catch (err) {
    console.error('me error:', err);
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
};
