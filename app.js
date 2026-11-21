"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

const SPOTIFY_CLIENT_ID = "670e4b53420b45fcb95cd5d224c25f6d";
// Adresse de retour = adresse de la page elle-même (GitHub Pages ou serveur local).
// Elle doit être enregistrée à l'identique dans le dashboard développeur Spotify.
const SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
const SPOTIFY_SCOPES =
    "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";

let artists = [];
let releases = [];
let currentPage = "releases";
let statsCache = null;

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyUserToken = null;
let spotifyReady = false;
let spotifyInitPromise = null;
let spotifySDKPromise = null;

window.spotifyArtistsRawData = null;

/* ========== UTILITAIRES ========== */

const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    return Number.isNaN(n) ? escapeHTML(value) : new Intl.NumberFormat("fr-FR").format(n);
}

const normalizeText = (value) => String(value ?? "").toLowerCase();

/* ========== DATES ========== */

function getTodayParis() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const result = {};
    for (const part of parts) {
        if (part.type !== "literal") result[part.type] = part.value;
    }
    return `${result.year}-${result.month}-${result.day}`;
}

function normalizeDate(value) {
    if (!value) return "";
    const string = String(value).trim();
    const iso = string.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const french = string.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return french ? `${french[3]}-${french[2]}-${french[1]}` : "";
}

function parseLocalDate(value) {
    const match = normalizeDate(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function formatDate(value) {
    const normalized = normalizeDate(value);
    if (!normalized) return "—";
    const [y, m, d] = normalized.split("-");
    return `${d}/${m}/${y}`;
}

function formatReadableDate(value) {
    const date = parseLocalDate(value);
    return date
        ? date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : "Date inconnue";
}

function formatMonth(key) {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric"
    });
}

function toISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ========== CHARGEMENT JSON ========== */

