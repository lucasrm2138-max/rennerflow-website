// ═══════════════════════════════════════════════════════════════════════
// RennerFlow — Cal.com API proxy (Cloudflare Worker)
//
// Endpoints:
//   GET  /slots?start=ISO&end=ISO&timeZone=America/Los_Angeles
//        → returns available 30-min slots in the range
//
//   POST /book  body: { start, name, email, timeZone, notes? }
//        → creates a booking; Cal.com emails the Google Meet link
//
// Env secrets required in Cloudflare:
//   CAL_API_KEY   — Cal.com API key (Settings → Developer → API keys)
//
// Public config:
//   USERNAME      — Cal.com username ("rennerflow")
//   EVENT_SLUG    — event type slug ("scoping-call")
//   ALLOWED_ORIGINS — domains allowed to call this worker
// ═══════════════════════════════════════════════════════════════════════

const CAL_BASE = "https://api.cal.com/v2";
const USERNAME = "rennerflow";
const EVENT_SLUG = "scoping-call";

const ALLOWED_ORIGINS = [
  "https://rennerflow.com",
  "https://www.rennerflow.com",
  "https://rennerflow-website.pages.dev",
  // dev/preview
  "http://localhost:8000",
  "http://localhost:3000",
  "http://127.0.0.1:8000",
  "null", // file:// in some browsers
];

// ─── CORS helpers ───────────────────────────────────────────────────
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

// ─── Router ─────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    try {
      if (path === "/slots" && request.method === "GET") {
        return await handleSlots(url, env, origin);
      }
      if (path === "/book" && request.method === "POST") {
        return await handleBook(request, env, origin);
      }
      if (path === "/" || path === "/health") {
        return json({ ok: true, service: "rennerflow-booking" }, 200, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || "Internal error" }, 500, origin);
    }
  },
};

// ─── GET /slots ─────────────────────────────────────────────────────
async function handleSlots(url, env, origin) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const timeZone = url.searchParams.get("timeZone") || "America/Los_Angeles";

  if (!start || !end) {
    return json({ error: "Missing start/end query parameters" }, 400, origin);
  }

  const apiUrl = new URL(`${CAL_BASE}/slots`);
  apiUrl.searchParams.set("start", start);
  apiUrl.searchParams.set("end", end);
  apiUrl.searchParams.set("eventTypeSlug", EVENT_SLUG);
  apiUrl.searchParams.set("username", USERNAME);
  apiUrl.searchParams.set("timeZone", timeZone);

  const res = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": "2024-09-04",
      "Content-Type": "application/json",
    },
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    return json(
      { error: "Cal.com slots lookup failed", status: res.status, detail: data },
      res.status,
      origin
    );
  }

  // Normalize response shape:
  //   { data: { "YYYY-MM-DD": [ { start: "ISO" }, ... ] } }
  //   OR { data: [ { start }, ... ] } depending on API version
  const normalized = normalizeSlots(data);
  return json({ slots: normalized, timeZone }, 200, origin);
}

function normalizeSlots(data) {
  const payload = data?.data ?? data;
  if (Array.isArray(payload)) {
    return payload.map((s) => s.start || s).filter(Boolean);
  }
  // Object keyed by date
  const all = [];
  if (payload && typeof payload === "object") {
    for (const day of Object.values(payload)) {
      if (Array.isArray(day)) {
        day.forEach((s) => {
          const t = typeof s === "string" ? s : s.start || s.time;
          if (t) all.push(t);
        });
      }
    }
  }
  return all;
}

// ─── POST /book ─────────────────────────────────────────────────────
async function handleBook(request, env, origin) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400, origin); }

  const { start, name, email, timeZone, notes } = body || {};
  if (!start || !name || !email) {
    return json({ error: "Missing required fields: start, name, email" }, 400, origin);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Invalid email address" }, 400, origin);
  }

  const payload = {
    start,
    attendee: {
      name,
      email,
      timeZone: timeZone || "America/Los_Angeles",
      language: "en",
    },
    eventTypeSlug: EVENT_SLUG,
    username: USERNAME,
  };

  if (notes && typeof notes === "string" && notes.trim()) {
    payload.bookingFieldsResponses = { notes: notes.trim() };
  }

  const res = await fetch(`${CAL_BASE}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": "2024-08-13",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }

  if (!res.ok) {
    return json(
      { error: "Booking failed", status: res.status, detail: data },
      res.status,
      origin
    );
  }

  const booking = data?.data || data;
  return json({
    ok: true,
    booking: {
      id: booking?.id || booking?.uid,
      uid: booking?.uid,
      title: booking?.title,
      start: booking?.start,
      end: booking?.end,
      meetingUrl: booking?.meetingUrl || booking?.location || null,
    },
  }, 200, origin);
}
