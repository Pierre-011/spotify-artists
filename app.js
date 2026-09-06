"use strict";

/* =========================================================
   CONFIGURATION
========================================================= */

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];


/* =========================================================
   OUTILS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "—";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return escapeHTML(value);
    }

    return new Intl.NumberFormat("fr-FR").format(number);
}


/* =========================================================
   DATE DU JOUR — EUROPE/PARIS
========================================================= */

function getTodayParis() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const date = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            date[part.type] = part.value;
        }
    }

    return `${date.year}-${date.month}-${date.day}`;
}

function formatDate(date) {
    if (!date) {
        return "—";
    }

    const cleanDate = String(date).trim().slice(0, 10);
    const parts = cleanDate.split("-");

    if (parts.length !== 3) {
        return cleanDate;
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatReadableDate(date) {
    const cleanDate = String(date).slice(0, 10);
    const parts = cleanDate.split("-");

    if (parts.length !== 3) {
        return cleanDate;
    }

    const parsedDate = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2]),
        12,
        0,
        0
    );

    return parsedDate.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}

function normalizeDate(value) {
    if (!value) {
        return "";
    }

    return String(value)
        .trim()
        .slice(0, 10);
}


/* =========================================================
   AFFICHAGE DE LA DATE DANS LE HTML
========================================================= */

function displayCurrentDate() {
    const today = getTodayParis();

    const currentDate = $("current-date");

    if (currentDate) {
        currentDate.textContent = formatDate(today);
    }

    const releaseTitle = $("release-title");

    if (releaseTitle) {
        releaseTitle.textContent =
            `Nouvelles sorties — ${formatDate(today)}`;
    }

    const releaseDescription = $("release-description");

    if (releaseDescription) {
        releaseDescription.textContent =
            `Sorties prévues le ${formatReadableDate(today)}`;
    }

    console.log("Date du jour utilisée :", today);
}


/* =========================================================
   CHARGEMENT DES FICHIERS JSON
========================================================= */

async function loadJSON(filePath) {
    const url = new URL(filePath, window.location.href);

    url.searchParams.set("t", Date.now());

    console.log("Chargement :", url.href);

    const response = await fetch(url.href, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            `Erreur HTTP ${response.status} pour ${url.pathname}`
        );
    }

    const text = await response.text();

    if (!text.trim()) {
        throw new Error(`${url.pathname} est vide.`);
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Le fichier ${url.pathname} n'est pas un JSON valide : ${error.message}`
        );
    }
}


/* =========================================================
   LECTURE DU JSON ARTISTES
========================================================= */

function parseArtists(data) {
    if (!data) {
        return [];
    }

    // Format : [...]
    if (Array.isArray(data)) {
        return data.filter(Boolean);
    }

    // Format : { artists: [...] }
    if (Array.isArray(data.artists)) {
        return data.artists.filter(Boolean);
    }

    // Format : { artists: { id: {...} } }
    if (
        data.artists &&
        typeof data.artists === "object"
    ) {
        return Object.values(data.artists).filter(
            artist =>
                artist &&
                typeof artist === "object"
        );
    }

    // Format : { id1: {...}, id2: {...} }
    if (
        typeof data === "object" &&
        !data.id &&
        !data.name
    ) {
        return Object.values(data).filter(
            artist =>
                artist &&
                typeof artist === "object"
        );
    }

    // Format : un seul artiste
    if (
        data.id ||
        data.name ||
        data.artist_name
    ) {
        return [data];
    }

    return [];
}


/* =========================================================
   LECTURE DU JSON SORTIES
========================================================= */

function parseReleases(data) {
    if (!data) {
        return [];
    }

    // Format : [...]
    if (Array.isArray(data)) {
        return data.filter(Boolean);
    }

    // Format : { releases: [...] }
    if (Array.isArray(data.releases)) {
        return data.releases.filter(Boolean);
    }

    // Format : { tracks: [...] }
    if (Array.isArray(data.tracks)) {
        return data.tracks.filter(Boolean);
    }

    // Format : { albums: [...] }
    if (Array.isArray(data.albums)) {
        return data.albums.filter(Boolean);
    }

    // Format : { releases: { id1: {...} } }
    if (
        data.releases &&
        typeof data.releases === "object"
    ) {
        return Object.values(data.releases)
            .flat()
            .filter(Boolean);
    }

    // Format : { tracks: { id1: {...} } }
    if (
        data.tracks &&
        typeof data.tracks === "object"
    ) {
        return Object.values(data.tracks).filter(Boolean);
    }

    // Format : { albums: { id1: {...} } }
    if (
        data.albums &&
        typeof data.albums === "object"
    ) {
        return Object.values(data.albums).filter(Boolean);
    }

    // Format : { id1: {...}, id2: {...} }
    if (
        typeof data === "object" &&
        !data.id &&
        !data.name &&
        !data.release_date
    ) {
        return Object.values(data).filter(
            release =>
                release &&
                typeof release === "object"
        );
    }

    // Format : une seule sortie
    if (
        data.id ||
        data.name ||
        data.release_date ||
        data.album_name
    ) {
        return [data];
    }

    return [];
}


