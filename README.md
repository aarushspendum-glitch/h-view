# H-VIEW

Marketing site for H-VIEW — a stick-on ESP32 + accelerometer/gyro sensor that monitors HVAC vibration in real time over WiFi, auto-calibrates an idle/active baseline over its first 24 hours, and reports live to a dashboard.

Static site (HTML/CSS/JS), no build step, no framework — deploys on Vercel as-is.

## Status

- Request form posts to a live Formspree endpoint (`xnjegzyp`).
- Contact email (aarush.pendum@gmail.com) is wired in.

Formspree requires confirming the first real submission via the email sent to the account owner — do that once after going live so future submissions deliver automatically.

## Local preview

No build tools needed — just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

Push to GitHub, then import the repo in [Vercel](https://vercel.com/new). No framework preset or build command needed — Vercel serves it as a static site automatically.
