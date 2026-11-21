"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];
let currentPage = "releases";
let statsCache = null;

/* Conserve la structure originale de artistes.json */
window.spotifyArtistsRawData = null;


/* ========== SPOTIFY IDENTIFIANTS ========== */

const SPOTIFY_CLIENT_ID = "670e4b53420b45fcb95cd5d224c25f6d";
const SPOTIFY_CLIENT_SECRET = "f9bce195db5042b1abbdd979f75e2874";
const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3000/";
const SPOTIFY_SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private"
];

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyUserToken = null;
let spotifyAppToken = null;
let spotifyReady = false;


/* ========== SPOTIFY : PKCE (CONNEXION UTILISATEUR) ========== */

function generateRandomString(length) {
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let text = "";

    for (let i = 0; i < length; i++) {
        text += possible.charAt(
            Math.floor(Math.random() * possible.length)
        );
    }

    return text;
}

async function generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    return btoa(
        String.fromCharCode(...new Uint8Array(digest))
    )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function startSpotifyLogin() {
    const verifier = generateRandomString(64);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem(
        "spotify_code_verifier",
        verifier
    );

    const url =
        "https://accounts.spotify.com/authorize?" +
        new URLSearchParams({
            response_type: "code",
            client_id: SPOTIFY_CLIENT_ID,
            scope: SPOTIFY_SCOPES.join(" "),
            redirect_uri: SPOTIFY_REDIRECT_URI,
            code_challenge_method: "S256",
            code_challenge: challenge
        });

    window.location.href = url;
}

async function handleSpotifyCallback() {
    const params = new URLSearchParams(
        window.location.search
    );

    const code = params.get("code");

    if (!code) {
        return false;
    }

    const verifier = localStorage.getItem(
        "spotify_code_verifier"
    );

    if (!verifier) {
        return false;
    }

    const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: SPOTIFY_REDIRECT_URI,
                client_id: SPOTIFY_CLIENT_ID,
                code_verifier: verifier
            })
        }
    );

    const data = await response.json();

    if (!data.access_token) {
        return false;
    }

    spotifyUserToken = data.access_token;

    localStorage.setItem(
        "spotify_access_token",
        data.access_token
    );

    localStorage.setItem(
        "spotify_refresh_token",
        data.refresh_token || ""
    );

    localStorage.setItem(
        "spotify_token_expires_at",
        String(
            Date.now() + (data.expires_in ?? 3600) * 1000
        )
    );

    window.history.replaceState(
        {},
        "",
        window.location.pathname
    );

    return true;
}

async function refreshSpotifyUserToken() {
    const refreshToken = localStorage.getItem(
        "spotify_refresh_token"
    );

    if (!refreshToken) {
        return false;
    }

    const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: SPOTIFY_CLIENT_ID
            })
        }
    );

    const data = await response.json();

    if (!data.access_token) {
        return false;
    }

    spotifyUserToken = data.access_token;

    localStorage.setItem(
        "spotify_access_token",
        data.access_token
    );

    localStorage.setItem(
        "spotify_token_expires_at",
        String(
            Date.now() + (data.expires_in ?? 3600) * 1000
        )
    );

    if (data.refresh_token) {
        localStorage.setItem(
            "spotify_refresh_token",
            data.refresh_token
        );
    }

    return true;
}

async function getSpotifyAccessToken() {
    const expiresAt = Number(
        localStorage.getItem("spotify_token_expires_at")
    );

    if (
        spotifyUserToken &&
        expiresAt &&
        Date.now() < expiresAt - 60000
    ) {
        return spotifyUserToken;
    }

    const storedToken = localStorage.getItem(
        "spotify_access_token"
    );

    if (
        storedToken &&
        expiresAt &&
        Date.now() < expiresAt - 60000
    ) {
        spotifyUserToken = storedToken;

        return spotifyUserToken;
    }

    const refreshed = await refreshSpotifyUserToken();

    if (refreshed) {
        return spotifyUserToken;
    }

    await startSpotifyLogin();

    throw new Error(
        "Connexion Spotify requise."
    );
}


/* ========== SPOTIFY : CLIENT CREDENTIALS (APP TOKEN) ========== */

