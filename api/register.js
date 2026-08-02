const { supabaseRequest } = require('./_utils/supabase');
const { makePasswordRecord, generateToken, timingSafeEqualStr } = require('./_utils/auth');
const { sendEmail } = require('./_utils/email');
const { requireSession } = require('./_utils/session');

const SITE_URL = 'https://h-view.vercel.app';
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, role, name, secret } = req.body || {};

  // Two factors required, not one: a valid admin session AND the shared
  // secret. Previously ADMIN_SECRET alone was the only gate on an endpoint
  // that can create an admin account -- an unrotated or brute-forced secret
  // was full account-creation access with no session/login required at all.
  const session = await requireSession(req, ['admin']);
  if (!session) return res.status(401).json({ error: 'Admin login required' });

  const expected = process.env.ADMIN_SECRET;
  if (!expected || !timingSafeEqualStr(secret || '', expected)) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!email || !role || !name) {
    return res.status(400).json({ error: 'email, role, and name are required' });
  }
  if (role !== 'admin' && role !== 'client') {
    return res.status(400).json({ error: 'role must be "admin" or "client"' });
  }

  try {
    const existing = await supabaseRequest(`users?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    let userRecord;
    let inviteLink = null;

    if (password) {
      // Direct password set (used for admin accounts / curl-based creation)
      userRecord = { email, password: makePasswordRecord(password), role, name };
    } else {
      // Invite flow: no password yet, client sets their own via emailed link
      const token = generateToken();
      const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      userRecord = {
        email,
        password: '', // no password yet -- verifyPassword() always rejects this, satisfies NOT NULL constraint
        role,
        name,
        invite_token: token,
        invite_expires: expires,
      };
      inviteLink = `${SITE_URL}/set-password?token=${token}`;
    }

    const inserted = await supabaseRequest('users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(userRecord),
    });
    const user = inserted && inserted[0];

    if (inviteLink) {
      await sendEmail({
        to: email,
        subject: 'Set up your H-VIEW account',
        html: `
          <p>Hi ${name},</p>
          <p>An H-VIEW account has been created for you. Click below to set your password and access your device dashboard:</p>
          <p><a href="${inviteLink}">${inviteLink}</a></p>
          <p>This link expires in 48 hours.</p>
        `,
      });
    }

    return res.status(200).json({
      success: true,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
      invited: !!inviteLink,
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Registration failed' });
  }
};
