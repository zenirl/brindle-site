/**
 * Brindle photo Worker — stores sitter-sent photos in Cloudflare R2 instead of
 * base64 inside Firestore docs. Two endpoints:
 *
 *   POST /upload?code=XXXXXXXX   body = JPEG bytes  -> { key, url }
 *   GET  /p/<code>/<id>.jpg                          -> the image
 *
 * Security model (no backend secrets needed):
 *  - Uploads are gated on a valid, non-expired share code, verified against
 *    Firestore via its PUBLIC REST read (shares are world-readable by rule).
 *  - The share code is a high-entropy bearer token, and object keys are
 *    prefixed by it, so only someone holding the link can write under it.
 *  - A hard size cap stops abuse; an R2 lifecycle rule expires objects so
 *    storage never grows unbounded (set separately — see worker/README.md).
 */

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB hard cap per upload

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    // Serve an image: GET /p/<code>/<id>.jpg
    if (request.method === "GET" && url.pathname.startsWith("/p/")) {
      const key = decodeURIComponent(url.pathname.slice(3));
      if (!isValidKey(key)) return new Response("Bad key", { status: 400 });
      // Tie photo visibility to the share's lifecycle: once the owner revokes
      // (or the share expires), the photo 404s immediately — no lingering
      // access via a copied URL. The owner's phone already has its own copy.
      const code = key.slice(0, 8);
      if (!(await shareIsLive(env, code))) return new Response("Not found", { status: 404 });
      const obj = await env.PHOTOS.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      headers.set("Content-Type", obj.httpMetadata?.contentType || "image/jpeg");
      headers.set("Cache-Control", "public, max-age=86400, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(obj.body, { headers });
    }

    // Upload an image: POST /upload?code=XXXXXXXX
    if (request.method === "POST" && url.pathname === "/upload") {
      const code = (url.searchParams.get("code") || "").toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        return withCors(json({ error: "bad code" }, 400), origin);
      }
      if (!(await shareIsLive(env, code))) {
        return withCors(json({ error: "invalid or expired share" }, 403), origin);
      }
      const buf = await request.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        return withCors(json({ error: "bad size" }, 400), origin);
      }
      const id = crypto.randomUUID();
      const key = `${code}/${id}.jpg`;
      await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: "image/jpeg" } });
      return withCors(json({ key, url: `${url.origin}/p/${key}` }, 200), origin);
    }

    return new Response("Brindle photo worker", { status: 200 });
  },
};

/** A share is live if its Firestore doc exists and hasn't expired. */
async function shareIsLive(env, code) {
  try {
    const project = env.FIREBASE_PROJECT || "petlog-zenirl";
    const r = await fetch(
      `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/shares/${code}`
    );
    if (!r.ok) return false; // 404 = no such share
    const doc = await r.json();
    const exp = doc?.fields?.expiresAt?.timestampValue;
    if (exp && new Date(exp).getTime() < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidKey(key) {
  // "<8-char code>/<uuid>.jpg" — no traversal, no surprises.
  return /^[A-Z0-9]{8}\/[a-f0-9-]{36}\.jpg$/.test(key);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withCors(resp, origin) {
  resp.headers.set("Access-Control-Allow-Origin", origin || "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  resp.headers.set("Access-Control-Max-Age", "86400");
  return resp;
}
