const { supabaseRequest } = require('./_utils/supabase');
const { parseCookies } = require('./_utils/cookies');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { hview_token: token } = parseCookies(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const sessions = await supabaseRequest(
      `sessions?token=eq.${encodeURIComponent(token)}&select=user_id,email,role,name`
    );
    const session = sessions && sessions[0];
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
