import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Serves a picture that came in by text. The key carries the workspace slug, so only someone with the link can guess it.

export default async (req: Request, context: Context) => {
  const slug = context.params.slug || "";
  const id = context.params.id || "";
  if (!/^[a-z0-9-]{6,64}$/i.test(slug) || !/^[A-Za-z0-9-]{1,80}$/.test(id)) return new Response("not found", { status: 404 });
  const store = getStore("workspaces");
  const entry = await store.getWithMetadata(`media/${slug}/${id}`, { type: "arrayBuffer" });
  if (entry === null) return new Response("not found", { status: 404 });
  const type = (entry.metadata && (entry.metadata as any).type) || "image/jpeg";
  return new Response(entry.data, { headers: { "content-type": String(type), "cache-control": "private, max-age=31536000, immutable" } });
};

export const config: Config = { path: "/media/:slug/:id", method: ["GET"] };
