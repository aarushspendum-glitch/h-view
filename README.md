# H-VIEW

Marketing site for H-VIEW — a stick-on ESP32 + accelerometer/gyro sensor that monitors HVAC vibration in real time over WiFi, auto-calibrates an idle/active baseline over its first 24 hours, and reports live to a dashboard.

Static site (HTML/CSS/JS), no build step, no framework — deploys on Vercel as-is.

## Before going live

The request form currently posts to a placeholder Formspree endpoint. To make it actually deliver submissions:

1. Create a free form at [formspree.io](https://formspree.io) (or any form backend of your choice).
2. In `index.html`, find `action="https://formspree.io/f/YOUR_FORM_ID"` on the `<form id="requestForm">` and replace `YOUR_FORM_ID` with your real form ID.
3. Swap the placeholder email `hello@h-view.com` (in `index.html`) for the real contact address.

## Local preview

No build tools needed — just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Deploy

Push to GitHub, then import the repo in [Vercel](https://vercel.com/new). No framework preset or build command needed — Vercel serves it as a static site automatically.
