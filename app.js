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
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return escapeHTML(value);
    }

    return new Intl.NumberFormat("fr-FR").format(number);
}


/* =========================================================
   DATES

   Toutes les dates sont calculées avec le fuseau Europe/Paris.
========================================================= */

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

function formatDate(date) {
    if (!date) {
        return "";
    }

    const value = String(date).slice(0, 10);
    const parts = value.split("-");

    if (parts.length !== 3) {
        return value;
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatReadableDate(date) {
    if (!date) {
        return "";
    }

    const parts = String(date).slice(0, 10).split("-");

    if (parts.length !== 3) {
        return String(date);
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

    /*
      Accepte notamment :
      2026-09-06
      2026-09-06T00:00:00Z
      2026-09-06 00:00:00
    */
    return String(value).trim().slice(0, 10);
}


/* =========================================================
   CHARGEMENT DES JSON
========================================================= */

async function loadJSON(filePath) {
    const url = new URL(filePath, window.location.href);
    url.searchParams.set("cache", Date.now());

    console.log("Chargement du fichier :", url.href);

    const response = await fetch(url.href, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            `Impossible de charger ${url.pathname} — erreur HTTP ${response.status}`
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
            `${url.pathname} ne contient pas un JSON valide : ${error.message}`
        );
    }
}


/* =========================================================
   NORMALISATION DES ARTISTES
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

    // Format : { artists: { "id": {...}, "id2": {...} } }
    if (
        data.artists &&
        typeof data.artists === "object"
    ) {
        return Object.values(data.artists).filter(
            artist => artist && typeof artist === "object"
        );
    }

    // Format : { "id1": {...}, "id2": {...} }
    if (
        typeof data === "object" &&
        !data.id &&
        !data.name
    ) {
        return Object.values(data).filter(
            artist => artist && typeof artist === "object"
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
   NORMALISATION DES SORTIES
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

    // Format :
    // {
    //   "releases": {
    //      "2026-09-06": [...],
    //      "2026-09-07": [...]
    //   }
    // }
    if (
        data.releases &&
        typeof data.releases === "object"
    ) {
        return Object.values(data.releases)
            .flat()
            .filter(Boolean);
    }

    // Format :
    // {
    //   "tracks": {
    //      "id1": {...},
    //      "id2": {...}
    //   }
    // }
    if (
        data.tracks &&
        typeof data.tracks === "object"
    ) {
        return Object.values(data.tracks).filter(Boolean);
    }

    // Format :
    // {
    //   "id1": {...},
    //   "id2": {...}
    // }
    if (
        typeof data === "object" &&
        !data.id &&
        !data.name &&
        !data.release_date
    ) {
        return Object.values(data).filter(
            release => release && typeof release === "object"
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
   AFFICHAGE DE LA DATE DU JOUR
========================================================= */

function displayCurrentDate() {
    const today = getTodayParis();

    const currentDateElement = $("current-date");

    if (currentDateElement) {
        currentDateElement.textContent = formatDate(today);
    }

    const todayDateElement = $("today-date");

    if (todayDateElement) {
        todayDateElement.textContent = formatReadableDate(today);
    }

    const releaseTitleElement = $("release-title");

    if (releaseTitleElement) {
        releaseTitleElement.textContent =
            `Nouvelles sorties — ${formatDate(today)}`;
    }

    const releaseDescriptionElement = $("release-description");

    if (releaseDescriptionElement) {
        releaseDescriptionElement.textContent =
            `Sorties du ${formatReadableDate(today)}`;
    }

    console.log("Date utilisée pour le filtre :", today);
}


/* =========================================================
   RECHERCHE
========================================================= */

function getSearchValue(elementId) {
    const element = $(elementId);

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

function renderReleases() {
    const container = $("release-list");

    if (!container) {
        console.error("Élément #release-list introuvable dans le HTML.");
        return;
    }

    const today = getTodayParis();
    const search = getSearchValue("release-search");

    console.log("Toutes les sorties chargées :", releases.length);
    console.log("Date recherchée :", today);

    let todayReleases = releases.filter(release => {
        if (!release || !release.release_date) {
            return false;
        }

        const releaseDate = normalizeDate(release.release_date);

        return releaseDate === today;
    });

    const totalToday = todayReleases.length;

    if (search) {
        todayReleases = todayReleases.filter(release => {
            const searchableText = [
                release.name,
                release.artist_name,
                release.album_name,
                release.release_type
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("fr-FR");

            return searchableText.includes(search);
        });
    }

    const countElement = $("release-count");

    if (countElement) {
        countElement.textContent = formatNumber(totalToday);
    }

    if (todayReleases.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div>🎵</div>
                <p>Aucune sortie trouvée pour le ${formatDate(today)}.</p>
                <small>
                    ${releases.length} sortie(s) chargée(s) au total.
                </small>
            </div>
        `;

        return;
    }

    container.innerHTML = todayReleases
        .map(release => {
            const title =
                release.name ||
                release.album_name ||
                "Titre inconnu";

            const artist =
                release.artist_name ||
                "Artiste inconnu";

            const album =
                release.album_name || "";

            const image =
                release.album_image ||
                (
                    Array.isArray(release.images)
                        ? release.images[0]
                        : ""
                );

            const spotifyURL =
                release.url ||
                release.external_urls?.spotify ||
                "";

            const releaseType =
                release.release_type ||
                "Sortie";

            return `
                <article class="release-card">
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
                                <div class="release-cover">
                                    🎵
                                </div>
                            `
                    }

                    <div class="release-information">
                        <div class="release-type">
                            ${escapeHTML(releaseType.toUpperCase())}
                        </div>

                        <div class="release-name">
                            ${escapeHTML(title)}
                        </div>

                        <div class="release-artist">
                            ${escapeHTML(artist)}
                        </div>

                        <div class="release-album">
                            ${escapeHTML(album)}
                            · ${formatDate(release.release_date)}
                        </div>

                        ${
                            spotifyURL
                                ? `
                                    <a
                                        class="spotify-button"
                                        href="${escapeHTML(spotifyURL)}"
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
        console.error("Élément #artist-table introuvable dans le HTML.");
        return;
    }

    const search = getSearchValue("artist-search");
    const sortElement = $("artist-sort");
    const sort = sortElement ? sortElement.value : "name";

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
            return (
                Number(b.followers || 0) -
                Number(a.followers || 0)
            );
        });
    } else if (sort === "monthly_listeners") {
        filteredArtists.sort((a, b) => {
            return (
                Number(b.monthly_listeners || 0) -
                Number(a.monthly_listeners || 0)
            );
        });
    } else if (sort === "popularity") {
        filteredArtists.sort((a, b) => {
            return (
                Number(b.popularity || 0) -
                Number(a.popularity || 0)
            );
        });
    } else {
        filteredArtists.sort((a, b) => {
            const nameA = a.name || a.artist_name || "";
            const nameB = b.name || b.artist_name || "";

            return nameA.localeCompare(
                nameB,
                "fr-FR",
                { sensitivity: "base" }
            );
        });
    }

    const artistCount = $("artist-count");

    if (artistCount) {
        artistCount.textContent = formatNumber(artists.length);
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
                        ${formatNumber(artist.monthly_listeners)}
                    </td>

                    <td>
                        ${
                            artist.popularity !== undefined &&
                            artist.popularity !== null
                                ? escapeHTML(artist.popularity)
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
        console.error("Élément #genre-list introuvable dans le HTML.");
        return;
    }

    const genreCounts = {};

    for (const artist of artists) {
        if (!artist || !Array.isArray(artist.genres)) {
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
    const buttons = document.querySelectorAll(".nav-button");
    const pages = document.querySelectorAll(".page");

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
   AFFICHAGE DES ERREURS
========================================================= */

function displayLoadingError(error) {
    console.error("Erreur de chargement :", error);

    const message = `
        <div class="empty">
            <strong>Erreur de chargement</strong>
            <p>${escapeHTML(error.message)}</p>
            <p>
                Vérifie que ces fichiers existent bien sur GitHub :
            </p>
            <code>data/artistes.json</code>
            <br>
            <code>data/sorties.json</code>
        </div>
    `;

    const releaseList = $("release-list");

    if (releaseList) {
        releaseList.innerHTML = message;
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


/* =========================================================
   INITIALISATION
========================================================= */

async function initialize() {
    displayCurrentDate();

    try {
        console.log("Début du chargement des données.");

        const [artistsData, releasesData] = await Promise.all([
            loadJSON(ARTISTS_FILE),
            loadJSON(RELEASES_FILE)
        ]);

        console.log("JSON artistes reçu :", artistsData);
        console.log("JSON sorties reçu :", releasesData);

        artists = parseArtists(artistsData);
        releases = parseReleases(releasesData);

        console.log("Nombre d’artistes :", artists.length);
        console.log("Nombre de sorties :", releases.length);

        const today = getTodayParis();

        const releasesToday = releases.filter(release => {
            return normalizeDate(release.release_date) === today;
        });

        console.log(
            `Nombre de sorties pour ${today} :`,
            releasesToday.length
        );

        renderArtists();
        renderReleases();
        renderGenres();
    } catch (error) {
        displayLoadingError(error);
    }
}


/* =========================================================
   DÉMARRAGE
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    const artistSearch = $("artist-search");

    if (artistSearch) {
        artistSearch.addEventListener("input", renderArtists);
    }

    const artistSort = $("artist-sort");

    if (artistSort) {
        artistSort.addEventListener("change", renderArtists);
    }

    const releaseSearch = $("release-search");

    if (releaseSearch) {
        releaseSearch.addEventListener("input", renderReleases);
    }

    setupNavigation();
    initialize();
});
