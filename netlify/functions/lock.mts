import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { makeLock, passwordMatches, makeToken, tokenValid, cookieFrom, setCookie, clearCookie, blockedFor, countWrong, type Lock } from "../lib/lock.mts";

// Sets the password on a workspace's requests, and checks it.
//
//   POST /api/w/<slug>/unlock  { password }        open the requests on this browser
//   POST /api/w/<slug>/lock    { password }        set or change the password
//   POST /api/w/<slug>/lock    { remove: true }    take the password off

const STORE = "workspaces";
type Doc = { lock?: Lock; [k: string]: any };

const json = (body: unknown, status: number, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: cookie ? { "content-type": "application/json", "set-cookie": cookie } : { "content-type": "application/json" } });

export default async (req: Request, context: Context) => {
  const slug = (context.params.slug || "").trim();
  if (!/^[a-z0-9-]{6,64}$/i.test(slug)) return new Response("not found", { status: 404 });
  const settingUp = new URL(req.url).pathname.endsWith("/lock");

  let body: { password?: string; remove?: boolean };
  try { body = (await req.json()) as typeof body; } catch { return json({ ok: false, error: "bad json" }, 400); }

  const store = getStore({ name: STORE, consistency: "strong" });
  const doc = ((await store.get(`ws/${slug}`, { type: "json" })) as Doc | null) || null;
  const lock = doc?.lock;
  const authed = await tokenValid(lock, slug, cookieFrom(req, slug));

  if (settingUp) {
    // taking the password off, only from a browser that already has it
    if (body.remove) {
      if (!lock) return json({ ok: true, locked: false }, 200);
      if (!authed) return json({ ok: false, error: "open the requests first" }, 403);
      delete doc!.lock;
      await store.setJSON(`ws/${slug}`, doc);
      return json({ ok: true, locked: false }, 200, clearCookie(slug));
    }
    // setting the first password, or changing one from a browser that has it
    if (lock && !authed) return json({ ok: false, error: "open the requests first" }, 403);
    const password = (body.password || "").trim();
    if (password.length < 4) return json({ ok: false, error: "use at least 4 characters" }, 400);
    const next = await makeLock(password);
    await store.setJSON(`ws/${slug}`, { ...(doc || {}), lock: next });
    return json({ ok: true, locked: true, unlocked: true }, 200, setCookie(await makeToken(next, slug), slug));
  }

  // unlocking: this is a guess, so it is counted
  if (!lock) return json({ ok: true, locked: false }, 200);
  const tries = (await store.get(`tries/${slug}`, { type: "json" })) as { n: number; at: number } | null;
  const wait = blockedFor(tries);
  if (wait) return json({ ok: false, error: `too many tries, wait ${Math.ceil(wait / 60000)} minutes` }, 429);

  if (!(await passwordMatches(lock, (body.password || "").trim()))) {
    await store.setJSON(`tries/${slug}`, countWrong(tries));
    return json({ ok: false, error: "that password does not open this" }, 401);
  }
  await store.delete(`tries/${slug}`);
  return json({ ok: true, locked: true, unlocked: true }, 200, setCookie(await makeToken(lock, slug), slug));
};

export const config: Config = { path: ["/api/w/:slug/lock", "/api/w/:slug/unlock"], method: ["POST"] };
