const { supabaseRequest } = require('./_utils/supabase');
const { parseCookies, clearTokenCookie } = require('./_utils/cookies');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { hview_token: token } = parseCookies(req);
  if (token) {
    try {
      await supabaseRequest(`sessions?token=eq.${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('logout error:', err);
    }
  }

  clearTokenCookie(req, res);
  return res.status(200).json({ success: true });
};
