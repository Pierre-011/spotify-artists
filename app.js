"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];
let currentPage = "releases";
let statsCache = null;

/* ========== UTILITAIRES ========== */

const $ = id => document.getElementById(id);

/* Les entités sont écrites avec \u0026 pour ne pas être décodées au copier-coller */
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
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    return Number.isNaN(n) ? escapeHTML(value) : new Intl.NumberFormat("fr-FR").format(n);
}

const normalizeText = value => String(value ?? "").toLocaleLowerCase("fr-FR");

/* ========== DATES ========== */

function getTodayParis() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const r = {};
    for (const p of parts) if (p.type !== "literal") r[p.type] = p.value;
    return `${r.year}-${r.month}-${r.day}`;
}

function normalizeDate(value) {
    if (!value) return "";
    const s = String(value).trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : "";
}

function parseLocalDate(value) {
    const m = normalizeDate(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d, 12);
    return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

function formatDate(value) {
    const n = normalizeDate(value);
    if (!n) return "—";
    const [y, m, d] = n.split("-");
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
    return new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function toISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ========== CHARGEMENT ========== */

async function loadJSON(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Erreur HTTP ${response.status} : ${path}`);
    const text = await response.text();
    if (!text.trim()) throw new Error(`${path} est vide.`);
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${path} contient un JSON invalide.`);
    }
}

function parseArtists(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean);
    if (Array.isArray(data.artists)) return data.artists.filter(Boolean);
    if (data.artists && typeof data.artists === "object") return Object.values(data.artists).filter(Boolean);
    if (data.id || data.name || data.artist_name) return [data];
    return Object.values(data).filter(v => v && typeof v === "object");
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

const getReleaseDate = r => normalizeDate(r?.release_date ?? r?.releaseDate ?? r?.date ?? "");
const getReleaseTitle = r => r?.name || r?.album_name || r?.albumName || r?.title || "Titre inconnu";
const getReleaseArtist = r => r?.artist_name || r?.artistName || r?.artist || "Artiste inconnu";
const getReleaseImage = r => r?.album_image || r?.albumImage || r?.image || "";
const getReleaseURL = r => r?.url || r?.external_url || r?.external_urls?.spotify || "";
const getReleaseType = r => String(r?.release_type || r?.releaseType || "").trim().toLowerCase();
const getArtistName = a => a?.name || a?.artist_name || "";

function matchesSearch(release, search) {
    if (!search) return true;
    const text = [getReleaseTitle(release), getReleaseArtist(release), release.album_name]
        .filter(Boolean).join(" ");
    return normalizeText(text).includes(search);
}

/* ========== DATE DU JOUR ========== */

function displayCurrentDate() {
    const today = getTodayParis();
    if ($("current-date")) $("current-date").textContent = formatDate(today);
    if ($("release-title")) $("release-title").textContent = `Nouvelles sorties — ${formatDate(today)}`;
    if ($("release-description")) $("release-description").textContent = `Sorties prévues le ${formatReadableDate(today)}`;
}

/* ========== SORTIES DU JOUR ========== */