/* =========================================================
   RECHERCHE
========================================================= */

function getSearchValue(id) {
    const element = $(id);

    if (!element) {
        return "";
    }

    return element.value
        .trim()
        .toLocaleLowerCase("fr-FR");
}


/* =========================================================
   AFFICHAGE DES SORTIES DU JOUR
========================================================= */

function getReleaseDate(release) {
    if (!release) return "";

    // Champs possibles selon la structure du JSON
    const rawDate =
        release.release_date ??
        release.releaseDate ??
        release.date ??
        release.published_at ??
        release.publishedAt ??
        "";

    if (!rawDate) return "";

    const value = String(rawDate).trim();

    // Format ISO : 2026-09-06, 2026-09-06T00:00:00.000Z, etc.
    const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        return isoMatch[1];
    }

    // Format français éventuel : 06/09/2026
    const frenchMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (frenchMatch) {
        const [, day, month, year] = frenchMatch;
        return `${year}-${month}-${day}`;
    }

    return "";
}

function renderReleases() {
    const container = $("release-list");
    const countElement = $("release-count");
    const searchElement = $("release-search");

    if (!container) return;

    const today = getTodayParis();

    const search = searchElement
        ? searchElement.value.trim().toLowerCase()
        : "";

    console.log("Date actuelle utilisée :", today);
    console.log("Nombre total de sorties :", releases.length);

    const releasesToday = releases.filter((release) => {
        const releaseDate = getReleaseDate(release);

        // Diagnostic utile dans la console
        if (releaseDate === today) {
            console.log("Sortie trouvée aujourd’hui :", release);
        }

        return releaseDate === today;
    });

    const filteredReleases = releasesToday.filter((release) => {
        if (!search) return true;

        const text = [
            release.name,
            release.artist_name,
            release.artistName,
            release.album_name,
            release.albumName,
            release.title
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return text.includes(search);
    });

    if (countElement) {
        countElement.textContent = `${filteredReleases.length} sortie${
            filteredReleases.length > 1 ? "s" : ""
        }`;
    }

    if (filteredReleases.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                Aucune sortie trouvée pour le ${formatDate(today)}.
            </div>
        `;
        return;
    }

    container.innerHTML = filteredReleases
        .sort((a, b) => {
            return String(a.name || "").localeCompare(
                String(b.name || ""),
                "fr"
            );
        })
        .map((release) => {
            const title =
                release.name ||
                release.album_name ||
                release.albumName ||
                "Titre inconnu";

            const artist =
                release.artist_name ||
                release.artistName ||
                "Artiste inconnu";

            const image =
                release.album_image ||
                release.albumImage ||
                release.image ||
                "";

            const url = release.url || release.external_url || "#";

            return `
                <article class="release-card">
                    ${
                        image
                            ? `
                                <img
                                    class="release-image"
                                    src="${escapeHTML(image)}"
                                    alt="${escapeHTML(title)}"
                                    loading="lazy"
                                >
                            `
                            : `
                                <div class="release-image release-image-empty">
                                    ♪
                                </div>
                            `
                    }

                    <div class="release-card-content">
                        <h3>${escapeHTML(title)}</h3>
                        <p>${escapeHTML(artist)}</p>
                        <small>${formatDate(today)}</small>

                        ${
                            url !== "#"
                                ? `
                                    <a
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
}


/* =========================================================
   AFFICHAGE DES ARTISTES
========================================================= */

function renderArtists() {
    const container = $("artist-table");

    if (!container) {
        console.error(
            "L'élément #artist-table est introuvable."
        );
        return;
    }

    const search = getSearchValue("artist-search");
    const sortElement = $("artist-sort");
    const sort = sortElement
        ? sortElement.value
        : "name";

    let filteredArtists = artists.filter(artist => {
        const name =
            artist.name ||
            artist.artist_name ||
            "";

        return name
            .toLocaleLowerCase("fr-FR")
            .includes(search);
    });

    if (sort === "followers") {
        filteredArtists.sort((a, b) => {
            return Number(b.followers || 0) -
                Number(a.followers || 0);
        });
    } else if (sort === "popularity") {
        filteredArtists.sort((a, b) => {
            return Number(b.popularity || 0) -
                Number(a.popularity || 0);
        });
    } else {
        filteredArtists.sort((a, b) => {
            const nameA =
                a.name ||
                a.artist_name ||
                "";

            const nameB =
                b.name ||
                b.artist_name ||
                "";

            return nameA.localeCompare(
                nameB,
                "fr-FR",
                { sensitivity: "base" }
            );
        });
    }

    const artistCount = $("artist-count");

    if (artistCount) {
        artistCount.textContent =
            formatNumber(artists.length);
    }

    if (filteredArtists.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" class="muted">
                    Aucun artiste trouvé.
                </td>
            </tr>
        `;

        return;
    }

    container.innerHTML = filteredArtists
        .map(artist => {
            const name =
                artist.name ||
                artist.artist_name ||
                "Artiste inconnu";

            const spotifyURL =
                artist.url ||
                artist.external_urls?.spotify ||
                "";

            const genres = Array.isArray(artist.genres)
                ? artist.genres.join(", ")
                : "";

            return `
                <tr>
                    <td class="artist-name">
                        ${
                            spotifyURL
                                ? `
                                    <a
                                        class="artist-link"
                                        href="${escapeHTML(spotifyURL)}"
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
                        ${formatNumber(artist.followers)}
                    </td>

                    <td>
                        ${formatNumber(
                            artist.monthly_listeners
                        )}
                    </td>

                    <td>
                        ${
                            artist.popularity !== undefined &&
                            artist.popularity !== null
                                ? escapeHTML(
                                    artist.popularity
                                )
                                : "—"
                        }
                    </td>

                    <td class="genres-cell">
                        ${escapeHTML(genres || "—")}
                    </td>

                    <td>
                        ${
                            spotifyURL
                                ? `
                                    <a
                                        class="spotify-button"
                                        href="${escapeHTML(spotifyURL)}"
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


/* =========================================================
   AFFICHAGE DES GENRES
========================================================= */

function renderGenres() {
    const container = $("genre-list");

    if (!container) {
        console.error(
            "L'élément #genre-list est introuvable."
        );
        return;
    }

    const genreCounts = {};

    for (const artist of artists) {
        if (
            !artist ||
            !Array.isArray(artist.genres)
        ) {
            continue;
        }

        for (const genre of artist.genres) {
            if (typeof genre !== "string") {
                continue;
            }

            const cleanGenre = genre.trim();

            if (!cleanGenre) {
                continue;
            }

            genreCounts[cleanGenre] =
                (genreCounts[cleanGenre] || 0) + 1;
        }
    }

    const genres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1]);

    if (genres.length === 0) {
        container.innerHTML = `
            <div class="empty">
                Aucun genre disponible.
            </div>
        `;

        return;
    }

    container.innerHTML = genres
        .map(([genre, count]) => {
            return `
                <div class="genre-card">
                    <div class="genre-count">
                        ${formatNumber(count)}
                    </div>

                    <div class="genre-name">
                        ${escapeHTML(genre)}
                    </div>
                </div>
            `;
        })
        .join("");
}


/* =========================================================
   NAVIGATION
========================================================= */

function setupNavigation() {
    const buttons =
        document.querySelectorAll(".nav-button");

    const pages =
        document.querySelectorAll(".page");

    buttons.forEach(button => {
        button.addEventListener("click", () => {
            const target = button.dataset.page;

            if (!target) {
                return;
            }

            buttons.forEach(item => {
                item.classList.remove("active");
            });

            pages.forEach(page => {
                page.classList.remove("active");
            });

            button.classList.add("active");

            const targetPage = $(`page-${target}`);

            if (targetPage) {
                targetPage.classList.add("active");
            }
        });
    });
}


/* =========================================================
   INITIALISATION
========================================================= */

async function initialize() {
    displayCurrentDate();

    try {
        const [artistsData, releasesData] =
            await Promise.all([
                loadJSON(ARTISTS_FILE),
                loadJSON(RELEASES_FILE)
            ]);

        console.log(
            "Contenu du JSON artistes :",
            artistsData
        );

        console.log(
            "Contenu du JSON sorties :",
            releasesData
        );

        artists = parseArtists(artistsData);
        releases = parseReleases(releasesData);

        console.log(
            "Nombre d'artistes après lecture :",
            artists.length
        );

        console.log(
            "Nombre de sorties après lecture :",
            releases.length
        );

        console.log(
            "Date actuelle utilisée :",
            getTodayParis()
        );

        renderArtists();
        renderReleases();
        renderGenres();
    } catch (error) {
        console.error(
            "Erreur pendant le chargement :",
            error
        );

        const releaseList = $("release-list");

        if (releaseList) {
            releaseList.innerHTML = `
                <div class="empty">
                    <strong>Erreur de chargement</strong>
                    <p>
                        ${escapeHTML(error.message)}
                    </p>
                    <p>
                        Vérifie les fichiers :
                    </p>
                    <code>data/artistes.json</code>
                    <br>
                    <code>data/sorties.json</code>
                </div>
            `;
        }

        const artistTable = $("artist-table");

        if (artistTable) {
            artistTable.innerHTML = `
                <tr>
                    <td colspan="6" class="muted">
                        Impossible de charger les artistes.
                        <br>
                        ${escapeHTML(error.message)}
                    </td>
                </tr>
            `;
        }

        const genreList = $("genre-list");

        if (genreList) {
            genreList.innerHTML = `
                <div class="empty">
                    Impossible de charger les genres.
                </div>
            `;
        }
    }
}


/* =========================================================
   DÉMARRAGE
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    const artistSearch = $("artist-search");

    if (artistSearch) {
        artistSearch.addEventListener(
            "input",
            renderArtists
        );
    }

    const artistSort = $("artist-sort");

    if (artistSort) {
        artistSort.addEventListener(
            "change",
            renderArtists
        );
    }

    const releaseSearch = $("release-search");

    if (releaseSearch) {
        releaseSearch.addEventListener(
            "input",
            renderReleases
        );
    }

    setupNavigation();
    initialize();
});
