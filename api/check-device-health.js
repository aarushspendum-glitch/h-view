const { supabaseRequest } = require('./_utils/supabase');
const { sendEmail } = require('./_utils/email');
const { timingSafeEqualStr } = require('./_utils/auth');

const SITE_URL = 'https://h-view.vercel.app';
const SILENCE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const REALERT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours -- don't re-alert on every hourly run

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !timingSafeEqualStr(req.headers['authorization'] || '', `Bearer ${cronSecret}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) {
    console.error('ADMIN_ALERT_EMAIL not set -- skipping device health check');
    return res.status(200).json({ skipped: true });
  }

  try {
    const devices = await supabaseRequest('devices?select=id,name,last_silence_alert_at');
    const now = Date.now();
    const silentDevices = [];

    for (const device of devices || []) {
      const latest = await supabaseRequest(
        `readings?device_id=eq.${encodeURIComponent(device.id)}&select=created_at&order=created_at.desc&limit=1`
      );
      const lastReading = latest && latest[0] ? new Date(latest[0].created_at).getTime() : null;
      if (lastReading === null) continue; // never reported yet -- likely still being installed/paired

      const silentFor = now - lastReading;
      if (silentFor < SILENCE_THRESHOLD_MS) continue; // reporting fine

      const lastAlert = device.last_silence_alert_at ? new Date(device.last_silence_alert_at).getTime() : 0;
      if (now - lastAlert < REALERT_INTERVAL_MS) continue; // already alerted recently

      silentDevices.push({ ...device, lastReading });
    }

    if (silentDevices.length === 0) {
      return res.status(200).json({ success: true, silent: 0 });
    }

    const listHtml = silentDevices
      .map((d) => `<li>${d.name || d.id} — last heard from ${new Date(d.lastReading).toLocaleString()}</li>`)
      .join('');

    await sendEmail({
      to: adminEmail,
      subject: `H-VIEW: ${silentDevices.length} device(s) gone silent`,
      html: `
        <p>The following device(s) haven't sent a reading in over 2 hours:</p>
        <ul>${listHtml}</ul>
        <p><a href="${SITE_URL}/admin">View admin dashboard</a></p>
      `,
    });

    await Promise.all(
      silentDevices.map((d) =>
        supabaseRequest(`devices?id=eq.${encodeURIComponent(d.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_silence_alert_at: new Date().toISOString() }),
        })
      )
    );

    return res.status(200).json({ success: true, silent: silentDevices.length });
  } catch (err) {
    console.error('check-device-health error:', err);
    return res.status(500).json({ error: 'Health check failed' });
  }
};

