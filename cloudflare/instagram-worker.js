const json = (data, status, origin) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin || "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    }
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";

    if (request.method === "OPTIONS") {
      if (!allowedOrigin || origin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Méthode non autorisée." }, 405, allowedOrigin);
    }

    if (!allowedOrigin || origin !== allowedOrigin) {
      return json({ error: "Origine non autorisée." }, 403, allowedOrigin);
    }

    const authorization = request.headers.get("Authorization") || "";
    const suppliedKey = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!env.UPDATE_KEY || suppliedKey !== env.UPDATE_KEY) {
      return json({ error: "Clé d'accès invalide." }, 401, allowedOrigin);
    }

    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
      return json({ error: "Configuration incomplète." }, 500, allowedOrigin);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON invalide." }, 400, allowedOrigin);
    }

    const artistId = String(body.artist_id || "").trim();
    const status = body.status;
    let username = null;

    if (!/^[A-Za-z0-9_-]{5,100}$/.test(artistId)) {
      return json({ error: "Identifiant artiste invalide." }, 400, allowedOrigin);
    }

    if (!["found", "not_found"].includes(status)) {
      return json({ error: "Statut invalide." }, 400, allowedOrigin);
    }

    if (status === "found") {
      let url;

      try {
        url = new URL(String(body.instagram_url || ""));
      } catch {
        return json({ error: "URL Instagram invalide." }, 400, allowedOrigin);
      }

      if (
        url.protocol !== "https:" ||
        !["instagram.com", "www.instagram.com", "m.instagram.com"]
          .includes(url.hostname.toLowerCase())
      ) {
        return json({ error: "URL Instagram invalide." }, 400, allowedOrigin);
      }

      username = url.pathname.split("/").filter(Boolean)[0] || null;

      if (!username || !/^[A-Za-z0-9._]{1,30}$/.test(username)) {
        return json({ error: "Nom de compte invalide." }, 400, allowedOrigin);
      }
    }

    const endpoint =
      `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/` +
      `${encodeURIComponent(env.GITHUB_REPO)}/dispatches`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "spotify-artists-instagram-worker"
      },
      body: JSON.stringify({
        event_type: "instagram-update",
        client_payload: {
          artist_id: artistId,
          instagram_url: status === "found"
            ? `https://www.instagram.com/${username}/`
            : null,
          instagram_username: username,
          status,
          request_id: crypto.randomUUID()
        }
      })
    });

    if (!response.ok) {
      return json({
        error: `GitHub a refusé la demande (${response.status}).`
      }, 502, allowedOrigin);
    }

    return json({
      accepted: true,
      message: "Demande transmise à GitHub Actions."
    }, 202, allowedOrigin);
  }
};
