"use strict";


/* =========================================================
   CONFIGURATION
   ========================================================= */

const RELEASES_FILE =
    "https://pierre-011.github.io/spotify-artists/data/sorties.json";


let releases = [];


/* =========================================================
   UTILITAIRES
   ========================================================= */

const $ = id => document.getElementById(id);


function escapeHTML(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}


function normalizeText(value) {

    return String(value ?? "")
        .toLocaleLowerCase("fr-FR")
        .trim();
}


function formatNumber(value) {

    return new Intl.NumberFormat("fr-FR")
        .format(Number(value) || 0);
}


/* =========================================================
   DATES
   ========================================================= */

/*
 * Date actuelle dans le fuseau Europe/Paris.
 *
 * Retour :
 * YYYY-MM-DD
 */

function getTodayParis() {

    const parts =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: "Europe/Paris",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).formatToParts(new Date());


    const result = {};

    for (const part of parts) {

        if (part.type !== "literal") {
            result[part.type] = part.value;
        }

    }


    return `${result.year}-${result.month}-${result.day}`;
}


/*
 * Transforme différentes formes de dates
 * en YYYY-MM-DD.
 */

function normalizeDate(value) {

    if (!value) {
        return "";
    }


    const string =
        String(value).trim();


    /*
     * 2026-10-08
     * 2026-10-08T00:00:00Z
     */

    const iso =
        string.match(
            /^(\d{4}-\d{2}-\d{2})/
        );


    if (iso) {
        return iso[1];
    }


    /*
     * 08/10/2026
     */

    const french =
        string.match(
            /^(\d{2})\/(\d{2})\/(\d{4})/
        );


    if (french) {

        return `${french[3]}-${french[2]}-${french[1]}`;

    }


    return "";
}


/*
 * YYYY-MM-DD
 * devient
 * DD/MM/YYYY
 */

function formatDate(value) {

    const normalized =
        normalizeDate(value);


    if (!normalized) {
        return "—";
    }


    const [
        year,
        month,
        day
    ] = normalized.split("-");


    return `${day}/${month}/${year}`;
}


/*
 * Date lisible en français.
 */

function formatReadableDate(value) {

    const normalized =
        normalizeDate(value);


    if (!normalized) {
        return "Date inconnue";
    }


    const [
        year,
        month,
        day
    ] = normalized.split("-");


    const date =
        new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            12
        );


    return date.toLocaleDateString(
        "fr-FR",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );
}


/* =========================================================
   CHARGEMENT DU JSON
   ========================================================= */

async function loadReleases() {

    const response =
        await fetch(
            `${RELEASES_FILE}?t=${Date.now()}`,
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            `Erreur HTTP ${response.status}`
        );

    }


    const data =
        await response.json();


    /*
     * Supporte plusieurs formats possibles.
     *
     * Format actuel :
     *
     * {
     *   "tracks": [...]
     * }
     */

    if (Array.isArray(data)) {

        return data.filter(Boolean);

    }


    if (Array.isArray(data.tracks)) {

        return data.tracks.filter(Boolean);

    }


    if (Array.isArray(data.releases)) {

        return data.releases.filter(Boolean);

    }


    if (Array.isArray(data.albums)) {

        return data.albums.filter(Boolean);

    }


    return [];
}


/* =========================================================
   INFORMATIONS D'UNE SORTIE
   ========================================================= */

function getReleaseDate(release) {

    return normalizeDate(
        release?.release_date ??
        release?.releaseDate ??
        release?.date ??
        ""
    );
}


function getReleaseTitle(release) {

    return (
        release?.name ||
        release?.track_name ||
        release?.trackName ||
        release?.album_name ||
        release?.albumName ||
        release?.title ||
        "Titre inconnu"
    );
}


function getReleaseArtist(release) {

    return (
        release?.artist_name ||
        release?.artistName ||
        release?.artist ||
        release?.artists?.[0]?.name ||
        "Artiste inconnu"
    );
}


function getReleaseImage(release) {

    return (
        release?.album_image ||
        release?.albumImage ||
        release?.image ||
        release?.images?.[0]?.url ||
        release?.album?.images?.[0]?.url ||
        ""
    );
}


function getReleaseURL(release) {

    return (
        release?.url ||
        release?.external_url ||
        release?.external_urls?.spotify ||
        release?.spotify_url ||
        release?.spotifyUrl ||
        ""
    );
}


function getReleaseType(release) {

    return String(
        release?.release_type ||
        release?.releaseType ||
        release?.album_type ||
        ""
    )
        .trim()
        .toLowerCase();
}


/* =========================================================
   RECHERCHE
   ========================================================= */