async function getSpotifyAppToken() {
    if (spotifyAppToken) {
        return spotifyAppToken;
    }

    const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded",
                Authorization:
                    "Basic " +
                    btoa(
                        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
                    )
            },
            body: "grant_type=client_credentials"
        }
    );

    if (!response.ok) {
        throw new Error(
            "Impossible de récupérer le token Spotify (app)."
        );
    }

    const data = await response.json();

    spotifyAppToken = data.access_token;

    return spotifyAppToken;
}


/* ========== SPOTIFY WEB PLAYBACK SDK ========== */

function loadSpotifySDK() {
    return new Promise((resolve) => {
        if (window.Spotify) {
            resolve();
            return;
        }

        window.onSpotifyWebPlaybackSDKReady = () => resolve();

        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
    });
}

async function initSpotifyPlayer() {
    if (spotifyReady) {
        return;
    }

    await loadSpotifySDK();

    const token = await getSpotifyAccessToken();

    spotifyPlayer = new Spotify.Player({
        name: "Spotify Artists Dashboard",
        getOAuthToken: (callback) => {
            getSpotifyAccessToken().then(callback);
        }
    });

    spotifyPlayer.addListener("ready", ({ device_id }) => {
        spotifyDeviceId = device_id;
        spotifyReady = true;
        updatePlayerStatus(
            "Spotify prêt — clique sur une sortie"
        );
    });

    spotifyPlayer.addListener("not_ready", () => {
        spotifyReady = false;
        updatePlayerStatus("Spotify déconnecté");
    });

    spotifyPlayer.addListener(
        "player_state_changed",
        (state) => {
            if (!state) return;

            const track =
                state.track_window.current_track;

            if (track) {
                updatePlayerStatus(
                    `Lecture : ${track.name} — ${track.artists[0].name}`
                );
            }
        }
    );

    spotifyPlayer.connect();
}

function updatePlayerStatus(message) {
    const status = $("player-status");
    const bar = $("spotify-player-bar");

    if (status) {
        status.textContent = message;
    }

    if (bar) {
        bar.classList.remove("hidden");
    }
}

function getTrackUri(release) {
    if (release.uri) {
        return release.uri;
    }

    if (release.track_uri) {
        return release.track_uri;
    }

    const url = getReleaseURL(release);

    if (url) {
        const match = url.match(
            /track\/([a-zA-Z0-9]+)/
        );

        if (match) {
            return `spotify:track:${match[1]}`;
        }
    }

    return null;
}

async function searchTrackUri(release) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const query = encodeURIComponent(
        `${artist} ${title}`
    );

    const token = await getSpotifyAppToken();

    const response = await fetch(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    const track = data.tracks?.items?.[0];

    return track ? track.uri : null;
}

