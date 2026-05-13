# RennerFlow Booking — Deployment Guide

One-time setup. ~10 minutes. Free forever on Cloudflare's Workers free tier.

---

## Step 1 — Get your Cal.com API key

1. Sign in at [cal.com](https://app.cal.com)
2. **Settings → Developer → API Keys**
3. Click **+ Add** → give it a name like `RennerFlow Worker` → **Create**
4. Copy the key (starts with `cal_live_…`). You'll paste it in Step 3. **Don't share it or commit it to git.**

---

## Step 2 — Deploy `worker.js` to Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** (left sidebar)
2. Click **Create → Start with Hello World** (or **Create a Worker**)
3. Name it: `rennerflow-api`
4. Click **Deploy** (the default hello-world code is fine — we'll overwrite it next)
5. Click **Edit code** (top right of the worker page)
6. **Select all the default code and delete it.**
7. Open `worker.js` from this folder on your computer and paste its entire contents into the editor.
8. Click **Save and Deploy**

You now have a worker live at:
```
https://rennerflow-api.<your-cloudflare-subdomain>.workers.dev
```

Copy that URL — you'll need it in Step 4.

---

## Step 3 — Add the Cal.com API key as an environment secret

The Worker reads your API key from a secret so it never ships to the browser.

1. Still in your worker page, click **Settings** (top tab) → **Variables and Secrets**
2. Click **Add variable**
3. **Type:** *Secret* (not "Text" — secrets are encrypted)
4. **Variable name:** `CAL_API_KEY`
5. **Value:** paste the Cal.com key from Step 1 (`cal_live_…`)
6. Click **Save and Deploy**

The Worker now has authenticated access to your Cal.com account.

---

## Step 4 — Wire the website to the Worker

In `index.html`, near the top (inside `<head>`), find this line:

```html
window.RENNERFLOW_API = "https://rennerflow-api.YOUR-CF-SUBDOMAIN.workers.dev";
```

Replace the placeholder with your actual Worker URL from Step 2. Example:

```html
window.RENNERFLOW_API = "https://rennerflow-api.lucasrm.workers.dev";
```

Save and refresh the site. The calendar should load your actual availability.

---

## Step 5 — (Optional but recommended) Custom domain

Host the worker at `api.rennerflow.com` instead of the `*.workers.dev` URL.

1. In your worker → **Settings → Triggers → Custom Domains → Add Custom Domain**
2. Enter: `api.rennerflow.com`
3. Cloudflare auto-creates the DNS record (since rennerflow.com is already on Cloudflare)
4. Update `window.RENNERFLOW_API` in `index.html`:
   ```html
   window.RENNERFLOW_API = "https://api.rennerflow.com";
   ```

Now the booking calls go to `api.rennerflow.com/slots` and `api.rennerflow.com/book` — cleaner for visitors inspecting network requests.

---

## Step 6 — Test end-to-end

1. Open `index.html` in a browser.
2. Scroll to the "Scope a pipeline for your fund" section.
3. The calendar should show your current month with highlighted (available) dates.
4. Click a highlighted date → time slots appear on the right.
5. Click a slot → form appears.
6. Fill name + email + note → **Confirm booking**.
7. Within seconds you should see:
   - The success state ("You're booked.")
   - A confirmation email at the address you entered
   - A Google Meet link in that email
   - The event in your Google Calendar

Delete the test booking from Cal.com when done.

---

## Troubleshooting

**Calendar shows "Booking backend not yet configured"**
You haven't updated `window.RENNERFLOW_API` in `index.html` yet (Step 4).

**Calendar shows "Could not load availability"**
The Worker deployed but the API key is wrong, missing, or the Cal.com event slug doesn't match. Re-check:
- `CAL_API_KEY` secret is set in Cloudflare
- Your Cal.com event type slug is exactly `scoping-call` (case sensitive)
- Your Cal.com username is exactly `rennerflow`

**Booking fails with "Missing required fields"**
Name or email wasn't filled. Shouldn't happen with the form validation — if it does, the HTML may have been edited.

**CORS error in browser console**
You're calling from a domain not in the `ALLOWED_ORIGINS` list in `worker.js`. Open `worker.js`, add your domain to the list, redeploy.

---

## What's where

| File | What it is |
|---|---|
| `index.html` | The website + booking UI |
| `worker.js` | Cloudflare Worker code (paste into Cloudflare dashboard) |
| `DEPLOY.md` | This file |

## Security notes

- Your Cal.com API key lives only in Cloudflare as an encrypted secret. It's never exposed to the browser or the website source.
- The Worker enforces a CORS allowlist — only your own domain (and `localhost` for testing) can call it.
- Inputs are validated server-side (email format, required fields).
- No database. The Worker is stateless. All booking state lives in Cal.com (single source of truth).