function matchesSearch(
    release,
    search
) {

    if (!search) {
        return true;
    }


    const text = [

        getReleaseTitle(release),

        getReleaseArtist(release),

        release?.album_name,

        release?.albumName

    ]
        .filter(Boolean)
        .join(" ");


    return normalizeText(text)
        .includes(search);
}


/* =========================================================
   DATE DANS L'INTERFACE
   ========================================================= */

function displayCurrentDate() {

    const today =
        getTodayParis();


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


/* =========================================================
   AFFICHAGE DES SORTIES DU JOUR
   ========================================================= */

function renderReleases() {

    const container =
        $("release-list");


    if (!container) {
        return;
    }


    const search =
        normalizeText(
            $("release-search")
                ?.value
                ?.trim() || ""
        );


    const today =
        getTodayParis();


    /*
     * IMPORTANT :
     *
     * Seules les sorties dont
     * release_date = aujourd'hui
     * sont conservées.
     */

    const todayReleases =
        releases

            .filter(
                release =>
                    getReleaseDate(release) === today
            )

            .filter(
                release =>
                    matchesSearch(
                        release,
                        search
                    )
            )

            .sort(
                (a, b) =>
                    getReleaseTitle(a)
                        .localeCompare(
                            getReleaseTitle(b),
                            "fr-FR",
                            {
                                sensitivity: "base"
                            }
                        )
            );


    /*
     * Compteur
     */

    if ($("release-count")) {

        $("release-count").textContent =
            formatNumber(
                todayReleases.length
            );

    }


    /*
     * Aucune sortie
     */

    if (!todayReleases.length) {

        container.innerHTML = `

            <div class="empty">

                <div class="empty-icon">
                    ♪
                </div>

                <strong>
                    Aucune sortie aujourd'hui
                </strong>

                <p>
                    Aucune sortie Spotify n'est prévue
                    pour le ${escapeHTML(formatDate(today))}.
                </p>

            </div>

        `;

        return;
    }


    /*
     * Cartes
     */

    container.innerHTML =
        todayReleases
            .map(
                release => {

                    const title =
                        getReleaseTitle(release);

                    const artist =
                        getReleaseArtist(release);

                    const image =
                        getReleaseImage(release);

                    const url =
                        getReleaseURL(release);

                    const type =
                        getReleaseType(release);


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

                                        <div class="release-cover release-cover-empty">
                                            ♪
                                        </div>

                                      `
                            }


                            <div class="release-information">

                                <div class="release-type">

                                    ${
                                        escapeHTML(
                                            type
                                                ? type.toUpperCase()
                                                : "SORTIE DU JOUR"
                                        )
                                    }

                                </div>


                                <div class="release-name">

                                    ${escapeHTML(title)}

                                </div>


                                <div class="release-artist">

                                    ${escapeHTML(artist)}

                                </div>


                                <div class="release-album">

                                    ${escapeHTML(
                                        formatDate(
                                            getReleaseDate(release)
                                        )
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
                }
            )
            .join("");
}


/* =========================================================
   CHARGEMENT
   ========================================================= */

function showLoading() {

    const container =
        $("release-list");


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="loading">

            Chargement des sorties...

        </div>

    `;
}


function showError(message) {

    const container =
        $("release-list");


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div class="empty">

            <div class="empty-icon">
                ⚠
            </div>

            <strong>
                Impossible de charger les sorties
            </strong>

            <p>
                ${escapeHTML(message)}
            </p>

        </div>

    `;


    if ($("release-count")) {

        $("release-count").textContent =
            "0";

    }
}


/* =========================================================
   ACTUALISATION
   ========================================================= */

async function refreshReleases() {

    const button =
        $("refresh-button");


    try {

        if (button) {

            button.disabled = true;

            button.classList.add(
                "is-loading"
            );

            button.textContent =
                "↻ Chargement...";

        }


        showLoading();


        releases =
            await loadReleases();


        displayCurrentDate();

        renderReleases();


    } catch (error) {

        console.error(
            "Erreur lors du chargement :",
            error
        );


        showError(
            error.message
        );


    } finally {

        if (button) {

            button.disabled = false;

            button.classList.remove(
                "is-loading"
            );

            button.textContent =
                "↻ Actualiser";

        }

    }
}


/* =========================================================
   INITIALISATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        displayCurrentDate();


        const searchInput =
            $("release-search");


        if (searchInput) {

            searchInput.addEventListener(
                "input",
                renderReleases
            );

        }


        const refreshButton =
            $("refresh-button");


        if (refreshButton) {

            refreshButton.addEventListener(
                "click",
                refreshReleases
            );

        }


        refreshReleases();

    }
);