async function playRelease(release) {
    try {
        await initSpotifyPlayer();

        if (!spotifyReady || !spotifyDeviceId) {
            updatePlayerStatus(
                "Spotify n'est pas encore prêt, réessaie dans quelques secondes."
            );

            return;
        }

        let uri = getTrackUri(release);

        if (!uri) {
            uri = await searchTrackUri(release);
        }

        if (!uri) {
            updatePlayerStatus(
                "Aucun titre Spotify trouvé pour cette sortie."
            );

            return;
        }

        const token = await getSpotifyAccessToken();

        const response = await fetch(
            `https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    uris: [uri]
                })
            }
        );

        if (!response.ok) {
            updatePlayerStatus(
                "Erreur lors du lancement de la lecture."
            );

            return;
        }

        updatePlayerStatus(
            "Lecture lancée sur Spotify"
        );
    } catch (error) {
        console.error("Erreur Spotify :", error);
        updatePlayerStatus(
            "Erreur Spotify : " + error.message
        );
    }
}


/* ========== UTILITAIRES ========== */

const $ = id => document.getElementById(id);

const AMP = String.fromCharCode(38);

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll(AMP, AMP + "amp;")
        .replaceAll("<", AMP + "lt;")
        .replaceAll(">", AMP + "gt;")
        .replaceAll('"', AMP + "quot;")
        .replaceAll("'", AMP + "#39;");
}

function formatNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "—";
    }

    const n = Number(value);

    return Number.isNaN(n)
        ? escapeHTML(value)
        : new Intl.NumberFormat("fr-FR").format(n);
}

const normalizeText = value =>
    String(value ?? "").toLocaleLowerCase("fr-FR");


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
        if (part.type !== "literal") {
            result[part.type] = part.value;
        }
    }

    return `${result.year}-${result.month}-${result.day}`;
}

function normalizeDate(value) {
    if (!value) {
        return "";
    }

    const string = String(value).trim();

    const iso = string.match(
        /^(\d{4}-\d{2}-\d{2})/
    );

    if (iso) {
        return iso[1];
    }

    const french = string.match(
        /^(\d{2})\/(\d{2})\/(\d{4})/
    );

    return french
        ? `${french[3]}-${french[2]}-${french[1]}`
        : "";
}

function parseLocalDate(value) {
    const match = normalizeDate(value).match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(
        year,
        month - 1,
        day,
        12
    );

    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
}

function formatDate(value) {
    const normalized = normalizeDate(value);

    if (!normalized) {
        return "—";
    }

    const [year, month, day] =
        normalized.split("-");

    return `${day}/${month}/${year}`;
}

function formatReadableDate(value) {
    const date = parseLocalDate(value);

    return date
        ? date.toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        })
        : "Date inconnue";
}

function formatMonth(key) {
    const [year, month] = key.split("-");

    return new Date(
        Number(year),
        Number(month) - 1,
        1
    ).toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric"
    });
}

function toISO(date) {
    return `${date.getFullYear()}-${String(
        date.getMonth() + 1
    ).padStart(2, "0")}-${String(
        date.getDate()
    ).padStart(2, "0")}`;
}


/* ========== CHARGEMENT DES DONNÉES ========== */

async function loadJSON(path) {
    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(
            `Erreur HTTP ${response.status} : ${path}`
        );
    }

    const text = await response.text();

    if (!text.trim()) {
        throw new Error(`${path} est vide.`);
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `${path} contient un JSON invalide.`
        );
    }
}

function parseArtists(data) {
    if (!data) {
        return [];
    }

    if (Array.isArray(data)) {
        return data.filter(Boolean);
    }

    if (Array.isArray(data.artists)) {
        return data.artists.filter(Boolean);
    }

    if (
        data.artists &&
        typeof data.artists === "object"
    ) {
        return Object.values(
            data.artists
        ).filter(Boolean);
    }

    if (
        data.id ||
        data.name ||
        data.artist_name
    ) {
        return [data];
    }

    return Object.values(data).filter(
        value =>
            value &&
            typeof value === "object"
    );
}

function parseReleases(data) {
    if (!data) {
        return [];
    }

    if (Array.isArray(data)) {
        return data.filter(Boolean);
    }

    for (const key of [
        "tracks",
        "releases",
        "albums"
    ]) {
        if (Array.isArray(data[key])) {
            return data[key].filter(Boolean);
        }
    }

    return (
        data.id ||
        data.name ||
        data.release_date
    )
        ? [data]
        : [];
}


/* ========== ACCÈS AUX CHAMPS ========== */

const getReleaseDate = release =>
    normalizeDate(
        release?.release_date ??
        release?.releaseDate ??
        release?.date ??
        ""
    );

const getReleaseTitle = release =>
    release?.name ||
    release?.album_name ||
    release?.albumName ||
    release?.title ||
    "Titre inconnu";

const getReleaseArtist = release =>
    release?.artist_name ||
    release?.artistName ||
    release?.artist ||
    "Artiste inconnu";

const getReleaseImage = release =>
    release?.album_image ||
    release?.albumImage ||
    release?.image ||
    "";

const getReleaseURL = release =>
    release?.url ||
    release?.external_url ||
    release?.external_urls?.spotify ||
    "";

const getReleaseType = release =>
    String(
        release?.release_type ||
        release?.releaseType ||
        ""
    ).trim().toLowerCase();

const getArtistName = artist =>
    artist?.name ||
    artist?.artist_name ||
    "";

function matchesSearch(release, search) {
    if (!search) {
        return true;
    }

    const text = [
        getReleaseTitle(release),
        getReleaseArtist(release),
        release.album_name
    ]
        .filter(Boolean)
        .join(" ");

    return normalizeText(text).includes(search);
}


/* ========== DATE DU JOUR ========== */

function displayCurrentDate() {
    const today = getTodayParis();

    if ($("current-date")) {
        $("current-date").textContent =
            formatDate(today);
    }

    if ($("release-title")) {
        $("release-title").textContent =
            `Nouvelles sorties — ${formatDate(today)}`;
    }

    if ($("release-description")) {
        $("release-description").textContent =
            `Sorties prévues le ${formatReadableDate(today)}`;
    }
}


/* ========== SORTIES DU JOUR ========== */

function renderReleases() {
    const container = $("release-list");

    if (!container) {
        return;
    }

    const search = normalizeText(
        $("release-search")?.value.trim()
    );

    const today = getTodayParis();

    const list = releases
        .filter(release =>
            getReleaseDate(release) === today &&
            matchesSearch(release, search)
        )
        .sort((a, b) =>
            getReleaseTitle(a).localeCompare(
                getReleaseTitle(b),
                "fr-FR"
            )
        );

    if ($("release-count")) {
        $("release-count").textContent =
            formatNumber(list.length);
    }

    if (!list.length) {
        container.innerHTML = `
            <div class="empty">
                Aucune sortie trouvée pour le
                ${escapeHTML(formatDate(today))}.
            </div>
        `;

        return;
    }

    container.innerHTML = list
        .map((release, index) => {
            const title =
                getReleaseTitle(release);
            const image =
                getReleaseImage(release);
            const url = getReleaseURL(release);

            return `
                <article
                    class="release-card clickable"
                    data-release-index="${index}"
                >

                    ${
                        image
                            ? `
                                <img
                                    class="release-cover"
                                    src="${escapeHTML(image)}"
                                    alt="${escapeHTML(title)}"
                                    loading="lazy"
                                >
                            `
                            : `
                                <div class="release-cover"></div>
                            `
                    }

                    <div class="release-information">

                        <div class="release-type">
                            SORTIE DU JOUR
                        </div>

                        <div class="release-name">
                            ${escapeHTML(title)}
                        </div>

                        <div class="release-artist">
                            ${escapeHTML(
                                getReleaseArtist(release)
                            )}
                        </div>

                        <div class="release-album">
                            ${escapeHTML(
                                formatDate(today)
                            )}
                        </div>

                        ${
                            url
                                ? `
                                    <a
                                        class="spotify-button"
                                        href="${escapeHTML(url)}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Écouter sur Spotify
                                    </a>
                                `
                                : ""
                        }

                    </div>

                </article>
            `;
        })
        .join("");

    container.onclick = (event) => {
        const card = event.target.closest(
            ".release-card.clickable"
        );

        if (!card) {
            return;
        }

        const index = Number(
            card.dataset.releaseIndex
        );

        const release = list[index];

        if (release) {
            playRelease(release);
        }
    };
}


/* ========== TOUTES LES SORTIES ========== */

function renderCatalogCard(
    release,
    date,
    index
) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const image = getReleaseImage(release);
    const url = getReleaseURL(release);
    const type =
        getReleaseType(release) || "release";

    return `
        <article
            class="catalog-release-card clickable"
            data-release-index="${index}"
        >

            <div class="catalog-cover-wrapper">

                ${
                    image
                        ? `
                            <img
                                class="catalog-cover"
                                src="${escapeHTML(image)}"
                                alt="${escapeHTML(title)}"
                                loading="lazy"
                            >
                        `
                        : `
                            <div class="catalog-cover catalog-cover-empty">
                                <span>♪</span>
                            </div>
                        `
                }

                ${
                    url
                        ? `
                            <a
                                class="catalog-play"
                                href="${escapeHTML(url)}"
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Écouter ${escapeHTML(title)} sur Spotify"
                            >
                                ▶
                            </a>
                        `
                        : ""
                }

            </div>

            <div class="catalog-information">

                <div class="catalog-type">
                    ${escapeHTML(
                        type.toUpperCase()
                    )}
                </div>

                <div
                    class="catalog-title"
                    title="${escapeHTML(title)}"
                >
                    ${escapeHTML(title)}
                </div>

                <div
                    class="catalog-artist"
                    title="${escapeHTML(artist)}"
                >
                    ${escapeHTML(artist)}
                </div>

                <div class="catalog-footer">

                    <span>
                        ${
                            date === "unknown"
                                ? "—"
                                : escapeHTML(
                                    formatDate(date)
                                )
                        }
                    </span>

                    ${
                        url
                            ? `
                                <a
                                    href="${escapeHTML(url)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Spotify ↗
                                </a>
                            `
                            : ""
                    }

                </div>

            </div>

        </article>
    `;
}

function renderAllReleases() {
    const container = $(
        "all-release-list"
    );

    if (!container) {
        return;
    }

    const search = normalizeText(
        $("all-release-search")?.value.trim()
    );

    const sort =
        $("all-release-sort")?.value ||
        "newest";

    const filtered = releases.filter(
        release =>
            matchesSearch(release, search)
    );

    filtered.sort((a, b) => {
        const dateA = getReleaseDate(a);
        const dateB = getReleaseDate(b);

        if (!dateA && !dateB) {
            return 0;
        }

        if (!dateA) {
            return 1;
        }

        if (!dateB) {
            return -1;
        }

        return sort === "oldest"
            ? dateA.localeCompare(dateB)
            : dateB.localeCompare(dateA);
    });

    if ($("all-release-count")) {
        $("all-release-count").textContent =
            formatNumber(filtered.length);
    }

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty all-release-empty">

                <div class="empty-icon">
                    🎵
                </div>

                <strong>
                    Aucune sortie trouvée
                </strong>

                <p>
                    Essayez une autre recherche.
                </p>

            </div>
        `;

        return;
    }

    const groups = new Map();

    for (const release of filtered) {
        const date =
            getReleaseDate(release) ||
            "unknown";

        if (!groups.has(date)) {
            groups.set(date, []);
        }

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

                        <span class="release-day-label">
                            ${
                                unknown
                                    ? "DATE INCONNUE"
                                    : "SORTIES"
                            }
                        </span>

                        <h3>
                            ${
                                escapeHTML(
                                    unknown
                                        ? "Date inconnue"
                                        : formatReadableDate(date)
                                )
                            }
                        </h3>

                    </div>

                    <span class="release-day-count">
                        ${formatNumber(items.length)}
                        ${
                            items.length > 1
                                ? "sorties"
                                : "sortie"
                        }
                    </span>

                </div>

                <div class="release-day-grid">

                    ${items
                        .map(release => {
                            flatIndex.set(
                                currentIndex,
                                release
                            );

                            const card =
                                renderCatalogCard(
                                    release,
                                    date,
                                    currentIndex
                                );

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
        const card = event.target.closest(
            ".catalog-release-card.clickable"
        );

        if (!card) {
            return;
        }

        const index = Number(
            card.dataset.releaseIndex
        );

        const release = flatIndex.get(index);

        if (release) {
            playRelease(release);
        }
    };
}


/* ========== ARTISTES ========== */

function renderArtists() {
    const container = $("artist-table");

    if (!container) {
        return;
    }

    const search = normalizeText(
        $("artist-search")?.value.trim()
    );

    const sort =
        $("artist-sort")?.value ||
        "name";

    const filtered = artists.filter(
        artist =>
            normalizeText(
                getArtistName(artist)
            ).includes(search)
    );

    if (sort === "followers") {
        filtered.sort(
            (a, b) =>
                Number(b.followers || 0) -
                Number(a.followers || 0)
        );
    } else if (sort === "popularity") {
        filtered.sort(
            (a, b) =>
                Number(b.popularity || 0) -
                Number(a.popularity || 0)
        );
    } else {
        filtered.sort((a, b) =>
            getArtistName(a).localeCompare(
                getArtistName(b),
                "fr-FR",
                { sensitivity: "base" }
            )
        );
    }

    if ($("artist-count")) {
        $("artist-count").textContent =
            formatNumber(artists.length);
    }

    if (!filtered.length) {
        container.innerHTML = `
            <tr>
                <td colspan="6" class="muted">
                    Aucun artiste trouvé.
                </td>
            </tr>
        `;

        return;
    }

    container.innerHTML = filtered
        .map(artist => {
            const name =
                getArtistName(artist) ||
                "Artiste inconnu";

            const monthly =
                artist.monthly_listeners ??
                artist.monthlyListeners;

            const popularity =
                artist.popularity;

            const genres = Array.isArray(
                artist.genres
            )
                ? artist.genres.join(", ")
                : "";

            const url =
                artist.url ||
                artist.external_urls?.spotify ||
                "";

            return `
                <tr>

                    <td class="artist-name">

                        ${
                            url
                                ? `
                                    <a
                                        class="artist-link"
                                        href="${escapeHTML(url)}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        ${escapeHTML(name)}
                                    </a>
                                `
                                : escapeHTML(name)
                        }

                    </td>

                    <td>
                        ${formatNumber(
                            artist.followers
                        )}
                    </td>

                    <td>
                        ${formatNumber(monthly)}
                    </td>

                    <td>
                        ${
                            popularity !==
                                undefined &&
                            popularity !== null
                                ? escapeHTML(
                                    popularity
                                )
                                : "—"
                        }
                    </td>

                    <td class="genres-cell">
                        ${escapeHTML(
                            genres || "—"
                        )}
                    </td>

                    <td>

                        ${
                            url
                                ? `
                                    <a
                                        class="spotify-button"
                                        href="${escapeHTML(url)}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Spotify
                                    </a>
                                `
                                : "—"
                        }

                    </td>

                </tr>
            `;
        })
        .join("");
}


/* ========== STATISTIQUES ========== */

function calculateStatistics() {
    if (statsCache) {
        return statsCache;
    }

    const artistMap = new Map();
    const monthMap = new Map();
    const dates = [];

    const types = {
        single: 0,
        album: 0,
        ep: 0,
        other: 0
    };

    for (const release of releases) {
        const name =
            getReleaseArtist(release);

        const id =
            release.artist_id ||
            release.artistId ||
            normalizeText(name);

        if (!artistMap.has(id)) {
            artistMap.set(id, {
                name,
                count: 0
            });
        }

        artistMap.get(id).count++;

        const type = getReleaseType(release)
            .replace(/s$/, "");

        if (type === "single") {
            types.single++;
        } else if (type === "album") {
            types.album++;
        } else if (type === "ep") {
            types.ep++;
        } else {
            types.other++;
        }

        const date = parseLocalDate(
            getReleaseDate(release)
        );

        if (date) {
            dates.push(date);

            const key = toISO(date).slice(
                0,
                7
            );

            monthMap.set(
                key,
                (monthMap.get(key) || 0) + 1
            );
        }
    }

    const today = parseLocalDate(
        getTodayParis()
    );

    const countLastDays = days => {
        if (!today) {
            return 0;
        }

        const start = new Date(today);

        start.setDate(
            start.getDate() - days + 1
        );

        return dates.filter(
            date =>
                date >= start && date <= today
        ).length;
    };

    let oldest = null;
    let newest = null;

    for (const date of dates) {
        if (!oldest || date < oldest) {
            oldest = date;
        }

        if (!newest || date > newest) {
            newest = date;
        }
    }

    let busiest = null;

    for (const [key, count] of monthMap) {
        if (!busiest || count > busiest.count) {
            busiest = {
                key,
                count
            };
        }
    }

    statsCache = {
        total: releases.length,
        last7: countLastDays(7),
        last30: countLastDays(30),
        last365: countLastDays(365),
        activeArtists: artistMap.size,
        types,

        topArtists: [
            ...artistMap.values()
        ]
            .sort(
                (a, b) =>
                    b.count - a.count ||
                    a.name.localeCompare(b.name)
            )
            .slice(0, 10),

        months: [
            ...monthMap.entries()
        ].sort((a, b) =>
            a[0].localeCompare(b[0])
        ),

        oldest,
        newest,

        duration:
            oldest && newest
                ? Math.round(
                    (newest - oldest) /
                        86400000
                )
                : 0,

        busiest
    };

    return statsCache;
}

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}

function renderStatistics() {
    const s = calculateStatistics();

    setText(
        "stats-total",
        formatNumber(s.total)
    );
    setText(
        "stats-7-days",
        formatNumber(s.last7)
    );
    setText(
        "stats-30-days",
        formatNumber(s.last30)
    );
    setText(
        "stats-365-days",
        formatNumber(s.last365)
    );
    setText(
        "stats-artists-count",
        formatNumber(s.activeArtists)
    );
    setText(
        "stats-singles",
        formatNumber(s.types.single)
    );
    setText(
        "stats-albums",
        formatNumber(s.types.album)
    );
    setText(
        "stats-eps",
        formatNumber(s.types.ep)
    );
    setText(
        "stats-other",
        formatNumber(s.types.other)
    );

    /* Top artistes */

    const artistsContainer = $(
        "stats-artists"
    );

    if (artistsContainer) {
        artistsContainer.innerHTML =
            s.topArtists.length
                ? s.topArtists
                      .map((artist, index) => `
                          <div class="stats-row">

                              <span>

                                  <span class="artist-rank">
                                      ${index + 1}
                                  </span>

                                  ${escapeHTML(
                                      artist.name
                                  )}

                              </span>

                              <strong>
                                  ${formatNumber(
                                      artist.count
                                  )}
                              </strong>

                          </div>
                      `)
                      .join("")
                : `
                      <div class="empty">
                          Aucune donnée disponible.
                      </div>
                  `;
    }

    /* Évolution mensuelle */

    const monthsContainer = $(
        "stats-months"
    );

    if (monthsContainer) {
        if (!s.months.length) {
            monthsContainer.innerHTML = `
                <div class="empty">
                    Aucune date disponible.
                </div>
            `;
        } else {
            const max = Math.max(
                ...s.months.map(
                    month => month[1]
                )
            );

            monthsContainer.innerHTML =
                s.months
                    .map(([key, count]) => `
                        <div class="monthly-stat-row">

                            <div class="monthly-stat-header">

                                <span>
                                    ${escapeHTML(
                                        formatMonth(key)
                                    )}
                                </span>

                                <strong>
                                    ${formatNumber(count)}
                                </strong>

                            </div>

                            <div class="monthly-bar">

                                <div
                                    class="monthly-bar-fill"
                                    style="width:${
                                        max > 0
                                            ? (count / max) * 100
                                            : 0
                                    }%"
                                ></div>

                            </div>

                        </div>
                    `)
                    .join("");
        }
    }

    /* Résumé */

    const summary = $("stats-summary");

    if (!summary) {
        return;
    }

    if (!s.total) {
        summary.innerHTML = `
            <p>
                Aucune sortie disponible.
            </p>
        `;

        return;
    }

    if (!s.oldest) {
        summary.innerHTML = `
            <p>
                Le catalogue contient
                <strong>${formatNumber(s.total)}</strong>
                sortie(s), mais aucune date exploitable
                n'a été trouvée.
            </p>
        `;

        return;
    }

    let html = `
        <p>
            Le catalogue contient
            <strong>${formatNumber(s.total)}</strong>
            sortie(s).
        </p>

        <p>
            Les sorties couvrent la période du
            <strong>
                ${escapeHTML(
                    formatDate(toISO(s.oldest))
                )}
            </strong>
            au
            <strong>
                ${escapeHTML(
                    formatDate(toISO(s.newest))
                )}
            </strong>,
            soit
            <strong>${formatNumber(s.duration)}</strong>
            jour(s).
        </p>
    `;

    if (s.topArtists[0]) {
        html += `
            <p>
                L'artiste avec le plus de sorties est
                <strong>
                    ${escapeHTML(
                        s.topArtists[0].name
                    )}
                </strong>
                avec
                <strong>
                    ${formatNumber(
                        s.topArtists[0].count
                    )}
                </strong>
                sortie(s).
            </p>
        `;
    }

    if (s.busiest) {
        html += `
            <p>
                Le mois avec le plus de sorties est
                <strong>
                    ${escapeHTML(
                        formatMonth(s.busiest.key)
                    )}
                </strong>
                avec
                <strong>
                    ${formatNumber(
                        s.busiest.count
                    )}
                </strong>
                sortie(s).
            </p>
        `;
    }

    summary.innerHTML = html;
}


/* ========== INSTAGRAM FINDER ========== */

function renderInstagramFinder() {
    const container = $(
        "instagram-finder-card"
    );

    if (!container) {
        console.warn(
            "Instagram Finder : élément #instagram-finder-card introuvable."
        );

        return;
    }

    if (!window.spotifyArtistsRawData) {
        container.innerHTML = `
            <div class="empty">
                Les données des artistes ne sont pas encore disponibles.
            </div>
        `;

        return;
    }

    document.dispatchEvent(
        new CustomEvent(
            "instagram-finder-open",
            {
                detail: {
                    artists:
                        window.spotifyArtistsRawData
                }
            }
        )
    );
}


/* ========== NAVIGATION ========== */

function renderPage(target) {
    try {
        if (target === "releases") {
            renderReleases();
        } else if (target === "artists") {
            renderArtists();
        } else if (target === "all-releases") {
            renderAllReleases();
        } else if (target === "stats") {
            renderStatistics();
        } else if (
            target === "instagram-finder"
        ) {
            renderInstagramFinder();
        }
    } catch (error) {
        console.error(
            `Erreur d'affichage (${target}) :`,
            error
        );
    }
}

function setupNavigation() {
    const buttons = document.querySelectorAll(
        ".nav-button"
    );

    const pages = document.querySelectorAll(
        ".page"
    );

    buttons.forEach(button => {
        button.addEventListener(
            "click",
            () => {
                const target =
                    button.dataset.page;

                if (!target) {
                    return;
                }

                currentPage = target;

                buttons.forEach(navButton => {
                    navButton.classList.toggle(
                        "active",
                        navButton === button
                    );
                });

                pages.forEach(page => {
                    page.classList.toggle(
                        "active",
                        page.id ===
                            `page-${target}`
                    );
                });

                renderPage(target);
            }
        );
    });
}


/* ========== GESTION DES ERREURS ========== */

function showError(elementId, message) {
    const element = $(elementId);

    if (!element) {
        return;
    }

    element.innerHTML = `
        <div class="empty">

            <strong>
                Impossible de charger les données
            </strong>

            <p>
                ${escapeHTML(message)}
            </p>

        </div>
    `;
}


/* ========== INITIALISATION ========== */

async function initialize() {
    displayCurrentDate();

    const [
        releasesResult,
        artistsResult
    ] = await Promise.allSettled([
        loadJSON(RELEASES_FILE),
        loadJSON(ARTISTS_FILE)
    ]);

    /* Chargement des sorties */

    if (
        releasesResult.status === "fulfilled"
    ) {
        try {
            releases = parseReleases(
                releasesResult.value
            );

            statsCache = null;
        } catch (error) {
            console.error(
                "Erreur sorties.json :",
                error
            );
        }
    } else {
        console.error(
            "Erreur sorties.json :",
            releasesResult.reason
        );

        const message =
            releasesResult.reason?.message ||
            "Erreur inconnue";

        showError("release-list", message);
        showError(
            "all-release-list",
            message
        );
        showError(
            "stats-summary",
            message
        );
    }

    /* Chargement des artistes */

    if (
        artistsResult.status === "fulfilled"
    ) {
        window.spotifyArtistsRawData =
            artistsResult.value;

        artists = parseArtists(
            artistsResult.value
        );

        document.dispatchEvent(
            new CustomEvent(
                "spotify-artists-loaded",
                {
                    detail: {
                        rawData:
                            window.spotifyArtistsRawData,
                        artists
                    }
                }
            )
        );
    } else {
        console.error(
            "Erreur artistes.json :",
            artistsResult.reason
        );

        const message =
            artistsResult.reason?.message ||
            "Erreur inconnue";

        if ($("artist-table")) {
            $("artist-table").innerHTML = `
                <tr>
                    <td colspan="6" class="muted">
                        Impossible de charger les artistes :
                        ${escapeHTML(message)}
                    </td>
                </tr>
            `;
        }

        showError(
            "instagram-finder-card",
            message
        );
    }

    /* Affichage initial */

    if (
        releasesResult.status === "fulfilled"
    ) {
        renderPage("releases");
    }

    if (
        artistsResult.status === "fulfilled"
    ) {
        renderPage("artists");
    }

    if (
        currentPage === "instagram-finder"
    ) {
        renderPage("instagram-finder");
    }

    /* Connexion Spotify (callback PKCE) */
    const loggedIn =
        await handleSpotifyCallback();

    if (loggedIn) {
        await initSpotifyPlayer();
    }

    /* Si un token est déjà présent, on initialise le lecteur */
    const storedToken = localStorage.getItem(
        "spotify_access_token"
    );

    if (storedToken) {
        initSpotifyPlayer().catch(error => {
            console.error(
                "Erreur initialisation Spotify :",
                error
            );
        });
    }
}


/* ========== DÉMARRAGE ========== */

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const bindings = [
            [
                "release-search",
                "input",
                renderReleases
            ],
            [
                "artist-search",
                "input",
                renderArtists
            ],
            [
                "artist-sort",
                "change",
                renderArtists
            ],
            [
                "all-release-search",
                "input",
                renderAllReleases
            ],
            [
                "all-release-sort",
                "change",
                renderAllReleases
            ]
        ];

        for (const [
            id,
            event,
            handler
        ] of bindings) {
            $(id)?.addEventListener(
                event,
                handler
            );
        }

        setupNavigation();

        const closeButton = $(
            "player-close"
        );

        if (closeButton) {
            closeButton.addEventListener(
                "click",
                () => {
                    $(
                        "spotify-player-bar"
                    )?.classList.add(
                        "hidden"
                    );
                }
            );
        }

        const loginButton = $(
            "spotify-login"
        );

        if (loginButton) {
            loginButton.addEventListener(
