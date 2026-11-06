import type { Config, Context } from "@netlify/functions";

// Sends a text back to the person who made a request, from the Studio Aa number.
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in the project's environment.

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const slug = (context.params.slug || "").trim();
  if (!/^[a-z0-9-]{6,64}$/i.test(slug)) return new Response("not found", { status: 404 });

  let body: { to?: string; text?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const to = (body.to || "").trim();
  const text = (body.text || "").trim();
  if (!/^\+?[0-9]{8,16}$/.test(to) || !text) return Response.json({ ok: false, error: "need a number and a message" }, { status: 400 });

  const sid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const token = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const from = Netlify.env.get("TWILIO_FROM");
  if (!sid || !token || !from) return Response.json({ ok: false, error: "twilio is not set up on this site yet" }, { status: 503 });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${sid}:${token}`), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: text }),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) { console.log("twilio send failed", res.status, data); return Response.json({ ok: false, error: data.message || "send failed" }, { status: 502 }); }
  return Response.json({ ok: true, sid: data.sid });
};

export const config: Config = { path: "/api/w/:slug/reply", method: ["POST"] };
