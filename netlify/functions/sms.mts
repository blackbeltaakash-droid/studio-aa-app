import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Twilio posts every inbound text here. The text, and any pictures sent with it,
// are dropped into the workspace's inbox; the page picks them up on its next load or poll.
//
// Alerts: when NOTIFY_TO is set, each request is also texted to that phone, and a text
// from that phone is not filed as a request. It is sent on to the person who asked, from
// the Studio Aa number, and logged under their request as a reply.

const STORE = "workspaces";
const HOUR = 60 * 60 * 1000;

// who to send a reply to: the latest request from each number that has texted in
type Thread = { to: string; slug: string; name: string; entry: string; at: number };
type Threads = Record<string, Thread>;

function digits(n: string) {
  const d = (n || "").replace(/\D/g, "");
  return d.length === 10 ? "1" + d : d;
}

async function sendText(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const token = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const from = Netlify.env.get("TWILIO_FROM");
  if (!sid || !token || !from) return { ok: false, error: "twilio is not set up on this site yet" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${sid}:${token}`), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) { console.log("twilio send failed", res.status, data); return { ok: false, error: data.message || "send failed" }; }
  return { ok: true };
}

// The name an alert starts with. Normally the workspace name; if a second number is texting
// into the same workspace, its last four digits are added so the two can be told apart.
function nameFor(threads: Threads, key: string, slug: string) {
  const base = slug.split("-")[0] || slug;
  const taken = Object.entries(threads).some(([k, t]) => k !== key && t.name.toLowerCase() === base.toLowerCase());
  return taken ? `${base} ${key.slice(-4)}` : base;
}

// A text from the alert phone: send it on to the person it answers.
async function relay(text: string, sid: string) {
  if (!text) return twiml("only words can be sent back for now");
  const store = getStore({ name: STORE, consistency: "strong" });
  const threads = ((await store.get("relay/threads", { type: "json" })) as Threads | null) || {};
  const all = Object.values(threads).sort((a, b) => b.at - a.at);
  if (!all.length) return twiml("no one has texted in yet, so there is no one to reply to");

  // "name: message" picks who it goes to; otherwise it goes to whoever texted last
  let target: Thread | undefined;
  let body = text;
  const named = text.match(/^([^:\n]{1,40}):\s*([\s\S]+)$/);
  if (named) {
    const hit = all.find((t) => t.name.toLowerCase() === named[1].trim().toLowerCase());
    if (hit) { target = hit; body = named[2].trim(); }
  }
  if (!target) {
    // never guess between two people: if someone else also texted in the last hour, ask which
    const others = all.filter((t) => t.to !== all[0].to && Date.now() - t.at < HOUR);
    if (others.length) {
      const names = [all[0], ...others].map((t) => t.name + ":");
      return twiml(`not sent. ${names.length} people texted in the last hour, so start your reply with ${names.join(" or ")}`);
    }
    target = all[0];
  }

  const sent = await sendText(target.to, body);
  if (!sent.ok) return twiml("not sent: " + sent.error);
  await store.setJSON(`inbox/${target.slug}/${Date.now()}-${sid}`, { kind: "reply", entry: target.entry, text: body, sid, at: new Date().toISOString() });
  return twiml("");
}

// A request just came in: remember who to reply to, then text it to the alert phone.
async function alert(owner: string, from: string, slug: string, sid: string, text: string, pictures: number) {
  if (!text && !pictures) return;
  const store = getStore({ name: STORE, consistency: "strong" });
  const threads = ((await store.get("relay/threads", { type: "json" })) as Threads | null) || {};
  const key = digits(from);
  const name = nameFor(threads, key, slug);
  threads[key] = { to: from, slug, name, entry: "s" + sid, at: Date.now() };
  for (const k of Object.keys(threads)) if (Date.now() - threads[k].at > 30 * 24 * HOUR) delete threads[k];
  await store.setJSON("relay/threads", threads);
  const words = text ? `${name}: ${text}${pictures ? " (sent a picture too)" : ""}` : `${name} sent a picture`;
  const sent = await sendText("+" + digits(owner), words);
  if (!sent.ok) console.log("alert not sent", sent.error);
}

function twiml(reply: string) {
  const body = reply
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { headers: { "content-type": "text/xml" } });
}

// Twilio request signature (HMAC-SHA1 of url + sorted form params), checked only when the auth token is set.
async function validSignature(req: Request, params: URLSearchParams) {
  const token = Netlify.env.get("TWILIO_AUTH_TOKEN");
  if (!token) return true;
  const sig = req.headers.get("x-twilio-signature") || "";
  const keys = [...params.keys()].sort();
  let data = req.url;
  for (const k of keys) data += k + (params.get(k) || "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === sig;
}

function slugFor(from: string): string | null {
  const raw = Netlify.env.get("WS_MAP");
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      if (map[from]) return map[from];
    } catch {}
  }
  return Netlify.env.get("DEFAULT_WS") || null;
}

// Pull a picture off Twilio and keep our own copy, so the page never depends on Twilio's media links.
async function fetchMedia(url: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const sid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const token = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const headers: Record<string, string> = {};
  if (sid && token) headers.authorization = "Basic " + btoa(`${sid}:${token}`);
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) { console.log("media fetch failed", res.status, url); return null; }
  return { body: await res.arrayBuffer(), type: res.headers.get("content-type") || "application/octet-stream" };
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const params = new URLSearchParams(await req.text());
  if (!(await validSignature(req, params))) return new Response("bad signature", { status: 403 });

  const from = params.get("From") || "";
  const text = (params.get("Body") || "").trim();
  const sid = params.get("MessageSid") || String(Date.now());
  const numMedia = parseInt(params.get("NumMedia") || "0", 10) || 0;
  if (!text && !numMedia) return twiml("");

  const owner = (Netlify.env.get("NOTIFY_TO") || "").trim();
  if (owner && digits(owner).length >= 8 && digits(from) === digits(owner)) {
    try { return await relay(text, sid); }
    catch (e) { console.log("relay failed", e); return twiml("not sent: something went wrong on the site"); }
  }

  const slug = slugFor(from);
  if (!slug) {
    console.log("no workspace for", from);
    return twiml("");
  }

  const store = getStore(STORE);
  const media: { key: string; type: string }[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params.get(`MediaUrl${i}`);
    const type = params.get(`MediaContentType${i}`) || "";
    if (!url || !type.startsWith("image/")) continue;
    const got = await fetchMedia(url);
    if (!got) continue;
    const key = `media/${slug}/${sid}-${i}`;
    await store.set(key, got.body, { metadata: { type: got.type } });
    media.push({ key, type: got.type });
  }

  await store.setJSON(`inbox/${slug}/${Date.now()}-${sid}`, { text, from, sid, at: new Date().toISOString(), media });
  if (owner && digits(owner).length >= 8) {
    // the request is already filed, so a failed alert must not turn into a failed webhook
    try { await alert(owner, from, slug, sid, text, media.length); } catch (e) { console.log("alert failed", e); }
  }
  return twiml(Netlify.env.get("REPLY_TEXT") || "");
};

export const config: Config = { path: "/sms", method: ["POST", "GET"] };
