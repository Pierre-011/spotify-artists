/* =====================================================
   INSTAGRAM FINDER
   Recherche semi-automatique des profils Instagram
   ===================================================== */

(() => {
    "use strict";

    const STORAGE_KEY = "spotify-artists-instagram-progress-v1";

    let rawData = null;
    let artistList = [];
    let currentArtistId = null;

    const $ = id => document.getElementById(id);

    /* ---------- Utilitaires ---------- */

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function getArtistId(artist) {
        return String(
            artist?.id ||
            artist?.uri?.split(":").pop() ||
            ""
        );
    }

    function getArtistName(artist) {
        return artist?.name ||
            artist?.artist_name ||
            "Artiste inconnu";
    }

    function getInstagramURL(artist) {
        return artist?.instagram_url || "";
    }

    function getProgress() {
        try {
            return JSON.parse(
                localStorage.getItem(STORAGE_KEY) || "{}"
            );
        } catch {
            return {};
        }
    }

    function saveProgress(progress) {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(progress)
        );
    }

    /* ---------- Accès à la structure JSON ---------- */

    function findRawArtist(artist) {
        const id = getArtistId(artist);
        const source = rawData?.artists;

        if (
            source &&
            !Array.isArray(source) &&
            typeof source === "object"
        ) {
            return source[id] ||
                Object.values(source).find(
                    item => getArtistId(item) === id
                ) ||
                null;
        }

        if (Array.isArray(source)) {
            return source.find(
                item => getArtistId(item) === id
            ) || null;
        }

        if (Array.isArray(rawData)) {
            return rawData.find(
                item => getArtistId(item) === id
            ) || null;
        }

        return null;
    }

    /* ---------- Liste des artistes à traiter ---------- */

    function getArtistQueue() {
        const progress = getProgress();

        return artistList
            .filter(artist => {
                const id = getArtistId(artist);
                const saved = progress[id];

                const status =
                    saved?.status ||
                    artist.instagram_status ||
                    "";

                return (
                    !getInstagramURL(artist) &&
                    status !== "found" &&
                    status !== "not_found"
                );
            })
            .sort((a, b) =>
                getArtistName(a).localeCompare(
                    getArtistName(b),
                    "fr",
                    { sensitivity: "base" }
                )
            );
    }

    /* ---------- Affichage ---------- */

    function render() {
        const panel = $("instagram-finder-card");

        if (!panel || !rawData) {
            return;
        }

        const progress = getProgress();
        const queue = getArtistQueue();

        const processed = Object.values(progress)
            .filter(item =>
                ["found", "not_found"].includes(item.status)
            ).length;

        const found = Object.values(progress)
            .filter(item => item.status === "found")
            .length;

        const progressElement = $("instagram-progress");

        if (progressElement) {
            progressElement.textContent =
                `${processed} traités · ` +
                `${found} liens trouvés · ` +
                `${queue.length} restants`;
        }

        const artist = queue[0];

        currentArtistId = artist
            ? getArtistId(artist)
            : null;

        if (!artist) {
            panel.innerHTML = `
                <div class="instagram-complete">
                    <div class="instagram-emoji">🎉</div>

                    <h3>Recherche terminée !</h3>

                    <p>
                        Tous les artistes ont été traités.
                        Tu peux exporter ta base enrichie.
                    </p>

                    <button
                        class="finder-button primary"
                        data-instagram-action="export"
                    >
                        ⬇ Télécharger artistes.json
                    </button>
                </div>
            `;

            return;
        }

        const name = getArtistName(artist);
        const id = getArtistId(artist);

        const spotifyURL =
            artist.url ||
            artist.external_urls?.spotify ||
            `https://open.spotify.com/artist/${encodeURIComponent(id)}`;

        const googleQuery = encodeURIComponent(
            `"${name}" Instagram artiste`
        );

        const instagramSearch = encodeURIComponent(name);

        const listeners = Number(
            artist.monthly_listeners || 0
        ).toLocaleString("fr-FR");

        panel.innerHTML = `
            <div class="finder-kicker">
                PROCHAIN ARTISTE À IDENTIFIER
            </div>

            <h3 class="finder-artist-name">
                ${escapeHTML(name)}
            </h3>

            <div class="finder-meta">
                ${listeners} auditeurs mensuels
                <br>
                ID Spotify :
                ${escapeHTML(id)}
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
                    href="https://www.instagram.com/explore/search/keyword/?q=${instagramSearch}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    🔍 Recherche Instagram
                </a>

            </div>

            <label
                class="finder-label"
                for="instagram-url-input"
            >
                Lien du profil Instagram
            </label>

            <input
                id="instagram-url-input"
                type="url"
                placeholder="https://www.instagram.com/nom_du_compte/"
                autocomplete="url"
            >

            <div
                id="instagram-finder-message"
                class="finder-message"
                aria-live="polite"
            ></div>

            <div class="finder-actions">

                <button
                    class="finder-button primary"
                    data-instagram-action="save"
                >
                    ✓ Enregistrer et suivant
                </button>

                <button
                    class="finder-button"
                    data-instagram-action="skip"
                >
                    ⏭ Pas trouvé, suivant
                </button>

                <button
                    class="finder-button subtle"
                    data-instagram-action="export"
                >
                    ⬇ Exporter artistes.json
                </button>

            </div>

            <p class="finder-note">
                La progression est sauvegardée dans ce navigateur.
                Pour publier les modifications sur GitHub,
                exporte le fichier JSON puis remplace
                data/artistes.json dans ton dépôt.
            </p>
        `;
    }

    /* ---------- Validation des URL Instagram ---------- */

    function normalizeInstagramURL(value) {
        const text = String(value || "").trim();

        if (!text) {
            return "";
        }

        const normalized = text.startsWith("@")
            ? `https://www.instagram.com/${text.slice(1)}/`
            : text;

        try {
            const url = new URL(normalized);

            const allowedHosts = [
                "instagram.com",
                "www.instagram.com",
                "m.instagram.com"
            ];

            if (
                url.protocol !== "https:" ||
                !allowedHosts.includes(
                    url.hostname.toLowerCase()
                )
            ) {
                return "";
            }

            const username = url.pathname
                .split("/")
                .filter(Boolean)[0];

            if (
                !username ||
                ["p", "reel", "reels", "stories", "explore"]
                    .includes(username.toLowerCase())
            ) {
                return "";
            }

            return `https://www.instagram.com/${username}/`;

        } catch {
            return "";
        }
    }

    /* ---------- Enregistrer un résultat ---------- */

    function saveArtist(url, status) {
        const artist = artistList.find(
            item => getArtistId(item) === currentArtistId
        );

        if (!artist) {
            return;
        }

        const id = getArtistId(artist);
        const progress = getProgress();

        progress[id] = {
            status,
            ...(url ? { instagram_url: url } : {}),
            updated_at: new Date().toISOString()
        };

        saveProgress(progress);

        const rawArtist = findRawArtist(artist);

        if (rawArtist) {
            rawArtist.instagram_status = status;

            if (url) {
                rawArtist.instagram_url = url;
            } else {
                delete rawArtist.instagram_url;
            }
        }

        artist.instagram_status = status;

        if (url) {
            artist.instagram_url = url;
        }

        render();
    }

    /* ---------- Exporter artistes.json ---------- */

    function exportArtistsJSON() {
        if (!rawData) {
            alert("La base artistes.json n'est pas chargée.");
            return;
        }

        const progress = getProgress();

        for (const artist of artistList) {
            const saved = progress[getArtistId(artist)];

            if (!saved) {
                continue;
            }

            const rawArtist = findRawArtist(artist);

            if (!rawArtist) {
                continue;
            }

            rawArtist.instagram_status = saved.status;

            if (saved.instagram_url) {
                rawArtist.instagram_url = saved.instagram_url;
            } else {
                delete rawArtist.instagram_url;
            }
        }

        const blob = new Blob(
            [JSON.stringify(rawData, null, 2)],
            {
                type: "application/json;charset=utf-8"
            }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "artistes.json";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1500);
    }

    /* ---------- Gestion des boutons ---------- */

    document.addEventListener("click", event => {
        const button = event.target.closest(
            "[data-instagram-action]"
        );

        if (!button) {
            return;
        }

        const action = button.dataset.instagramAction;

        if (action === "export") {
            exportArtistsJSON();
            return;
        }

        if (action === "save") {
            const input = $("instagram-url-input");
            const message = $("instagram-finder-message");

            const url = normalizeInstagramURL(
                input?.value
            );

            if (!url) {
                if (message) {
                    message.textContent =
                        "Colle une URL Instagram valide.";
                }

                input?.focus();
                return;
            }

            saveArtist(url, "found");
            return;
        }

        if (action === "skip") {
            saveArtist("", "not_found");
        }
    });

    /* ---------- Initialisation ---------- */

    function initialize() {
        if (!window.spotifyArtistsRawData) {
            return false;
        }

        rawData = window.spotifyArtistsRawData;

        if (Array.isArray(rawData)) {
            artistList = rawData;
        } else if (Array.isArray(rawData.artists)) {
            artistList = rawData.artists;
        } else if (
            rawData.artists &&
            typeof rawData.artists === "object"
        ) {
            artistList = Object.values(rawData.artists);
        }

        const progress = getProgress();

        for (const artist of artistList) {
            const saved = progress[getArtistId(artist)];

            if (saved?.status === "found" && saved.instagram_url) {
                artist.instagram_url = saved.instagram_url;
                artist.instagram_status = "found";
            }
        }

        render();

        return true;
    }

    function waitForData() {
        if (initialize()) {
            return;
        }

        setTimeout(waitForData, 200);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", waitForData);
    } else {
        waitForData();
    }
})();