async function loadJSON(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Erreur HTTP ${response.status} : ${path}`);
    const text = await response.text();
    if (!text.trim()) throw new Error(`${path} est vide.`);
    return JSON.parse(text);
}

function parseArtists(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean);
    if (Array.isArray(data.artists)) return data.artists.filter(Boolean);
    if (data.artists && typeof data.artists === "object") return Object.values(data.artists).filter(Boolean);
    if (data.id || data.name || data.artist_name) return [data];
    return Object.values(data).filter((v) => v && typeof v === "object");
}

function parseReleases(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean);
    for (const key of ["tracks", "releases", "albums"]) {
        if (Array.isArray(data[key])) return data[key].filter(Boolean);
    }
    return data.id || data.name || data.release_date ? [data] : [];
}

/* ========== ACCÈS AUX CHAMPS ========== */

const getReleaseDate = (r) => normalizeDate(r?.release_date ?? r?.releaseDate ?? r?.date ?? "");
const getReleaseTitle = (r) => r?.name || r?.album_name || r?.albumName || r?.title || "Titre inconnu";
const getReleaseArtist = (r) => r?.artist_name || r?.artistName || r?.artist || "Artiste inconnu";
const getReleaseImage = (r) => r?.album_image || r?.albumImage || r?.image || "";
const getReleaseURL = (r) => r?.url || r?.external_url || r?.external_urls?.spotify || "";
const getReleaseType = (r) => String(r?.release_type || r?.releaseType || "").toLowerCase();
const getArtistName = (a) => a?.name || a?.artist_name || "";

function matchesSearch(release, search) {
    if (!search) return true;
    const text = [getReleaseTitle(release), getReleaseArtist(release), release.album_name]
        .filter(Boolean)
        .join(" ");
    return normalizeText(text).includes(search);
}

/* ========== SPOTIFY : CONNEXION UTILISATEUR (PKCE) ========== */

const SPOTIFY_STORAGE_KEYS = [
    "spotify_access_token",
    "spotify_refresh_token",
    "spotify_token_expires_at",
    "spotify_scopes"
];

function clearSpotifyTokens() {
    for (const key of SPOTIFY_STORAGE_KEYS) localStorage.removeItem(key);
    spotifyUserToken = null;
}

function generateRandomString(length) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const values = crypto.getRandomValues(new Uint8Array(length));
    let text = "";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(values[i] % possible.length);
    }
    return text;
}

async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function startSpotifyLogin() {
    if (!/^https?:$/.test(window.location.protocol)) {
        updatePlayerStatus("Ouvre le site via une adresse http(s) (GitHub Pages ou serveur local), pas en double-cliquant sur le fichier.");
        return;
    }

    // Spotify refuse « localhost » : en local, il faut utiliser 127.0.0.1.
    if (window.location.hostname === "localhost") {
        updatePlayerStatus("Ouvre le site sur 127.0.0.1 au lieu de localhost, puis reclique sur « Se connecter à Spotify ».");
        return;
    }

    console.info("Adresse de retour Spotify utilisée :", SPOTIFY_REDIRECT_URI);

    const verifier = generateRandomString(64);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem("spotify_code_verifier", verifier);

    const url =
        "https://accounts.spotify.com/authorize?" +
        new URLSearchParams({
            response_type: "code",
            client_id: SPOTIFY_CLIENT_ID,
            scope: SPOTIFY_SCOPES,
            redirect_uri: SPOTIFY_REDIRECT_URI,
            code_challenge_method: "S256",
            code_challenge: challenge
        });

    window.location.href = url;
}

function saveSpotifyTokens(data) {
    spotifyUserToken = data.access_token;
    localStorage.setItem("spotify_access_token", data.access_token);
    localStorage.setItem("spotify_token_expires_at", String(Date.now() + (data.expires_in ?? 3600) * 1000));
    localStorage.setItem("spotify_scopes", SPOTIFY_SCOPES);
    if (data.refresh_token) {
        localStorage.setItem("spotify_refresh_token", data.refresh_token);
    }
}

async function handleSpotifyCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    if (!code && !error) return false;

    // On nettoie l'URL tout de suite : le code ne peut être utilisé qu'une fois.
    window.history.replaceState({}, "", window.location.pathname);

    if (error) {
        updatePlayerStatus(`Connexion Spotify refusée : ${error}`);
        return false;
    }

    const verifier = localStorage.getItem("spotify_code_verifier");
    if (!verifier) {
        updatePlayerStatus("Connexion Spotify impossible : recommence la connexion.");
        return false;
    }

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: SPOTIFY_REDIRECT_URI,
                client_id: SPOTIFY_CLIENT_ID,
                code_verifier: verifier
            })
        });

        const data = await response.json();
        if (!data.access_token) {
            updatePlayerStatus("Connexion Spotify échouée : " + (data.error_description || data.error || "erreur inconnue"));
            return false;
        }

        saveSpotifyTokens(data);
        localStorage.removeItem("spotify_code_verifier");
        updatePlayerStatus("Connecté à Spotify — clique sur une sortie pour l'écouter");
        return true;
    } catch (err) {
        console.error("Erreur de connexion Spotify :", err);
        updatePlayerStatus("Connexion Spotify échouée : " + err.message);
        return false;
    }
}

async function refreshSpotifyUserToken() {
    const refreshToken = localStorage.getItem("spotify_refresh_token");
    if (!refreshToken) return false;

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: SPOTIFY_CLIENT_ID
            })
        });

        const data = await response.json();
        if (!data.access_token) return false;

        saveSpotifyTokens(data);
        return true;
    } catch (err) {
        console.error("Erreur de rafraîchissement du token :", err);
        return false;
    }
}

async function getSpotifyAccessToken() {
    // Anciens jetons créés avec d'autres droits : on les jette pour forcer une reconnexion.
    const storedScopes = localStorage.getItem("spotify_scopes");
    if ((localStorage.getItem("spotify_access_token") || localStorage.getItem("spotify_refresh_token")) &&
        storedScopes !== SPOTIFY_SCOPES) {
        clearSpotifyTokens();
        return null;
    }

    const expiresAt = Number(localStorage.getItem("spotify_token_expires_at"));

    if (spotifyUserToken && expiresAt && Date.now() < expiresAt - 60000) {
        return spotifyUserToken;
    }

    const stored = localStorage.getItem("spotify_access_token");
    if (stored && expiresAt && Date.now() < expiresAt - 60000) {
        spotifyUserToken = stored;
        return spotifyUserToken;
    }

    const refreshed = await refreshSpotifyUserToken();
    return refreshed ? spotifyUserToken : null;
}

async function updateLoginButton() {
    const button = $("spotify-login");
    if (!button) return;
    const token = await getSpotifyAccessToken();
    button.textContent = token ? "Spotify connecté ✓" : "Se connecter à Spotify";
}

/* ========== SPOTIFY WEB PLAYBACK SDK ========== */

function loadSpotifySDK() {
    if (window.Spotify) return Promise.resolve();
    if (spotifySDKPromise) return spotifySDKPromise;

    spotifySDKPromise = new Promise((resolve, reject) => {
        window.onSpotifyWebPlaybackSDKReady = () => resolve();
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        script.onerror = () => {
            spotifySDKPromise = null;
            reject(new Error("Impossible de charger le SDK Spotify."));
        };
        document.body.appendChild(script);
    });

    return spotifySDKPromise;
}

async function createSpotifyPlayer() {
    const token = await getSpotifyAccessToken();
    if (!token) {
        updatePlayerStatus("Connexion Spotify requise — clique sur « Se connecter à Spotify ».");
        return false;
    }

    await loadSpotifySDK();

    if (spotifyPlayer) {
        spotifyPlayer.disconnect();
        spotifyPlayer = null;
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        spotifyPlayer = new Spotify.Player({
            name: "Spotify Artists Dashboard",
            getOAuthToken: (cb) => {
                getSpotifyAccessToken().then((t) => {
                    if (t) cb(t);
                });
            }
        });

        // Nécessaire pour que le navigateur autorise la lecture automatique.
        spotifyPlayer.activateElement();

        spotifyPlayer.addListener("ready", ({ device_id }) => {
            spotifyDeviceId = device_id;
            spotifyReady = true;
            updatePlayerStatus("Spotify prêt");
            finish(true);
        });

        spotifyPlayer.addListener("not_ready", () => {
            spotifyReady = false;
            updatePlayerStatus("Spotify déconnecté");
        });

        const errorMessages = {
            initialization_error: "Navigateur non compatible avec le lecteur Spotify.",
            authentication_error: "Authentification refusée — reconnecte-toi à Spotify.",
            account_error: "Un compte Spotify Premium est nécessaire pour la lecture.",
            playback_error: "Erreur de lecture."
        };

        for (const type of Object.keys(errorMessages)) {
            spotifyPlayer.addListener(type, ({ message }) => {
                console.error(`Spotify ${type} :`, message);
                updatePlayerStatus(`${errorMessages[type]} (${message})`);
                if (type !== "playback_error") {
                    spotifyReady = false;
                    finish(false);
                }
            });
        }

        spotifyPlayer.addListener("player_state_changed", (state) => {
            const track = state?.track_window?.current_track;
            if (track) {
                updatePlayerStatus(`Lecture : ${track.name} — ${track.artists[0].name}`);
            }
        });

        spotifyPlayer.connect().then((success) => {
            if (!success) {
                updatePlayerStatus("Impossible de connecter le lecteur Spotify.");
                finish(false);
            }
        });

        setTimeout(() => {
            if (!settled) {
                updatePlayerStatus("Le lecteur Spotify ne répond pas. Réessaie.");
            }
            finish(spotifyReady);
        }, 10000);
    });
}

function initSpotifyPlayer() {
    if (spotifyReady) return Promise.resolve(true);
    if (spotifyInitPromise) return spotifyInitPromise;

    spotifyInitPromise = createSpotifyPlayer().finally(() => {
        spotifyInitPromise = null;
    });
    return spotifyInitPromise;
}

function updatePlayerStatus(message) {
    const status = $("player-status");
    const bar = $("spotify-player-bar");
    if (status) status.textContent = message;
    if (bar) bar.classList.remove("hidden");
}

function getTrackUri(release) {
    if (release.uri) return release.uri;
    if (release.track_uri) return release.track_uri;
    const url = getReleaseURL(release);
    if (url) {
        const match = url.match(/track\/([a-zA-Z0-9]+)/);
        if (match) return `spotify:track:${match[1]}`;
    }
    return null;
}

async function searchTrackUri(release) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const query = encodeURIComponent(`${artist} ${title}`);
    const token = await getSpotifyAccessToken();
    if (!token) return null;

    const response = await fetch(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.tracks?.items?.[0]?.uri || null;
}

async function playRelease(release) {
    try {
        if (!spotifyReady) {
            const ok = await initSpotifyPlayer();
            if (!ok) return;
        }

        if (!spotifyReady || !spotifyDeviceId) {
            updatePlayerStatus("Spotify n'est pas encore prêt.");
            return;
        }

        let uri = getTrackUri(release);
        if (!uri) uri = await searchTrackUri(release);
        if (!uri) {
            updatePlayerStatus("Aucun titre Spotify trouvé.");
            return;
        }

        const token = await getSpotifyAccessToken();
        if (!token) {
            updatePlayerStatus("Connexion Spotify requise.");
            return;
        }

        const body = uri.startsWith("spotify:track:") ? { uris: [uri] } : { context_uri: uri };

        const response = await fetch(
            `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            let detail = "";
            try {
                const errorData = await response.json();
                detail = errorData?.error?.message || "";
            } catch {
                // pas de détail disponible
            }

            if (response.status === 401) {
                clearSpotifyTokens();
                updateLoginButton();
                updatePlayerStatus("Session Spotify expirée — reconnecte-toi.");
            } else if (response.status === 403) {
                updatePlayerStatus("Lecture refusée (403) : Premium requis ou droits manquants. Reconnecte-toi.");
            } else {
                updatePlayerStatus(`Erreur lors du lancement de la lecture (${response.status}) ${detail}`.trim());
            }
            return;
        }

        updatePlayerStatus("Lecture lancée sur Spotify");
    } catch (error) {
        console.error("Erreur Spotify :", error);
        updatePlayerStatus("Erreur Spotify : " + error.message);
    }
}

