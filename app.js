"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];


/* =========================================================
   UTILITAIRES
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
    if (!date) return "—";

    const cleanDate = String(date).trim().slice(0, 10);
    const parts = cleanDate.split("-");

    if (parts.length !== 3) {
        return cleanDate;
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


function formatReadableDate(date) {
    if (!date) return "Date inconnue";

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
}


/* =========================================================
   CHARGEMENT JSON
   ========================================================= */

async function loadJSON(filePath) {
    const url = new URL(
        filePath,
        window.location.href
    );

    url.searchParams.set(
        "t",
        Date.now()
    );

    const response = await fetch(
        url.href,
        {
            method: "GET",
            cache: "no-store"
        }
    );

    if (!response.ok) {
        throw new Error(
            `Erreur HTTP ${response.status} pour ${url.pathname}`
        );
    }

    const text = await response.text();

    if (!text.trim()) {
        throw new Error(
            `${url.pathname} est vide.`
        );
    }

    return JSON.parse(text);
}


/* =========================================================
   PARSING ARTISTES
   ========================================================= */

function parseArtists(data) {
    if (!data) return [];

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
        return Object.values(data.artists)
            .filter(
                artist =>
                    artist &&
                    typeof artist === "object"
            );
    }

    if (
        typeof data === "object" &&
        !data.id &&
        !data.name
    ) {
        return Object.values(data)
            .filter(
                artist =>
                    artist &&
                    typeof artist === "object"
            );
    }

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
   PARSING SORTIES
   ========================================================= */

function parseReleases(data) {
    if (!data) return [];

    if (Array.isArray(data)) {
        return data.filter(Boolean);
    }

    if (Array.isArray(data.releases)) {
        return data.releases.filter(Boolean);
    }

    if (Array.isArray(data.tracks)) {
        return data.tracks.filter(Boolean);
    }

    if (Array.isArray(data.albums)) {
        return data.albums.filter(Boolean);
    }

    if (
        data.releases &&
        typeof data.releases === "object"
    ) {
        return Object.values(data.releases)
            .flat()
            .filter(Boolean);
    }

    if (
        data.tracks &&
        typeof data.tracks === "object"
    ) {
        return Object.values(data.tracks)
            .filter(Boolean);
    }

    if (
        data.albums &&
        typeof data.albums === "object"
    ) {
        return Object.values(data.albums)
            .filter(Boolean);
    }

    if (
        typeof data === "object" &&
        !data.id &&
        !data.name &&
        !data.release_date
    ) {
        return Object.values(data)
            .filter(
                release =>
                    release &&
                    typeof release === "object"
            );
    }

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

    return element
        ? element.value
            .trim()
            .toLocaleLowerCase("fr-FR")
        : "";
}


/* =========================================================
   DATE D'UNE SORTIE
   ========================================================= */

function getReleaseDate(release) {
    if (!release) return "";

    const rawDate =
        release.release_date ??
        release.releaseDate ??
        release.date ??
        release.published_at ??
        release.publishedAt ??
        "";

    if (!rawDate) return "";

    const value = String(rawDate).trim();

    const isoMatch =
        value.match(/^(\d{4}-\d{2}-\d{2})/);

    if (isoMatch) {
        return isoMatch[1];
    }

    const frenchMatch =
        value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);

    if (frenchMatch) {
        const [
            ,
            day,
            month,
            year
        ] = frenchMatch;

        return `${year}-${month}-${day}`;
    }

    return "";
}


/* =========================================================
   SORTIES DU JOUR
   ========================================================= */