function renderReleases() {
    const container = $("release-list");
    if (!container) return;

    const search = normalizeText($("release-search")?.value.trim());
    const today = getTodayParis();

    const list = releases
        .filter(r => getReleaseDate(r) === today && matchesSearch(r, search))
        .sort((a, b) => getReleaseTitle(a).localeCompare(getReleaseTitle(b), "fr-FR"));

    if ($("release-count")) $("release-count").textContent = formatNumber(list.length);

    if (!list.length) {
        container.innerHTML = `<div class="empty">Aucune sortie trouvée pour le ${escapeHTML(formatDate(today))}.</div>`;
        return;
    }

    container.innerHTML = list.map(release => {
        const title = getReleaseTitle(release);
        const image = getReleaseImage(release);
        const url = getReleaseURL(release);
        return `
            <article class="release-card">
                ${image
                    ? `<img class="release-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy">`
                    : `<div class="release-cover"></div>`}
                <div class="release-information">
                    <div class="release-type">SORTIE DU JOUR</div>
                    <div class="release-name">${escapeHTML(title)}</div>
                    <div class="release-artist">${escapeHTML(getReleaseArtist(release))}</div>
                    <div class="release-album">${escapeHTML(formatDate(today))}</div>
                    ${url ? `<a class="spotify-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Écouter sur Spotify</a>` : ""}
                </div>
            </article>`;
    }).join("");
}

/* ========== TOUTES LES SORTIES ========== */

function renderCatalogCard(release, date) {
    const title = getReleaseTitle(release);
    const artist = getReleaseArtist(release);
    const image = getReleaseImage(release);
    const url = getReleaseURL(release);
    const type = getReleaseType(release) || "release";

    return `
        <article class="catalog-release-card">
            <div class="catalog-cover-wrapper">
                ${image
                    ? `<img class="catalog-cover" src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy">`
                    : `<div class="catalog-cover catalog-cover-empty"><span>♪</span></div>`}
                ${url ? `<a class="catalog-play" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="Écouter ${escapeHTML(title)} sur Spotify">▶</a>` : ""}
            </div>
            <div class="catalog-information">
                <div class="catalog-type">${escapeHTML(type.toUpperCase())}</div>
                <div class="catalog-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div>
                <div class="catalog-artist" title="${escapeHTML(artist)}">${escapeHTML(artist)}</div>
                <div class="catalog-footer">
                    <span>${date === "unknown" ? "—" : escapeHTML(formatDate(date))}</span>
                    ${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Spotify ↗</a>` : ""}
                </div>
            </div>
        </article>`;
}

function renderAllReleases() {
    const container = $("all-release-list");
    if (!container) return;

    const search = normalizeText($("all-release-search")?.value.trim());
    const sort = $("all-release-sort")?.value || "newest";

    const filtered = releases.filter(r => matchesSearch(r, search));

    filtered.sort((a, b) => {
        const da = getReleaseDate(a);
        const db = getReleaseDate(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return sort === "oldest" ? da.localeCompare(db) : db.localeCompare(da);
    });

    if ($("all-release-count")) $("all-release-count").textContent = formatNumber(filtered.length);

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty all-release-empty">
                <div class="empty-icon">🎵</div>
                <strong>Aucune sortie trouvée</strong>
                <p>Essayez une autre recherche.</p>
            </div>`;
        return;
    }

    const groups = new Map();
    for (const release of filtered) {
        const date = getReleaseDate(release) || "unknown";
        if (!groups.has(date)) groups.set(date, []);
        groups.get(date).push(release);
    }

    const html = [];
    for (const [date, items] of groups) {
        const unknown = date === "unknown";
        html.push(`
            <section class="release-day">
                <div class="release-day-header">
                    <div>
                        <span class="release-day-label">${unknown ? "DATE INCONNUE" : "SORTIES"}</span>
                        <h3>${escapeHTML(unknown ? "Date inconnue" : formatReadableDate(date))}</h3>
                    </div>
                    <span class="release-day-count">${formatNumber(items.length)} ${items.length > 1 ? "sorties" : "sortie"}</span>
                </div>
                <div class="release-day-grid">
                    ${items.map(r => renderCatalogCard(r, date)).join("")}
                </div>
            </section>`);
    }
    container.innerHTML = html.join("");
}

/* ========== ARTISTES ========== */

function renderArtists() {
    const container = $("artist-table");
    if (!container) return;

    const search = normalizeText($("artist-search")?.value.trim());
    const sort = $("artist-sort")?.value || "name";

    const filtered = artists.filter(a => normalizeText(getArtistName(a)).includes(search));

    if (sort === "followers") {
        filtered.sort((a, b) => Number(b.followers || 0) - Number(a.followers || 0));
    } else if (sort === "popularity") {
        filtered.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
    } else {
        filtered.sort((a, b) => getArtistName(a).localeCompare(getArtistName(b), "fr-FR", { sensitivity: "base" }));
    }

    if ($("artist-count")) $("artist-count").textContent = formatNumber(artists.length);

    if (!filtered.length) {
        container.innerHTML = `<tr><td colspan="6" class="muted">Aucun artiste trouvé.</td></tr>`;
        return;
    }

    container.innerHTML = filtered.map(artist => {
        const name = getArtistName(artist) || "Artiste inconnu";
        const monthly = artist.monthly_listeners ?? artist.monthlyListeners;
        const popularity = artist.popularity;
        const genres = Array.isArray(artist.genres) ? artist.genres.join(", ") : "";
        const url = artist.url || artist.external_urls?.spotify || "";

        return `
            <tr>
                <td class="artist-name">
                    ${url
                        ? `<a class="artist-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(name)}</a>`
                        : escapeHTML(name)}
                </td>
                <td>${formatNumber(artist.followers)}</td>
                <td>${formatNumber(monthly)}</td>
                <td>${popularity !== undefined && popularity !== null ? escapeHTML(popularity) : "—"}</td>
                <td class="genres-cell">${escapeHTML(genres || "—")}</td>
                <td>
                    ${url ? `<a class="spotify-button" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Spotify</a>` : "—"}
                </td>
            </tr>`;
    }).join("");
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

    const countLastDays = days => {
        if (!today) return 0;
        const start = new Date(today);
        start.setDate(start.getDate() - days + 1);
        return dates.filter(d => d >= start && d <= today).length;
    };

    let oldest = null;
    let newest = null;
    for (const d of dates) {
        if (!oldest || d < oldest) oldest = d;
        if (!newest || d > newest) newest = d;
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
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr-FR"))
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
    const el = $(id);
    if (el) el.textContent = value;
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

    /* Top artistes */
    $("stats-artists").innerHTML = s.topArtists.length
        ? s.topArtists.map((a, i) => `
            <div class="stats-row">
                <span><span class="artist-rank">${i + 1}</span>${escapeHTML(a.name)}</span>
                <strong>${formatNumber(a.count)}</strong>
            </div>`).join("")
        : `<div class="empty">Aucune donnée disponible.</div>`;

    /* Évolution mensuelle */
    if (!s.months.length) {
        $("stats-months").innerHTML = `<div class="empty">Aucune date disponible.</div>`;
    } else {
        const max = Math.max(...s.months.map(m => m[1]));
        $("stats-months").innerHTML = s.months.map(([key, count]) => `
            <div class="monthly-stat-row">
                <div class="monthly-stat-header">
                    <span>${escapeHTML(formatMonth(key))}</span>
                    <strong>${formatNumber(count)}</strong>
                </div>
                <div class="monthly-bar">
                    <div class="monthly-bar-fill" style="width:${max > 0 ? (count / max) * 100 : 0}%"></div>
                </div>
            </div>`).join("");
    }

    /* Résumé */
    const summary = $("stats-summary");

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
        <p>Les sorties couvrent la période du <strong>${escapeHTML(formatDate(toISO(s.oldest)))}</strong>
        au <strong>${escapeHTML(formatDate(toISO(s.newest)))}</strong>,
        soit <strong>${formatNumber(s.duration)}</strong> jour(s).</p>`;

    if (s.topArtists[0]) {
        html += `<p>L'artiste avec le plus de sorties est <strong>${escapeHTML(s.topArtists[0].name)}</strong>
        avec <strong>${formatNumber(s.topArtists[0].count)}</strong> sortie(s).</p>`;
    }
    if (s.busiest) {
        html += `<p>Le mois avec le plus de sorties est <strong>${escapeHTML(formatMonth(s.busiest.key))}</strong>
        avec <strong>${formatNumber(s.busiest.count)}</strong> sortie(s).</p>`;
    }
    summary.innerHTML = html;
}

/* ========== NAVIGATION ========== */

function renderPage(target) {
    try {
        if (target === "releases") renderReleases();
        else if (target === "artists") renderArtists();
        else if (target === "all-releases") renderAllReleases();
        else if (target === "stats") renderStatistics();
    } catch (error) {
        console.error(`Erreur d'affichage (${target}) :`, error);
    }
}

function setupNavigation() {
    const buttons = document.querySelectorAll(".nav-button");
    const pages = document.querySelectorAll(".page");

    buttons.forEach(button => {
        button.addEventListener("click", () => {
            const target = button.dataset.page;
            if (!target) return;

            currentPage = target;
            buttons.forEach(b => b.classList.toggle("active", b === button));
            pages.forEach(p => p.classList.toggle("active", p.id === `page-${target}`));

            renderPage(target);
        });
    });
}

/* ========== INITIALISATION ========== */

function showError(elementId, message) {
    const el = $(elementId);
    if (el) {
        el.innerHTML = `<div class="empty"><strong>Impossible de charger les données</strong><p>${escapeHTML(message)}</p></div>`;
    }
}

async function initialize() {
    displayCurrentDate();

    const [releasesResult, artistsResult] = await Promise.allSettled([
        loadJSON(RELEASES_FILE),
        loadJSON(ARTISTS_FILE)
    ]);

    if (releasesResult.status === "fulfilled") {
        try {
            releases = parseReleases(releasesResult.value);
        } catch (error) {
            console.error("Erreur sorties.json :", error);
        }
    } else {
        console.error("Erreur sorties.json :", releasesResult.reason);
        const message = releasesResult.reason.message;
        showError("release-list", message);
        showError("all-release-list", message);
        showError("stats-summary", message);
    }

    if (artistsResult.status === "fulfilled") {
        artists = parseArtists(artistsResult.value);
    } else {
        console.error("Erreur artistes.json :", artistsResult.reason);
        if ($("artist-table")) {
            $("artist-table").innerHTML = `<tr><td colspan="6" class="muted">Impossible de charger les artistes : ${escapeHTML(artistsResult.reason.message)}</td></tr>`;
        }
    }

    /* Affichage de la page active, puis pré-remplissage de l'onglet des sorties du jour */
    if (releasesResult.status === "fulfilled") {
        renderPage("releases");
        if (currentPage !== "releases") renderPage(currentPage);
    }
    if (artistsResult.status === "fulfilled") renderPage("artists");
}

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
    initialize();
});
