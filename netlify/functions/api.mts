import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// One JSON document per workspace. GET returns it after folding any texts
// waiting in the inbox into the live log. PUT replaces it with what the page sends.

const STORE = "workspaces";

type Line = { k: string; t: string; when: string; id?: string };
type Entry = { id: string | number; col: "pending" | "approved" | "done"; page: string; text: string; orig: string; time: string; from?: string; at?: string; images?: string[]; trail?: Line[] };
type Inbox = { kind?: "reply"; entry?: string; text: string; from: string; sid: string; at: string; media?: { key: string; type: string }[] };
type Doc = { artist: string; logo?: string; buckets: any[]; entries: Entry[]; next: number };

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

  if (req.method === "GET") {
    return Response.json(await load(slug), { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "PUT") {
    let doc: Doc;
    try { doc = (await req.json()) as Doc; } catch { return new Response("bad json", { status: 400 }); }
    if (!doc || !Array.isArray(doc.buckets) || !Array.isArray(doc.entries)) return new Response("bad doc", { status: 400 });
    await store.setJSON(`ws/${slug}`, doc);
    return Response.json({ ok: true });
  }
  return new Response("method not allowed", { status: 405 });
};

export const config: Config = { path: "/api/w/:slug", method: ["GET", "PUT"] };
