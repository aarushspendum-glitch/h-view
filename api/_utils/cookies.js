function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function isHttps(req) {
  // VERCEL_ENV is truthy even under local `vercel dev` over plain HTTP,
  // which was marking the cookie Secure and breaking local login (browsers
  // silently drop Secure cookies set over HTTP). x-forwarded-proto reflects
  // the actual scheme the request arrived over, in dev and in prod alike.
  return req.headers['x-forwarded-proto'] === 'https';
}

function setTokenCookie(req, res, token, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `hview_token=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`
  );
}

function clearTokenCookie(req, res) {
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `hview_token=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`
  );
}

module.exports = { parseCookies, setTokenCookie, clearTokenCookie };
