"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];
let currentPage = "releases";
let statsCache = null;

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

function debounce(fn, delay = 200) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

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

/* ========== LECTEUR SPOTIFY INTÉGRÉ (sans compte Premium) ========== */

let currentEmbedKey = null;
let playerResizeObserver = null;

function updatePlayerStatus(message) {
    const status = $("player-status");
    const bar = $("spotify-player-bar");
    if (status) status.textContent = message;
    if (bar) bar.classList.remove("hidden");
    document.body.classList.add("has-player");
}

function closePlayer() {
    $("spotify-player-bar")?.classList.add("hidden");
    document.body.classList.remove("has-player");

    const embed = $("player-embed");
    if (embed) {
        embed.innerHTML = ""; // supprime le lecteur : la lecture et son coût s'arrêtent
        delete embed.dataset.type;
    }
    currentEmbedKey = null;
}

// Adapte l'espace réservé en bas de page à la hauteur réelle de la barre.
function watchPlayerHeight() {
    const bar = $("spotify-player-bar");
    if (!bar || playerResizeObserver || !("ResizeObserver" in window)) return;

    playerResizeObserver = new ResizeObserver(() => {
        document.documentElement.style.setProperty("--player-height", `${bar.offsetHeight}px`);
    });
    playerResizeObserver.observe(bar);
}

function getEmbedInfo(release) {
    const candidates = [release.uri, release.track_uri, getReleaseURL(release)].filter(Boolean);

    for (const value of candidates) {
        const text = String(value);
        const match =
            text.match(/spotify:(track|album|playlist|episode):([a-zA-Z0-9]+)/) ||
            text.match(/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
        if (match) return { type: match[1], id: match[2] };
    }

    return null;
}

function playRelease(release) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const info = getEmbedInfo(release);

    // Pas de lien Spotify exploitable : on ouvre une recherche Spotify dans un nouvel onglet.
    if (!info) {
        const query = encodeURIComponent(`${artist} ${title}`);
        window.open(`https://open.spotify.com/search/${query}`, "_blank", "noopener,noreferrer");
        return;
    }

    const container = $("player-embed");
    if (!container) return;

    updatePlayerStatus(`${title} — ${artist}`);

    // Même sortie déjà chargée : on ne recharge pas le lecteur (évite un chargement inutile).
    const key = `${info.type}:${info.id}`;
    if (key === currentEmbedKey && container.firstElementChild) return;
    currentEmbedKey = key;

    const kind = info.type === "track" || info.type === "episode" ? "track" : "album";
    container.dataset.type = kind;

    container.innerHTML =
        `<iframe title="Lecteur Spotify" ` +
        `src="https://open.spotify.com/embed/${info.type}/${info.id}?utm_source=generator" ` +
        `width="100%" height="${kind === "track" ? 80 : 152}" frameborder="0" ` +
        `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
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
                            ? `<img class="release-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy" decoding="async">`
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
                        ? `<img class="catalog-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy" decoding="async">`
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
        $(id)?.addEventListener(event, event === "input" ? debounce(handler, 200) : handler);
    }

    setupNavigation();
    watchPlayerHeight();

    const closeButton = $("player-close");
    if (closeButton) {
        closeButton.addEventListener("click", () => {
            closePlayer();
        });
    }

    initialize().catch((error) => {
        console.error("Erreur pendant l'initialisation du dashboard :", error);
    });
});
