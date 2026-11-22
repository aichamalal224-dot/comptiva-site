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

async function ensureCampaignTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS public_ad_campaigns (
      request_id TEXT PRIMARY KEY,
      duration_days INTEGER,
      agreed_price_gnf INTEGER,
      quote_status TEXT NOT NULL DEFAULT 'draft',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      start_date TEXT,
      end_date TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(request_id) REFERENCES public_ad_requests(id) ON DELETE CASCADE
    )
  `).run();
}

async function ensureVideoRenderTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS public_ad_video_renders (
      request_id TEXT PRIMARY KEY,
      render_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      render_url TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(request_id) REFERENCES public_ad_requests(id) ON DELETE CASCADE
    )
  `).run();
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
        await ensureCampaignTable(env);
        await ensureVideoRenderTable(env);
        const result = await env.DB.prepare(
          "SELECT r.id, r.merchant_name, r.business_name, r.phone, r.format, r.description, r.city, r.status, r.admin_note, r.created_at, r.updated_at, c.duration_days, c.agreed_price_gnf, c.quote_status, c.payment_status, c.start_date, c.end_date, v.render_id AS video_render_id, v.status AS video_render_status, v.render_url AS video_render_url, v.error_message AS video_render_error, v.updated_at AS video_render_updated_at FROM public_ad_requests r LEFT JOIN public_ad_campaigns c ON c.request_id = r.id LEFT JOIN public_ad_video_renders v ON v.request_id = r.id ORDER BY r.created_at DESC LIMIT 200"
        ).all();
        return json({ ok: true, requests: result.results || [] }, 200, origin);
      } catch (_) {
        return json({ error: "Lecture des demandes impossible." }, 500, origin);
      }
    }

    const videoMatch = url.pathname.match(/^\/api\/admin\/public-ads\/([a-f0-9-]{36})\/video$/i);
    if (videoMatch && request.method === "POST") {
      if (!(await verifyCreator(request))) return json({ error: "Accès Créateur refusé." }, 401, origin);
      if (!env.CREATOMATE_API_KEY) return json({ error: "La clé Creatomate n'est pas encore installée dans les secrets Cloudflare." }, 503, origin);
      try {
        await ensureVideoRenderTable(env);
        const ad = await env.DB.prepare("SELECT id FROM public_ad_requests WHERE id = ?").bind(videoMatch[1]).first();
        if (!ad) return json({ error: "Demande publicitaire introuvable." }, 404, origin);
        const previous = await env.DB.prepare("SELECT render_id, status, render_url FROM public_ad_video_renders WHERE request_id = ?").bind(videoMatch[1]).first();
        if (previous && previous.render_id && ["planned", "processing", "queued", "running", "succeeded"].includes(String(previous.status || "").toLowerCase())) {
          return json({ ok: true, reused: true, render: { id: previous.render_id, status: previous.status, url: previous.render_url || null } }, 200, origin);
        }
      } catch (_) {
        return json({ error: "Le stockage du suivi vidéo est indisponible. Aucune nouvelle vidéo n'a été lancée." }, 503, origin);
      }
      let body;
      try { body = await request.json(); } catch (_) { return json({ error: "Scénario invalide." }, 400, origin); }
      const script = clean(body.script, 12000);
      const scenePattern = /SCÈNE\s+\d+\s*[—-]\s*([^\n]+)\nVisuel\s*:\s*([^\n]+)\nVoix\s*:\s*[«"]([^»"]+)[»"]/g;
      const scenes = [...script.matchAll(scenePattern)].map(match => ({
        title: clean(match[1], 100),
        visual: clean(match[2], 220),
        narration: clean(match[3], 1200)
      })).filter(scene => scene.narration);
      if (!scenes.length) {
        const spoken = [...script.matchAll(/Voix\s*:\s*[«"]([^»"]+)[»"]/g)].map(match => match[1].trim()).filter(Boolean);
        if (spoken.length) scenes.push({ title: "Présentation COMPTIVA", visual: "Votre commerce, toujours sous contrôle.", narration: spoken.join(" ") });
      }
      if (!scenes.length || scenes.reduce((sum, scene) => sum + scene.narration.length, 0) > 7000) {
        return json({ error: "Le scénario doit contenir des scènes avec une phrase « Visuel » et une phrase « Voix », dans une limite totale de 7 000 caractères." }, 400, origin);
      }
      const voiceId = clean(env.CREATOMATE_VOICE_ID || "XrExE9yKIg1WjnnlVkGX", 100);
      const provider = "elevenlabs model_id=eleven_multilingual_v2 voice_id=" + voiceId + " stability=0.75";
      const elements = scenes.map((scene, index) => ({
        type: "composition",
        name: "Scene-" + (index + 1),
        track: 1,
        time: null,
        width: 1280,
        height: 720,
        fill_color: index % 2 ? "#123d70" : "#0b2e59",
        elements: [
          { type: "text", name: "Brand-" + (index + 1), track: 1, time: 0, text: "COMPTIVA", x: "50%", y: "13%", width: "88%", height: "12%", x_alignment: "50%", y_alignment: "50%", font_family: "Montserrat", font_weight: "800", font_size: "5 vmin", fill_color: "#9fd0ff" },
          { type: "text", name: "Scene-Title-" + (index + 1), track: 1, time: 0, text: scene.title, x: "50%", y: "35%", width: "88%", height: "20%", x_alignment: "50%", y_alignment: "50%", font_family: "Montserrat", font_weight: "800", font_size: "7 vmin", fill_color: "#ffffff" },
          { type: "text", name: "Scene-Visual-" + (index + 1), track: 1, time: 0, text: scene.visual, x: "50%", y: "57%", width: "84%", height: "18%", x_alignment: "50%", y_alignment: "50%", font_family: "Montserrat", font_weight: "500", font_size: "3.5 vmin", fill_color: "#d9eaff" },
          { type: "audio", name: "Narration-" + (index + 1), track: 2, time: 0, source: scene.narration, provider },
          { type: "text", name: "Subtitles-" + (index + 1), track: 3, time: 0, width: "90%", height: "18%", x: "50%", y: "88%", x_alignment: "50%", y_alignment: "50%", font_family: "Montserrat", font_weight: "600", font_size: "3.2 vmin", fill_color: "#ffffff", background_color: "rgba(0,0,0,0.45)", background_x_padding: "8%", background_y_padding: "5%", transcript_source: "Narration-" + (index + 1), transcript_effect: "highlight", transcript_split: "line", transcript_maximum_length: 80, transcript_color: "#9fd0ff" }
        ]
      }));
      const renderScript = { output_format: "mp4", width: 1280, height: 720, fill_color: "#0b2e59", elements };
      try {
        const renderResponse = await fetch("https://api.creatomate.com/v2/renders", { method: "POST", headers: { "Authorization": "Bearer " + env.CREATOMATE_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(renderScript) });
        const renderData = await renderResponse.json().catch(() => ({}));
        if (!renderResponse.ok) return json({ error: clean(renderData.hint || renderData.message || renderData.error || "Creatomate a refusé la demande (HTTP " + renderResponse.status + ").", 500) }, 502, origin);
        if (!renderData.id) return json({ error: "Creatomate n'a pas retourné d'identifiant de rendu." }, 502, origin);
        const renderStatus = clean(renderData.status || "planned", 40).toLowerCase();
        const renderUrl = typeof renderData.url === "string" ? renderData.url : null;
        try {
          await env.DB.prepare("INSERT INTO public_ad_video_renders (request_id, render_id, status, render_url, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(request_id) DO UPDATE SET render_id=excluded.render_id, status=excluded.status, render_url=excluded.render_url, error_message=NULL, created_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP")
            .bind(videoMatch[1], renderData.id, renderStatus, renderUrl).run();
        } catch (_) {
          return json({ ok: true, persistenceWarning: true, message: "Le rendu a été lancé, mais son suivi n'a pas pu être enregistré dans D1.", render: { id: renderData.id, status: renderStatus, url: renderUrl } }, 202, origin);
        }
        return json({ ok: true, render: { id: renderData.id, status: renderStatus, url: renderUrl } }, 202, origin);
      } catch (_) { return json({ error: "Impossible de joindre Creatomate. Réessayez plus tard." }, 502, origin); }
    }

    const renderMatch = url.pathname.match(/^\/api\/admin\/video-renders\/([a-f0-9-]{36})$/i);
    if (renderMatch && request.method === "GET") {
      if (!(await verifyCreator(request))) return json({ error: "Accès Créateur refusé." }, 401, origin);
      if (!env.CREATOMATE_API_KEY) return json({ error: "La clé Creatomate n'est pas encore installée dans les secrets Cloudflare." }, 503, origin);
      try {
        await ensureVideoRenderTable(env);
        const renderResponse = await fetch("https://api.creatomate.com/v2/renders/" + renderMatch[1], { headers: { "Authorization": "Bearer " + env.CREATOMATE_API_KEY } });
        const renderData = await renderResponse.json().catch(() => ({}));
        if (!renderResponse.ok) return json({ error: clean(renderData.hint || renderData.message || "Lecture du rendu impossible.", 500) }, 502, origin);
        const renderStatus = clean(renderData.status || "unknown", 40).toLowerCase();
        const renderUrl = typeof renderData.url === "string" ? renderData.url : null;
        const renderError = clean(renderData.error_message || renderData.error || "", 500) || null;
        await env.DB.prepare("UPDATE public_ad_video_renders SET status = ?, render_url = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE render_id = ?")
          .bind(renderStatus, renderUrl, renderError, renderMatch[1]).run();
        return json({ ok: true, render: { id: renderData.id, status: renderStatus, url: renderUrl, error_message: renderError } }, 200, origin);
      } catch (_) { return json({ error: "Impossible de vérifier ou d'enregistrer le rendu Creatomate." }, 502, origin); }
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
      const durationDays = body.durationDays === null || body.durationDays === "" ? null : Number(body.durationDays);
      const agreedPrice = body.agreedPriceGnf === null || body.agreedPriceGnf === "" ? null : Number(body.agreedPriceGnf);
      const quoteStatus = clean(body.quoteStatus, 20) || "draft";
      const paymentStatus = clean(body.paymentStatus, 20) || "pending";
      const startDate = clean(body.startDate, 10);
      const endDate = clean(body.endDate, 10);
      const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (!["new", "in_progress", "done", "refused"].includes(status)) {
        return json({ error: "Statut non autorisé." }, 400, origin);
      }
      if ((durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365)) ||
          (agreedPrice !== null && (!Number.isSafeInteger(agreedPrice) || agreedPrice < 0)) ||
          !["draft", "sent", "accepted", "refused"].includes(quoteStatus) ||
          !["pending", "received"].includes(paymentStatus) ||
          !validDate(startDate) || !validDate(endDate)) {
        return json({ error: "Informations de campagne invalides." }, 400, origin);
      }
      try {
        await ensureCampaignTable(env);
        const result = await env.DB.prepare(
          "UPDATE public_ad_requests SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, adminNote || null, match[1]).run();
        if (!result.meta || result.meta.changes < 1) return json({ error: "Demande introuvable." }, 404, origin);
        await env.DB.prepare(
          "INSERT INTO public_ad_campaigns (request_id, duration_days, agreed_price_gnf, quote_status, payment_status, start_date, end_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(request_id) DO UPDATE SET duration_days=excluded.duration_days, agreed_price_gnf=excluded.agreed_price_gnf, quote_status=excluded.quote_status, payment_status=excluded.payment_status, start_date=excluded.start_date, end_date=excluded.end_date, updated_at=CURRENT_TIMESTAMP"
        ).bind(match[1], durationDays, agreedPrice, quoteStatus, paymentStatus, startDate || null, endDate || null).run();
        return json({ ok: true }, 200, origin);
      } catch (_) {
        return json({ error: "Modification impossible." }, 500, origin);
      }
    }

    return json({ error: "Route introuvable." }, 404, origin);
  }
};
