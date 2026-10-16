(() => {
  "use strict";

  // ============================================================
  // CONFIGURATION
  // Remplace cette URL par l'URL réelle de ton Cloudflare Worker.
  // ============================================================

  const WORKER_URL = "https://TON-WORKER.TON-COMPTE.workers.dev";

  const SESSION_KEY = "instagram-finder-worker-key";

  // ============================================================
  // ÉTAT
  // ============================================================

  let rawData = null;
  let artists = [];
  let currentArtist = null;
  let isSaving = false;

  const $ = (id) => document.getElementById(id);

  // ============================================================
  // UTILITAIRES
  // ============================================================

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getArtistId(artist) {
    if (!artist) return "";

    if (artist.id) {
      return String(artist.id);
    }

    if (artist.uri) {
      return String(artist.uri).split(":").pop();
    }

    return "";
  }

  function getArtistName(artist) {
    return artist?.name || artist?.artist_name || "Artiste inconnu";
  }

  function getArtistSpotifyURL(artist) {
    if (artist?.url) {
      return artist.url;
    }

    if (artist?.external_urls?.spotify) {
      return artist.external_urls.spotify;
    }

    const id = getArtistId(artist);

    return id
      ? `https://open.spotify.com/artist/${encodeURIComponent(id)}`
      : "https://open.spotify.com/";
  }

  function getInstagramURL(artist) {
    return artist?.instagram_url || "";
  }

  function getInstagramUsername(url) {
    if (!url) return null;

    try {
      const parsed = new URL(url);
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    } catch {
      return null;
    }
  }

  /**
   * Accepte :
   *   nomducompte
   *   @nomducompte
   *   https://www.instagram.com/nomducompte/
   *
   * Retourne une URL normalisée ou une chaîne vide si elle est invalide.
   */
  function normalizeInstagramURL(value) {
    let input = String(value || "").trim();

    if (!input) return "";

    if (input.startsWith("@")) {
      input = input.slice(1);
    }

    if (
      !input.includes("/") &&
      !input.includes(":") &&
      /^[A-Za-z0-9._]{1,30}$/.test(input)
    ) {
      input = `https://www.instagram.com/${input}/`;
    } else if (
      !/^https?:\/\//i.test(input) &&
      !input.includes("instagram.com/")
    ) {
      input = `https://www.instagram.com/${input.replace(/^\/+|\/+$/g, "")}/`;
    }

    try {
      const url = new URL(input);

      const allowedHosts = [
        "instagram.com",
        "www.instagram.com",
        "m.instagram.com"
      ];

      if (url.protocol !== "https:") return "";
      if (!allowedHosts.includes(url.hostname.toLowerCase())) return "";

      const parts = url.pathname.split("/").filter(Boolean);
      const username = parts[0];

      if (!username) return "";

      const reservedNames = [
        "p",
        "reel",
        "reels",
        "stories",
        "explore",
        "accounts",
        "direct",
        "about",
        "developer"
      ];

      if (reservedNames.includes(username.toLowerCase())) {
        return "";
      }

      if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
        return "";
      }

      return `https://www.instagram.com/${username}/`;
    } catch {
      return "";
    }
  }

  function getArtistList(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data?.artists)) {
      return data.artists;
    }

    if (data?.artists && typeof data.artists === "object") {
      return Object.values(data.artists);
    }

    return [];
  }

  function getArtistStatus(artist) {
    return artist?.instagram_status || "";
  }

  function isAlreadyProcessed(artist) {
    const status = getArtistStatus(artist);

    return Boolean(
      artist?.instagram_url ||
      status === "found" ||
      status === "not_found"
    );
  }

  function getPendingArtists() {
    return artists
      .filter((artist) => !isAlreadyProcessed(artist))
      .sort((a, b) =>
        getArtistName(a).localeCompare(
          getArtistName(b),
          "fr",
          { sensitivity: "base" }
        )
      );
  }

  function setMessage(message, type = "info") {
    const element = $("instagram-finder-message");

    if (!element) return;

    element.textContent = message;
    element.className = `instagram-finder-message ${type}`;
    element.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function setSavingState(saving) {
    isSaving = saving;

    document
      .querySelectorAll("[data-instagram-action]")
      .forEach((button) => {
        button.disabled = saving;
      });

    const saveButton = $('[data-instagram-action="save"]');

    if (saveButton) {
      saveButton.textContent = saving
        ? "⏳ Enregistrement…"
        : "✓ Enregistrer et suivant";
    }

    const skipButton = $('[data-instagram-action="skip"]');

    if (skipButton) {
      skipButton.textContent = saving
        ? "Envoi en cours…"
        : "⏭ Pas trouvé, suivant";
    }
  }

  // ============================================================
  // AUTHENTIFICATION DU WORKER
  // La clé est conservée dans sessionStorage, pas dans localStorage.
  // ============================================================

  function getWorkerKey() {
    let key = sessionStorage.getItem(SESSION_KEY);

    if (key) return key;

    key = window.prompt(
      "Entre la clé d'accès à la sauvegarde Instagram :"
    );

    if (!key || !key.trim()) {
      return "";
    }

    key = key.trim();
    sessionStorage.setItem(SESSION_KEY, key);

    return key;
  }

  // ============================================================
  // SAUVEGARDE DISTANTE
  // ============================================================

  async function sendInstagramUpdate(artist, instagramURL, status) {
    if (
      !WORKER_URL ||
      WORKER_URL.includes("TON-WORKER") ||
      WORKER_URL.includes("TON-COMPTE")
    ) {
      throw new Error(
        "Le Worker n'est pas configuré. " +
        "Modifie WORKER_URL au début de instagram-finder.js."
      );
    }

    const artistId = getArtistId(artist);

    if (!artistId) {
      throw new Error(
        "Impossible de trouver l'identifiant Spotify de cet artiste."
      );
    }

    const accessKey = getWorkerKey();

    if (!accessKey) {
      throw new Error("Sauvegarde annulée : clé d'accès manquante.");
    }

    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessKey}`
      },
      body: JSON.stringify({
        artist_id: artistId,
        instagram_url: instagramURL || null,
        status,
        request_id:
          window.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`
      })
    });

    let result = {};

    try {
      result = await response.json();
    } catch {
      // La réponse n'est pas du JSON valide.
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(SESSION_KEY);
      }

      throw new Error(
        result.error ||
        `La sauvegarde a échoué (HTTP ${response.status}).`
      );
    }

    return result;
  }

  /**
   * Envoie la modification au Worker.
   *
   * Attention : une réponse positive signifie que GitHub a accepté
   * la demande, pas nécessairement que le commit est déjà terminé.
   */
  async function saveArtist(instagramURL, status) {
    if (isSaving || !currentArtist) return;

    const artist = currentArtist;
    const artistName = getArtistName(artist);

    setSavingState(true);

    setMessage(
      `Envoi de la mise à jour de ${artistName} à GitHub…`,
      "info"
    );

    try {
      const result = await sendInstagramUpdate(
        artist,
        instagramURL,
        status
      );

      // Mise à jour de la copie en mémoire pour l'interface.
      // La persistance réelle est effectuée par GitHub Actions.
      artist.instagram_url = instagramURL || null;
      artist.instagram_username = instagramURL
        ? getInstagramUsername(instagramURL)
        : null;
      artist.instagram_status = status;

      setMessage(
        result.message ||
        "Demande acceptée par GitHub. Le workflow va traiter la mise à jour.",
        "success"
      );

      render();
    } catch (error) {
      setMessage(
        error.message || "Impossible d'enregistrer cette modification.",
        "error"
      );
    } finally {
      setSavingState(false);
    }
  }

  // ============================================================
  // COMPTEURS
  // ============================================================

  function updateCounters() {
    const total = artists.length;

    const found = artists.filter(
      (artist) =>
        artist.instagram_status === "found" ||
        Boolean(artist.instagram_url)
    ).length;

    const notFound = artists.filter(
      (artist) => artist.instagram_status === "not_found"
    ).length;

    const pending = getPendingArtists().length;

    const progress = $("instagram-progress");

    if (progress) {
      progress.textContent =
        `${found} profils trouvés · ` +
        `${notFound} non trouvés · ` +
        `${pending} restants · ` +
        `${total} artistes au total`;
    }

    const count = $("instagram-finder-count");

    if (count) {
      count.textContent = `${total.toLocaleString("fr-FR")} artistes`;
    }
  }

  // ============================================================
  // AFFICHAGE
  // ============================================================

  function render() {
    const panel = $("instagram-finder-card");

    if (!panel) return;

    if (!rawData || artists.length === 0) {
      panel.innerHTML = `
        <div class="instagram-finder-empty">
          <h3>Aucun artiste chargé</h3>
          <p>
            Vérifie que data/artistes.json est accessible
            et que les données sont chargées par l'application.
          </p>
          <button
            class="finder-button"
            data-instagram-action="reload"
          >
            ↻ Recharger les artistes
          </button>
        </div>
      `;

      updateCounters();
      return;
    }

    updateCounters();

    const pending = getPendingArtists();

    if (pending.length === 0) {
      currentArtist = null;

      panel.innerHTML = `
        <div class="instagram-finder-complete">
          <div class="instagram-finder-emoji">🎉</div>
          <h3>Recherche terminée !</h3>
          <p>
            Tous les artistes ont un statut Instagram enregistré.
          </p>
          <p>
            Les mises à jour envoyées sont traitées par GitHub Actions.
          </p>
          <button
            class="finder-button"
            data-instagram-action="reload"
          >
            ↻ Recharger data/artistes.json
          </button>
        </div>
      `;

      return;
    }

    currentArtist = pending[0];

    const artist = currentArtist;
    const artistId = getArtistId(artist);
    const artistName = getArtistName(artist);
    const spotifyURL = getArtistSpotifyURL(artist);

    const listeners = Number(
      artist.monthly_listeners || artist.followers || 0
    ).toLocaleString("fr-FR");

    const googleQuery = encodeURIComponent(
      `"${artistName}" Instagram`
    );

    const instagramQuery = encodeURIComponent(artistName);

    panel.innerHTML = `
      <div class="instagram-finder-header">
        <div class="instagram-finder-kicker">
          PROCHAIN ARTISTE À IDENTIFIER
        </div>

        <h3 class="finder-artist-name">
          ${escapeHTML(artistName)}
        </h3>

        <div class="finder-meta">
          ${escapeHTML(listeners)} auditeurs / abonnés
          <br>
          ID Spotify :
          <code>${escapeHTML(artistId)}</code>
        </div>
      </div>

      <div class="finder-links">
        <a
          class="finder-button"
          href="${escapeHTML(spotifyURL)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          🎵 Ouvrir Spotify
        </a>

        <a
          class="finder-button"
          href="https://www.google.com/search?q=${googleQuery}"
          target="_blank"
          rel="noopener noreferrer"
        >
          🔎 Chercher sur Google
        </a>

        <a
          class="finder-button"
          href="https://www.instagram.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          📸 Ouvrir Instagram
        </a>

        <a
          class="finder-button"
          href="https://www.google.com/search?q=${encodeURIComponent(
            `site:instagram.com "${artistName}"`
          )}"
          target="_blank"
          rel="noopener noreferrer"
        >
          🔍 Rechercher sur Instagram
        </a>
      </div>

      <form id="instagram-finder-form">
        <label
          class="finder-label"
          for="instagram-url-input"
        >
          Lien ou nom du compte Instagram
        </label>

        <input
          id="instagram-url-input"
          name="instagram_url"
          type="text"
          placeholder="@nomducompte ou https://www.instagram.com/nomducompte/"
          autocomplete="off"
          spellcheck="false"
          required
        >

        <div
          id="instagram-finder-message"
          class="instagram-finder-message"
          role="status"
          aria-live="polite"
        ></div>

        <div class="finder-actions">
          <button
            class="finder-button primary"
            type="submit"
            data-instagram-action="save"
          >
            ✓ Enregistrer et suivant
          </button>

          <button
            class="finder-button"
            type="button"
            data-instagram-action="skip"
          >
            ⏭ Pas trouvé, suivant
          </button>
        </div>
      </form>

      <p class="finder-note">
        La mise à jour est envoyée au service sécurisé puis enregistrée
        dans data/artistes.json par GitHub Actions. Le site ne modifie
        pas directement le fichier sur GitHub.
      </p>
    `;

    // Évite que la touche Entrée déclenche accidentellement
    // le bouton « Pas trouvé ».
    const form = $("instagram-finder-form");

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();

        const input = $("instagram-url-input");
        const normalizedURL = normalizeInstagramURL(input?.value);

        if (!normalizedURL) {
          setMessage(
            "Saisis un nom de compte valide ou un lien de profil Instagram.",
            "error"
          );

          input?.focus();
          return;
        }

        saveArtist(normalizedURL, "found");
      });
    }
  }

  // ============================================================
  // RECHARGEMENT DU JSON
  // ============================================================

  async function reloadData() {
    const panel = $("instagram-finder-card");

    if (panel) {
      panel.innerHTML = `
        <p class="instagram-finder-loading">
          Chargement des artistes…
        </p>
      `;
    }

    try {
      const response = await fetch(
        `data/artistes.json?t=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `Impossible de charger artistes.json (HTTP ${response.status}).`
        );
      }

      rawData = await response.json();
      artists = getArtistList(rawData);

      render();
    } catch (error) {
      if (panel) {
        panel.innerHTML = `
          <div class="instagram-finder-error">
            <h3>Erreur de chargement</h3>
            <p>${escapeHTML(error.message)}</p>
            <button
              class="finder-button"
              data-instagram-action="reload"
            >
              Réessayer
            </button>
          </div>
        `;
      }
    }
  }

  // ============================================================
  // ACTIONS
  // ============================================================

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-instagram-action]");

    if (!button || isSaving) return;

    const action = button.dataset.instagramAction;

    if (action === "reload") {
      reloadData();
      return;
    }

    if (action === "skip") {
      if (!currentArtist) return;

      saveArtist(null, "not_found");
    }
  });

  // ============================================================
  // INITIALISATION
  // ============================================================

  function initialize() {
    if (!window.spotifyArtistsRawData) {
      return false;
    }

    rawData = window.spotifyArtistsRawData;
    artists = getArtistList(rawData);

    render();

    return true;
  }

  function waitForData() {
    if (initialize()) return;

    setTimeout(waitForData, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForData);
  } else {
    waitForData();
  }

  // Permet à l'application de demander un rafraîchissement
  // après un changement de page ou un événement personnalisé.
  document.addEventListener("instagram-finder-open", () => {
    if (!initialize()) {
      reloadData();
    }
  });
})();
