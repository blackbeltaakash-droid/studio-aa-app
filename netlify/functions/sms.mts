import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Twilio posts every inbound text here. The text, and any pictures sent with it,
// are dropped into the workspace's inbox; the page picks them up on its next load or poll.

const STORE = "workspaces";

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
  return twiml(Netlify.env.get("REPLY_TEXT") || "");
};

export const config: Config = { path: "/sms", method: ["POST", "GET"] };