/* ========== DATE DU JOUR ========== */

function displayCurrentDate() {
    const today = getTodayParis();
    if ($("current-date")) $("current-date").textContent = formatDate(today);
    if ($("release-title")) $("release-title").textContent = `Nouvelles sorties — ${formatDate(today)}`;
    if ($("release-description"))
        $("release-description").textContent = `Sorties prévues le ${formatReadableDate(today)}`;
}

/* ========== SORTIES DU JOUR ========== */

function renderReleases() {
    const container = $("release-list");
    if (!container) return;

    const search = normalizeText($("release-search")?.value.trim());
    const today = getTodayParis();

    const list = releases
        .filter((r) => getReleaseDate(r) === today && matchesSearch(r, search))
        .sort((a, b) => getReleaseTitle(a).localeCompare(getReleaseTitle(b), "fr-FR"));

    if ($("release-count")) $("release-count").textContent = formatNumber(list.length);

    if (!list.length) {
        container.innerHTML = `<div class="empty">Aucune sortie trouvée pour le ${escapeHTML(formatDate(today))}.</div>`;
        container.onclick = null;
        return;
    }

    container.innerHTML = list
        .map((release, index) => {
            const title = getReleaseTitle(release);
            const image = getReleaseImage(release);
            const url = getReleaseURL(release);

            return `
                <article class="release-card clickable" data-index="${index}">
                    ${
                        image
                            ? `<img class="release-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy">`
                            : `<div class="release-cover"></div>`
                    }
                    <div class="release-information">
                        <div class="release-type">SORTIE DU JOUR</div>
                        <div class="release-name">${escapeHTML(title)}</div>
                        <div class="release-artist">${escapeHTML(getReleaseArtist(release))}</div>
                        <div class="release-album">${escapeHTML(formatDate(today))}</div>
                        ${
                            url
                                ? `<a class="spotify-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Écouter sur Spotify</a>`
                                : ""
                        }
                    </div>
                </article>
            `;
        })
        .join("");

    container.onclick = (event) => {
        if (event.target.closest("a")) return;
        const card = event.target.closest(".release-card.clickable");
        if (!card) return;
        const release = list[Number(card.dataset.index)];
        if (release) playRelease(release);
    };
}

/* ========== TOUTES LES SORTIES ========== */

function renderCatalogCard(release, date, index) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const image = getReleaseImage(release);
    const url = getReleaseURL(release);
    const type = getReleaseType(release) || "release";

    return `
        <article class="catalog-release-card clickable" data-index="${index}">
            <div class="catalog-cover-wrapper">
                ${
                    image
                        ? `<img class="catalog-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy">`
                        : `<div class="catalog-cover catalog-cover-empty"><span>♪</span></div>`
                }
                ${
                    url
                        ? `<a class="catalog-play" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">▶</a>`
                        : ""
                }
            </div>
            <div class="catalog-information">
                <div class="catalog-type">${escapeHTML(type.toUpperCase())}</div>
                <div class="catalog-title">${escapeHTML(title)}</div>
                <div class="catalog-artist">${escapeHTML(artist)}</div>
                <div class="catalog-footer">
                    <span>${date === "unknown" ? "—" : escapeHTML(formatDate(date))}</span>
                    ${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Spotify ↗</a>` : ""}
                </div>
            </div>
        </article>
    `;
}

function renderAllReleases() {
    const container = $("all-release-list");
    if (!container) return;

    const search = normalizeText($("all-release-search")?.value.trim());
    const sort = $("all-release-sort")?.value || "newest";

    const filtered = releases.filter((r) => matchesSearch(r, search));

    filtered.sort((a, b) => {
        const dateA = getReleaseDate(a);
        const dateB = getReleaseDate(b);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return sort === "oldest" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });

    if ($("all-release-count")) $("all-release-count").textContent = formatNumber(filtered.length);

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty all-release-empty">
                <div class="empty-icon">🎵</div>
                <strong>Aucune sortie trouvée</strong>
                <p>Essayez une autre recherche.</p>
            </div>
        `;
        container.onclick = null;
        return;
    }

    const groups = new Map();
    for (const release of filtered) {
        const date = getReleaseDate(release) || "unknown";
        if (!groups.has(date)) groups.set(date, []);
        groups.get(date).push(release);
    }

    const html = [];
    const flatIndex = new Map();
    let currentIndex = 0;

    for (const [date, items] of groups) {
        const unknown = date === "unknown";

        html.push(`
            <section class="release-day">
                <div class="release-day-header">
                    <div>
                        <span class="release-day-label">${unknown ? "DATE INCONNUE" : "SORTIES"}</span>
                        <h3>${escapeHTML(unknown ? "Date inconnue" : formatReadableDate(date))}</h3>
                    </div>
                    <span class="release-day-count">
                        ${formatNumber(items.length)} ${items.length > 1 ? "sorties" : "sortie"}
                    </span>
                </div>
                <div class="release-day-grid">
                    ${items
                        .map((release) => {
                            flatIndex.set(currentIndex, release);
                            const card = renderCatalogCard(release, date, currentIndex);
                            currentIndex++;
                            return card;
                        })
                        .join("")}
                </div>
            </section>
        `);
    }

    container.innerHTML = html.join("");

    container.onclick = (event) => {
        if (event.target.closest("a")) return;
        const card = event.target.closest(".catalog-release-card.clickable");
        if (!card) return;
        const release = flatIndex.get(Number(card.dataset.index));
        if (release) playRelease(release);
    };
}

/* ========== ARTISTES ========== */

function renderArtists() {
    const container = $("artist-table");
    if (!container) return;

    const search = normalizeText($("artist-search")?.value.trim());
    const sort = $("artist-sort")?.value || "name";

    const filtered = artists.filter((a) => normalizeText(getArtistName(a)).includes(search));

    if (sort === "followers") {
        filtered.sort((a, b) => Number(b.followers || 0) - Number(a.followers || 0));
    } else if (sort === "popularity") {
        filtered.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
    } else {
        filtered.sort((a, b) => getArtistName(a).localeCompare(getArtistName(b), "fr-FR"));
    }

    if ($("artist-count")) $("artist-count").textContent = formatNumber(artists.length);

    if (!filtered.length) {
        container.innerHTML = `<tr><td colspan="6" class="muted">Aucun artiste trouvé.</td></tr>`;
        return;
    }

    container.innerHTML = filtered
        .map((artist) => {
            const name = getArtistName(artist) || "Artiste inconnu";
            const monthly = artist.monthly_listeners ?? artist.monthlyListeners;
            const popularity = artist.popularity;
            const genres = Array.isArray(artist.genres) ? artist.genres.join(", ") : "";
            const url = artist.url || artist.external_urls?.spotify || "";

            return `
                <tr>
                    <td class="artist-name">
                        ${
                            url
                                ? `<a class="artist-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(name)}</a>`
                                : escapeHTML(name)
                        }
                    </td>
                    <td>${formatNumber(artist.followers)}</td>
                    <td>${formatNumber(monthly)}</td>
                    <td>${popularity !== undefined && popularity !== null ? escapeHTML(popularity) : "—"}</td>
                    <td class="genres-cell">${escapeHTML(genres || "—")}</td>
                    <td>${url ? `<a class="spotify-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Spotify</a>` : "—"}</td>
                </tr>
            `;
        })
        .join("");
}

/* ========== STATISTIQUES ========== */

function calculateStatistics() {
    if (statsCache) return statsCache;

    const artistMap = new Map();
    const monthMap = new Map();
    const dates = [];
    const types = { single: 0, album: 0, ep: 0, other: 0 };

    for (const release of releases) {
        const name = getReleaseArtist(release);
        const id = release.artist_id || release.artistId || normalizeText(name);

        if (!artistMap.has(id)) artistMap.set(id, { name, count: 0 });
        artistMap.get(id).count++;

        const type = getReleaseType(release).replace(/s$/, "");
        if (type === "single") types.single++;
        else if (type === "album") types.album++;
        else if (type === "ep") types.ep++;
        else types.other++;

        const date = parseLocalDate(getReleaseDate(release));
        if (date) {
            dates.push(date);
            const key = toISO(date).slice(0, 7);
            monthMap.set(key, (monthMap.get(key) || 0) + 1);
        }
    }

    const today = parseLocalDate(getTodayParis());
    const countLastDays = (days) => {
        if (!today) return 0;
        const start = new Date(today);
        start.setDate(start.getDate() - days + 1);
        return dates.filter((d) => d >= start && d <= today).length;
    };

    let oldest = null;
    let newest = null;
    for (const date of dates) {
        if (!oldest || date < oldest) oldest = date;
        if (!newest || date > newest) newest = date;
    }

    let busiest = null;
    for (const [key, count] of monthMap) {
        if (!busiest || count > busiest.count) busiest = { key, count };
    }

    statsCache = {
        total: releases.length,
        last7: countLastDays(7),
        last30: countLastDays(30),
        last365: countLastDays(365),
        activeArtists: artistMap.size,
        types,
        topArtists: [...artistMap.values()]
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 10),
        months: [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        oldest,
        newest,
        duration: oldest && newest ? Math.round((newest - oldest) / 86400000) : 0,
        busiest
    };

    return statsCache;
}

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function renderStatistics() {
    const s = calculateStatistics();

    setText("stats-total", formatNumber(s.total));
    setText("stats-7-days", formatNumber(s.last7));
    setText("stats-30-days", formatNumber(s.last30));
    setText("stats-365-days", formatNumber(s.last365));
    setText("stats-artists-count", formatNumber(s.activeArtists));
    setText("stats-singles", formatNumber(s.types.single));
    setText("stats-albums", formatNumber(s.types.album));
    setText("stats-eps", formatNumber(s.types.ep));
    setText("stats-other", formatNumber(s.types.other));

    const artistsContainer = $("stats-artists");
    if (artistsContainer) {
        artistsContainer.innerHTML = s.topArtists.length
            ? s.topArtists
                  .map(
                      (artist, index) => `
                      <div class="stats-row">
                          <span>
                              <span class="artist-rank">${index + 1}</span>
                              ${escapeHTML(artist.name)}
                          </span>
                          <strong>${formatNumber(artist.count)}</strong>
                      </div>
                  `
                  )
                  .join("")
            : `<div class="empty">Aucune donnée disponible.</div>`;
    }

    const monthsContainer = $("stats-months");
    if (monthsContainer) {
        if (!s.months.length) {
            monthsContainer.innerHTML = `<div class="empty">Aucune date disponible.</div>`;
        } else {
            const max = Math.max(...s.months.map((m) => m[1]));
            monthsContainer.innerHTML = s.months
                .map(
                    ([key, count]) => `
                    <div class="monthly-stat-row">
                        <div class="monthly-stat-header">
                            <span>${escapeHTML(formatMonth(key))}</span>
                            <strong>${formatNumber(count)}</strong>
                        </div>
                        <div class="monthly-bar">
                            <div class="monthly-bar-fill" style="width:${max > 0 ? (count / max) * 100 : 0}%"></div>
                        </div>
                    </div>
                `
                )
                .join("");
        }
    }

    const summary = $("stats-summary");
    if (!summary) return;

    if (!s.total) {
        summary.innerHTML = `<p>Aucune sortie disponible.</p>`;
        return;
    }

    if (!s.oldest) {
        summary.innerHTML = `<p>Le catalogue contient <strong>${formatNumber(s.total)}</strong> sortie(s), mais aucune date exploitable n'a été trouvée.</p>`;
        return;
    }

    let html = `
        <p>Le catalogue contient <strong>${formatNumber(s.total)}</strong> sortie(s).</p>
        <p>
            Les sorties couvrent la période du
            <strong>${escapeHTML(formatDate(toISO(s.oldest)))}</strong>
            au
            <strong>${escapeHTML(formatDate(toISO(s.newest)))}</strong>,
            soit <strong>${formatNumber(s.duration)}</strong> jour(s).
        </p>
    `;

    if (s.topArtists[0]) {
        html += `<p>L'artiste avec le plus de sorties est <strong>${escapeHTML(s.topArtists[0].name)}</strong> avec <strong>${formatNumber(s.topArtists[0].count)}</strong> sortie(s).</p>`;
    }

    if (s.busiest) {
        html += `<p>Le mois avec le plus de sorties est <strong>${escapeHTML(formatMonth(s.busiest.key))}</strong> avec <strong>${formatNumber(s.busiest.count)}</strong> sortie(s).</p>`;
    }

    summary.innerHTML = html;
}

/* ========== INSTAGRAM FINDER ========== */

function renderInstagramFinder() {
    const container = $("instagram-finder-card");
    if (!container) return;

    if (!window.spotifyArtistsRawData) {
        container.innerHTML = `<div class="empty">Les données des artistes ne sont pas encore disponibles.</div>`;
        return;
    }

    document.dispatchEvent(
        new CustomEvent("instagram-finder-open", {
            detail: { artists: window.spotifyArtistsRawData }
        })
    );
}

/* ========== NAVIGATION ========== */

function renderPage(target) {
    try {
        if (target === "releases") renderReleases();
        else if (target === "artists") renderArtists();
        else if (target === "all-releases") renderAllReleases();
        else if (target === "stats") renderStatistics();
        else if (target === "instagram-finder") renderInstagramFinder();
    } catch (error) {
        console.error(`Erreur d'affichage (${target}) :`, error);
    }
}

function setupNavigation() {
    const buttons = document.querySelectorAll(".nav-button");
    const pages = document.querySelectorAll(".page");

    buttons.forEach((button) => {
        button.addEventListener("click", () => {
            const target = button.dataset.page;
            if (!target) return;

            currentPage = target;

            buttons.forEach((b) => b.classList.toggle("active", b === button));
            pages.forEach((p) => p.classList.toggle("active", p.id === `page-${target}`));

            renderPage(target);
        });
    });
}

function showError(elementId, message) {
    const element = $(elementId);
    if (!element) return;
    element.innerHTML = `
        <div class="empty">
            <strong>Impossible de charger les données</strong>
            <p>${escapeHTML(message)}</p>
        </div>
    `;
}

/* ========== INITIALISATION ========== */

async function initialize() {
    displayCurrentDate();

    // Retour de la page de connexion Spotify (le code d'autorisation est dans l'URL).
    try {
        await handleSpotifyCallback();
    } catch (error) {
        console.error("Erreur pendant le retour Spotify :", error);
    }
    updateLoginButton().catch(() => {});

    const [releasesResult, artistsResult] = await Promise.allSettled([
        loadJSON(RELEASES_FILE),
        loadJSON(ARTISTS_FILE)
    ]);

    if (releasesResult.status === "fulfilled") {
        try {
            releases = parseReleases(releasesResult.value);
            statsCache = null;
        } catch (error) {
            console.error("Erreur sorties.json :", error);
        }
    } else {
        const message = releasesResult.reason?.message || "Erreur inconnue";
        showError("release-list", message);
        showError("all-release-list", message);
        showError("stats-summary", message);
    }

    if (artistsResult.status === "fulfilled") {
        window.spotifyArtistsRawData = artistsResult.value;
        artists = parseArtists(artistsResult.value);

        document.dispatchEvent(
            new CustomEvent("spotify-artists-loaded", {
                detail: {
                    rawData: window.spotifyArtistsRawData,
                    artists
                }
            })
        );
    } else {
        const message = artistsResult.reason?.message || "Erreur inconnue";
        if ($("artist-table")) {
            $("artist-table").innerHTML = `<tr><td colspan="6" class="muted">Impossible de charger les artistes : ${escapeHTML(message)}</td></tr>`;
        }
        showError("instagram-finder-card", message);
    }

    if (releasesResult.status === "fulfilled") renderPage("releases");
    if (artistsResult.status === "fulfilled") renderPage("artists");
}

/* ========== DÉMARRAGE ========== */

document.addEventListener("DOMContentLoaded", () => {
    const bindings = [
        ["release-search", "input", renderReleases],
        ["artist-search", "input", renderArtists],
        ["artist-sort", "change", renderArtists],
        ["all-release-search", "input", renderAllReleases],
        ["all-release-sort", "change", renderAllReleases]
    ];

    for (const [id, event, handler] of bindings) {
        $(id)?.addEventListener(event, handler);
    }

    setupNavigation();

    const closeButton = $("player-close");
    if (closeButton) {
        closeButton.addEventListener("click", () => {
            $("spotify-player-bar")?.classList.add("hidden");
        });
    }

    const loginButton = $("spotify-login");
    if (loginButton) {
        loginButton.addEventListener("click", startSpotifyLogin);
    }

    initialize().catch((error) => {
        console.error("Erreur pendant l'initialisation du dashboard :", error);
    });
});
