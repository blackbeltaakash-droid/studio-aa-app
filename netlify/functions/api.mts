import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { tokenValid, cookieFrom, type Lock } from "../lib/lock.mts";

// One JSON document per workspace. GET returns it after folding any texts
// waiting in the inbox into the live log. PUT replaces it with what the page sends.
//
// When the workspace has a password, a browser without it is sent only the name and
// the fact that it is locked, and cannot save anything. Texts still arrive in the inbox
// meanwhile, since the webhook does not go through the browser.

const STORE = "workspaces";

type Line = { k: string; t: string; when: string; id?: string };
type Entry = { id: string | number; col: "pending" | "approved" | "done"; page: string; text: string; orig: string; time: string; from?: string; at?: string; images?: string[]; trail?: Line[] };
type Inbox = { kind?: "reply"; entry?: string; text: string; from: string; sid: string; at: string; media?: { key: string; type: string }[] };
type Doc = { artist: string; logo?: string; theme?: unknown; buckets: any[]; entries: Entry[]; next: number; lock?: Lock };

const REQUESTS = "log";

function fresh(slug: string): Doc {
  return {
    artist: slug.split("-")[0] || slug,
    buckets: [{ name: "requests", pinned: true, pages: [{ name: "live log", pid: "log", pinned: true }] }],
    entries: [],
    next: 1,
  };
}

function stamp(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }).toLowerCase();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).toLowerCase();
  return `${day} ${time}`;
}

async function load(slug: string): Promise<Doc> {
  const store = getStore({ name: STORE, consistency: "strong" });
  const doc = ((await store.get(`ws/${slug}`, { type: "json" })) as Doc | null) || fresh(slug);

  const { blobs } = await store.list({ prefix: `inbox/${slug}/` });
  if (blobs.length) {
    const keys = blobs.map((b) => b.key).sort();
    const have = new Set(doc.entries.map((e) => String(e.id)));
    for (const key of keys) {
      const m = (await store.get(key, { type: "json" })) as Inbox | null;
      if (m && m.kind === "reply") {
        // a reply sent by text from the alert phone: a line under the request it answers
        const e = doc.entries.find((x) => String(x.id) === m.entry);
        const id = "r" + m.sid;
        if (e && !(e.trail || []).some((x) => x.id === id)) (e.trail = e.trail || []).push({ k: "reply", t: m.text, when: stamp(m.at), id });
      } else if (m && !have.has("s" + m.sid)) {
        const images = (m.media || []).map((x) => "/media/" + x.key.replace(/^media\//, ""));
        doc.entries.unshift({ id: "s" + m.sid, col: "pending", page: "log", text: m.text || (images.length ? "picture" : ""), orig: "", time: stamp(m.at), from: m.from, at: m.at, images });
      }
      await store.delete(key);
    }
    await store.setJSON(`ws/${slug}`, doc);
  }
  return doc;
}

export default async (req: Request, context: Context) => {
  const slug = (context.params.slug || "").trim();
  if (!/^[a-z0-9-]{6,64}$/i.test(slug)) return new Response("not found", { status: 404 });
  const store = getStore({ name: STORE, consistency: "strong" });

  const stored = await load(slug);
  const lock = stored.lock;
  const hidden = !!lock && !(await tokenValid(lock, slug, cookieFrom(req, slug)));

  if (req.method === "GET") {
    const headers = { "cache-control": "no-store" };
    // an empty but well formed workspace, so the page can draw the lock screen with the name on it
    if (hidden) return Response.json({ artist: stored.artist, theme: stored.theme, buckets: [], entries: [], next: 0, locked: true, unlocked: false }, { headers });
    const { lock: _never, ...rest } = stored;
    return Response.json({ ...rest, locked: !!lock, unlocked: !!lock }, { headers });
  }
  if (req.method === "PUT") {
    if (hidden) return Response.json({ ok: false, error: "this workspace is locked" }, { status: 403 });
    let doc: Doc & { locked?: boolean; unlocked?: boolean };
    try { doc = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
    if (!doc || !Array.isArray(doc.buckets) || !Array.isArray(doc.entries)) return new Response("bad doc", { status: 400 });
    delete doc.locked;
    delete doc.unlocked;
    // the password is only ever changed through /lock, never by saving the page
    if (lock) doc.lock = lock; else delete doc.lock;
    await store.setJSON(`ws/${slug}`, doc);
    return Response.json({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/w/:slug", method: ["GET", "PUT"] };
