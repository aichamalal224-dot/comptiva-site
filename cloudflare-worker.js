const ALLOWED_ORIGIN = "https://aichamalal224-dot.github.io";
const FIREBASE_PROJECT_ID = "comptiva-6c3cb";
const CREATOR_UID = "ELopCSbMMrSTDEMCzNhchqonGci2";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = null;
let jwksFetchedAt = 0;

function json(data, status = 200, origin = "") {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function b64urlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function decodePart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));
}

async function getJwks() {
  if (jwksCache && Date.now() - jwksFetchedAt < 3600000) return jwksCache;
  const response = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error("Impossible de vérifier le jeton Firebase.");
  jwksCache = await response.json();
  jwksFetchedAt = Date.now();
  return jwksCache;
}

async function verifyCreator(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return false;
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== FIREBASE_PROJECT_ID ||
        claims.iss !== "https://securetoken.google.com/" + FIREBASE_PROJECT_ID ||
        claims.sub !== CREATOR_UID || !claims.exp || claims.exp <= now ||
        (claims.iat && claims.iat > now + 60)) return false;
    const keys = await getJwks();
    const jwk = keys.keys.find(key => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const signingInput = new TextEncoder().encode(parts[0] + "." + parts[1]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64urlToBytes(parts[2]), signingInput);
  } catch (_) {
    return false;
  }
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origine non autorisée." }, 403);
    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "COMPTIVA public API" }, 200, origin);
    }

    if (url.pathname === "/api/public-ads" && request.method === "POST") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 12000) return json({ error: "Demande trop volumineuse." }, 413, origin);
      let body;
      try { body = await request.json(); } catch (_) {
        return json({ error: "Format de demande invalide." }, 400, origin);
      }
      const merchantName = clean(body.merchantName, 100);
      const businessName = clean(body.businessName, 120);
      const phone = clean(body.phone, 40);
      const description = clean(body.description, 1000);
      const city = clean(body.city, 180);
      const format = clean(body.format, 20);
      if (!merchantName || !businessName || !phone || !description ||
          !["poster", "image", "video"].includes(format)) {
        return json({ error: "Veuillez remplir les champs obligatoires." }, 400, origin);
      }
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          "INSERT INTO public_ad_requests (id, merchant_name, business_name, phone, format, description, city, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')"
        ).bind(id, merchantName, businessName, phone, format, description, city || null).run();
        return json({ ok: true, id, status: "new", message: "Votre demande a bien été enregistrée." }, 201, origin);
      } catch (_) {
        return json({ error: "Enregistrement impossible pour le moment. Réessayez plus tard." }, 500, origin);
      }
    }

    if (url.pathname === "/api/admin/public-ads" && request.method === "GET") {
      if (!(await verifyCreator(request))) return json({ error: "Accès Créateur refusé." }, 401, origin);
      try {
        const result = await env.DB.prepare(
          "SELECT id, merchant_name, business_name, phone, format, description, city, status, admin_note, created_at, updated_at FROM public_ad_requests ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json({ ok: true, requests: result.results || [] }, 200, origin);
      } catch (_) {
        return json({ error: "Lecture des demandes impossible." }, 500, origin);
      }
    }

    const match = url.pathname.match(/^\/api\/admin\/public-ads\/([a-f0-9-]{36})$/i);
    if (match && request.method === "PUT") {
      if (!(await verifyCreator(request))) return json({ error: "Accès Créateur refusé." }, 401, origin);
      let body;
      try { body = await request.json(); } catch (_) {
        return json({ error: "Modification invalide." }, 400, origin);
      }
      const status = clean(body.status, 20);
      const adminNote = clean(body.adminNote, 500);
      if (!["new", "in_progress", "done", "refused"].includes(status)) {
        return json({ error: "Statut non autorisé." }, 400, origin);
      }
      try {
        const result = await env.DB.prepare(
          "UPDATE public_ad_requests SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, adminNote || null, match[1]).run();
        if (!result.meta || result.meta.changes < 1) return json({ error: "Demande introuvable." }, 404, origin);
        return json({ ok: true }, 200, origin);
      } catch (_) {
        return json({ error: "Modification impossible." }, 500, origin);
      }
    }

    return json({ error: "Route introuvable." }, 404, origin);
  }
};