function renderReleases() {
    const container = $("release-list");
    const countElement = $("release-count");
    const searchElement = $("release-search");

    if (!container) return;

    const today = getTodayParis();

    const search = searchElement
        ? searchElement.value
            .trim()
            .toLocaleLowerCase("fr-FR")
        : "";

    const releasesToday =
        releases.filter(
            release =>
                getReleaseDate(release) === today
        );

    const filteredReleases =
        releasesToday.filter(release => {

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
                .toLocaleLowerCase("fr-FR");

            return text.includes(search);
        });

    if (countElement) {
        countElement.textContent =
            filteredReleases.length;
    }

    if (filteredReleases.length === 0) {

        container.innerHTML = `
            <div class="empty">
                Aucune sortie trouvée pour le
                ${formatDate(today)}.
            </div>
        `;

        return;
    }

    container.innerHTML =
        [...filteredReleases]
            .sort((a, b) =>
                String(
                    a.name ||
                    a.album_name ||
                    ""
                ).localeCompare(
                    String(
                        b.name ||
                        b.album_name ||
                        ""
                    ),
                    "fr"
                )
            )
            .map(release => {

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

                const url =
                    release.url ||
                    release.external_url ||
                    "#";

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
                                ${escapeHTML(artist)}
                            </div>

                            <div class="release-album">
                                ${formatDate(today)}
                            </div>

                            ${
                                url !== "#"
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
}


/* =========================================================
   TOUTES LES SORTIES
   REGROUPEMENT PAR DATE
   ========================================================= */

function renderAllReleases() {
    const container =
        $("all-release-list");

    const countElement =
        $("all-release-count");

    const searchElement =
        $("all-release-search");

    const sortElement =
        $("all-release-sort");

    if (!container) return;

    const search = searchElement
        ? searchElement.value
            .trim()
            .toLocaleLowerCase("fr-FR")
        : "";

    const sort = sortElement
        ? sortElement.value
        : "newest";


    /* -----------------------------------------
       Recherche
       ----------------------------------------- */

    let filteredReleases =
        releases.filter(release => {

            if (!search) {
                return true;
            }

            const text = [
                release.name,
                release.title,
                release.album_name,
                release.albumName,
                release.artist_name,
                release.artistName
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("fr-FR");

            return text.includes(search);
        });


    /* -----------------------------------------
       Tri
       ----------------------------------------- */

    filteredReleases =
        [...filteredReleases].sort(
            (a, b) => {

                const dateA =
                    getReleaseDate(a);

                const dateB =
                    getReleaseDate(b);

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
            }
        );


    /* -----------------------------------------
       Compteur
       ----------------------------------------- */

    if (countElement) {
        countElement.textContent =
            formatNumber(
                filteredReleases.length
            );
    }


    /* -----------------------------------------
       Aucun résultat
       ----------------------------------------- */

    if (filteredReleases.length === 0) {

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


    /* -----------------------------------------
       Regroupement par date
       ----------------------------------------- */

    const groups = {};

    for (const release of filteredReleases) {

        const date =
            getReleaseDate(release) ||
            "unknown";

        if (!groups[date]) {
            groups[date] = [];
        }

        groups[date].push(release);
    }


    /* -----------------------------------------
       Génération HTML
       ----------------------------------------- */

    container.innerHTML =
        Object.entries(groups)
            .map(
                ([date, dateReleases]) => {

                    const readableDate =
                        date === "unknown"
                            ? "Date inconnue"
                            : formatReadableDate(date);


                    return `
                        <section class="release-day">

                            <div class="release-day-header">

                                <div>

                                    <span class="release-day-label">
                                        ${
                                            date === "unknown"
                                                ? "DATE INCONNUE"
                                                : "SORTIES"
                                        }
                                    </span>

                                    <h3>
                                        ${escapeHTML(
                                            readableDate
                                        )}
                                    </h3>

                                </div>


                                <span class="release-day-count">

                                    ${formatNumber(
                                        dateReleases.length
                                    )}

                                    ${
                                        dateReleases.length > 1
                                            ? "sorties"
                                            : "sortie"
                                    }

                                </span>

                            </div>


                            <div class="release-day-grid">

                                ${
                                    dateReleases
                                        .map(
                                            release => {

                                                const title =
                                                    release.name ||
                                                    release.album_name ||
                                                    release.albumName ||
                                                    release.title ||
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

                                                const url =
                                                    release.url ||
                                                    release.external_url ||
                                                    release.external_urls?.spotify ||
                                                    "";

                                                const releaseType =
                                                    release.release_type ||
                                                    "release";


                                                return `
                                                    <article class="catalog-release-card">

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
                                                                    String(
                                                                        releaseType
                                                                    ).toUpperCase()
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
                                                                            : formatDate(date)
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
                                        )
                                        .join("")
                                }

                            </div>

                        </section>
                    `;
                }
            )
            .join("");
}


/* =========================================================
   ARTISTES
   ========================================================= */

function renderArtists() {

    const container =
        $("artist-table");

    if (!container) return;

    const search =
        getSearchValue("artist-search");

    const sortElement =
        $("artist-sort");

    const sort =
        sortElement
            ? sortElement.value
            : "name";


    let filteredArtists =
        artists.filter(artist => {

            const name =
                artist.name ||
                artist.artist_name ||
                "";

            return name
                .toLocaleLowerCase("fr-FR")
                .includes(search);
        });


    if (sort === "followers") {

        filteredArtists.sort(
            (a, b) =>
                Number(b.followers || 0) -
                Number(a.followers || 0)
        );

    } else if (sort === "popularity") {

        filteredArtists.sort(
            (a, b) =>
                Number(b.popularity || 0) -
                Number(a.popularity || 0)
        );

    } else {

        filteredArtists.sort(
            (a, b) => {

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
                    {
                        sensitivity: "base"
                    }
                );
            }
        );
    }


    const artistCount =
        $("artist-count");

    if (artistCount) {
        artistCount.textContent =
            formatNumber(
                artists.length
            );
    }


    if (filteredArtists.length === 0) {

        container.innerHTML = `
            <tr>

                <td
                    colspan="6"
                    class="muted"
                >
                    Aucun artiste trouvé.
                </td>

            </tr>
        `;

        return;
    }


    container.innerHTML =
        filteredArtists
            .map(artist => {

                const name =
                    artist.name ||
                    artist.artist_name ||
                    "Artiste inconnu";

                const spotifyURL =
                    artist.url ||
                    artist.external_urls?.spotify ||
                    "";

                const genres =
                    Array.isArray(artist.genres)
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
                            ${formatNumber(
                                artist.followers
                            )}
                        </td>


                        <td>
                            ${formatNumber(
                                artist.monthly_listeners
                            )}
                        </td>


                        <td>
                            ${artist.popularity ?? "—"}
                        </td>


                        <td class="genres-cell">
                            ${escapeHTML(
                                genres || "—"
                            )}
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
   NAVIGATION
   ========================================================= */

function setupNavigation() {

    const buttons =
        document.querySelectorAll(
            ".nav-button"
        );

    const pages =
        document.querySelectorAll(
            ".page"
        );


    buttons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                const target =
                    button.dataset.page;

                if (!target) return;


                buttons.forEach(item =>
                    item.classList.remove(
                        "active"
                    )
                );


                pages.forEach(page =>
                    page.classList.remove(
                        "active"
                    )
                );


                button.classList.add(
                    "active"
                );


                const targetPage =
                    $(`page-${target}`);


                if (targetPage) {
                    targetPage.classList.add(
                        "active"
                    );
                }


                if (
                    target ===
                    "all-releases"
                ) {
                    renderAllReleases();
                }


                if (
                    target ===
                    "releases"
                ) {
                    renderReleases();
                }


                if (
                    target ===
                    "artists"
                ) {
                    renderArtists();
                }

            }
        );
    });
}


/* =========================================================
   INITIALISATION
   ========================================================= */

async function initialize() {

    displayCurrentDate();


    /*
     * On charge les sorties indépendamment
     * des artistes.
     */

    try {

        const releasesData =
            await loadJSON(
                RELEASES_FILE
            );

        releases =
            parseReleases(
                releasesData
            );

        renderReleases();
        renderAllReleases();

    } catch (error) {

        console.error(
            "Erreur sorties.json :",
            error
        );


        const message = `
            <div class="empty">

                <strong>
                    Impossible de charger les sorties
                </strong>

                <p>
                    ${escapeHTML(
                        error.message
                    )}
                </p>

            </div>
        `;


        const releaseList =
            $("release-list");

        const allReleaseList =
            $("all-release-list");


        if (releaseList) {
            releaseList.innerHTML =
                message;
        }


        if (allReleaseList) {
            allReleaseList.innerHTML =
                message;
        }
    }


    /*
     * Les artistes sont chargés séparément.
     */

    try {

        const artistsData =
            await loadJSON(
                ARTISTS_FILE
            );

        artists =
            parseArtists(
                artistsData
            );

        renderArtists();

    } catch (error) {

        console.error(
            "Erreur artistes.json :",
            error
        );


        const artistTable =
            $("artist-table");


        if (artistTable) {

            artistTable.innerHTML = `
                <tr>

                    <td
                        colspan="6"
                        class="muted"
                    >
                        Impossible de charger les artistes.
                    </td>

                </tr>
            `;
        }
    }
}


/* =========================================================
   ÉVÉNEMENTS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const artistSearch =
            $("artist-search");

        if (artistSearch) {

            artistSearch.addEventListener(
                "input",
                renderArtists
            );
        }


        const artistSort =
            $("artist-sort");

        if (artistSort) {

            artistSort.addEventListener(
                "change",
                renderArtists
            );
        }


        const releaseSearch =
            $("release-search");

        if (releaseSearch) {

            releaseSearch.addEventListener(
                "input",
                renderReleases
            );
        }


        const allReleaseSearch =
            $("all-release-search");

        if (allReleaseSearch) {

            allReleaseSearch.addEventListener(
                "input",
                renderAllReleases
            );
        }


        const allReleaseSort =
            $("all-release-sort");

        if (allReleaseSort) {

            allReleaseSort.addEventListener(
                "change",
                renderAllReleases
            );
        }


        setupNavigation();

        initialize();
    }
);
