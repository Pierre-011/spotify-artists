"use strict";


/* =========================================================
   CONFIGURATION
   ========================================================= */

const RELEASES_FILE =
    "https://pierre-011.github.io/spotify-artists/data/sorties.json";

const ARTISTS_FILE =
    "./data/artistes.json";


let releases = [];
let artists = [];


/* =========================================================
   UTILITAIRES
   ========================================================= */

const $ = id =>
    document.getElementById(id);


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


function normalizeDate(value) {

    if (!value) {
        return "";
    }


    const string =
        String(value).trim();


    const iso =
        string.match(
            /^(\d{4}-\d{2}-\d{2})/
        );


    if (iso) {
        return iso[1];
    }


    const french =
        string.match(
            /^(\d{2})\/(\d{2})\/(\d{4})/
        );


    if (french) {

        return `${french[3]}-${french[2]}-${french[1]}`;

    }


    return "";
}


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
   CHARGEMENT DES SORTIES
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
   CHARGEMENT DES ARTISTES
   ========================================================= */

async function loadArtists() {

    try {

        const response =
            await fetch(
                ARTISTS_FILE,
                {
                    cache: "no-store"
                }
            );


        if (!response.ok) {
            return [];
        }


        const data =
            await response.json();


        if (Array.isArray(data)) {
            return data.filter(Boolean);
        }


        if (Array.isArray(data.artists)) {
            return data.artists.filter(Boolean);
        }


        return [];

    } catch (error) {

        console.warn(
            "artistes.json indisponible :",
            error
        );

        return [];

    }
}


/* =========================================================
   INFORMATIONS SORTIES
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
   NAVIGATION
   ========================================================= */

function setupNavigation() {

    document
        .querySelectorAll(".nav-tab")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const page =
                        button.dataset.page;


                    document
                        .querySelectorAll(".nav-tab")
                        .forEach(tab => {

                            tab.classList.remove(
                                "active"
                            );

                        });


                    button.classList.add(
                        "active"
                    );


                    document
                        .querySelectorAll(".page")
                        .forEach(section => {

                            section.classList.remove(
                                "active"
                            );

                        });


                    const target =
                        $(`page-${page}`);


                    if (target) {

                        target.classList.add(
                            "active"
                        );

                    }


                    if (page === "stats") {
                        renderStats();
                    }

                }
            );

        });

}


/* =========================================================
   POPUP
   ========================================================= */

function openModal(release) {

    const modal =
        $("release-modal");


    if (!modal || !release) {
        return;
    }


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

    const date =
        getReleaseDate(release);


    const modalImage =
        $("modal-image");


    if (modalImage) {

        if (image) {

            modalImage.src =
                image;

            modalImage.alt =
                `${title} — ${artist}`;

            modalImage.style.display =
                "block";

        } else {

            modalImage.removeAttribute(
                "src"
            );

            modalImage.style.display =
                "none";

        }

    }


    $("modal-type").textContent =
        type
            ? type.toUpperCase()
            : "SORTIE";


    $("modal-title").textContent =
        title;


    $("modal-artist").textContent =
        artist;


    $("modal-date").textContent =
        `Sortie le ${formatReadableDate(date)}`;


    const spotify =
        $("modal-spotify");


    if (spotify) {

        if (url) {

            spotify.href =
                url;

            spotify.style.display =
                "inline-flex";

        } else {

            spotify.style.display =
                "none";

        }

    }


    modal.classList.add(
        "open"
    );


    modal.setAttribute(
        "aria-hidden",
        "false"
    );


    document.body.classList.add(
        "modal-open"
    );


    $("modal-close")?.focus();

}


function closeModal() {

    const modal =
        $("release-modal");


    if (!modal) {
        return;
    }


    modal.classList.remove(
        "open"
    );


    modal.setAttribute(
        "aria-hidden",
        "true"
    );


    document.body.classList.remove(
        "modal-open"
    );

}


/* =========================================================
   CARTE DE SORTIE
   ========================================================= */

function createReleaseCard(
    release,
    index
) {

    const title =
        getReleaseTitle(release);

    const artist =
        getReleaseArtist(release);

    const image =
        getReleaseImage(release);

    const type =
        getReleaseType(release);


    return `

        <article
            class="release-card"
            data-release-index="${index}"
            tabindex="0"
            role="button"
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
                                : "SORTIE"
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

            </div>

        </article>

    `;
}


/* =========================================================
   CONNEXION DES CARTES AU POPUP
   ========================================================= */

function attachReleaseCardEvents(
    container,
    data
) {

    container
        .querySelectorAll(".release-card")
        .forEach(card => {

            const index =
                Number(
                    card.dataset.releaseIndex
                );


            card.addEventListener(
                "click",
                () => {

                    openModal(
                        data[index]
                    );

                }
            );


            card.addEventListener(
                "keydown",
                event => {

                    if (
                        event.key === "Enter" ||
                        event.key === " "
                    ) {

                        event.preventDefault();

                        openModal(
                            data[index]
                        );

                    }

                }
            );

        });

}


/* =========================================================
   SORTIES DU JOUR
   ========================================================= */

function renderTodayReleases() {

    const container =
        $("release-list");


    if (!container) {
        return;
    }


    const search =
        normalizeText(
            $("release-search")
                ?.value || ""
        );


    const today =
        getTodayParis();


    const data =
        releases

            .filter(
                release =>
                    getReleaseDate(release) === today
            )

            .filter(
                release => {

                    if (!search) {
                        return true;
                    }


                    return normalizeText(
                        `${getReleaseTitle(release)}
                         ${getReleaseArtist(release)}`
                    ).includes(search);

                }
            );


    $("release-count").textContent =
        formatNumber(data.length);


    if (!data.length) {

        container.innerHTML = `

            <div class="empty">

                <div class="empty-icon">
                    ♪
                </div>

                <strong>
                    Aucune sortie aujourd'hui
                </strong>

                <p>
                    Aucune sortie prévue le
                    ${escapeHTML(formatDate(today))}.
                </p>

            </div>

        `;

        return;
    }


    container.innerHTML =
        data
            .map(
                (release, index) =>
                    createReleaseCard(
                        release,
                        index
                    )
            )
            .join("");


    attachReleaseCardEvents(
        container,
        data
    );

}


/* =========================================================
   TOUTES LES SORTIES
   ========================================================= */

function renderAllReleases() {

    const container =
        $("all-release-list");


    if (!container) {
        return;
    }


    const search =
        normalizeText(
            $("all-release-search")
                ?.value || ""
        );


    const data =
        releases

            .filter(
                release => {

                    if (!search) {
                        return true;
                    }


                    return normalizeText(
                        `${getReleaseTitle(release)}
                         ${getReleaseArtist(release)}`
                    ).includes(search);

                }
            )

            .sort(
                (a, b) => {

                    const dateA =
                        getReleaseDate(a);

                    const dateB =
                        getReleaseDate(b);


                    return dateB.localeCompare(
                        dateA
                    );

                }
            );


    $("all-release-count").textContent =
        formatNumber(data.length);


    if (!data.length) {

        container.innerHTML = `

            <div class="empty">

                Aucune sortie trouvée.

            </div>

        `;

        return;
    }


    container.innerHTML =
        data
            .map(
                (release, index) =>
                    createReleaseCard(
                        release,
                        index
                    )
            )
            .join("");


    attachReleaseCardEvents(
        container,
        data
    );

}


/* =========================================================
   ARTISTES
   ========================================================= */

function getArtistName(artist) {

    if (typeof artist === "string") {
        return artist;
    }


    return (
        artist?.name ||
        artist?.artist_name ||
        artist?.artistName ||
        "Artiste inconnu"
    );
}


function getArtistImage(artist) {

    return (
        artist?.image ||
        artist?.image_url ||
        artist?.imageUrl ||
        artist?.images?.[0]?.url ||
        ""
    );
}


function renderArtists() {

    const container =
        $("artist-list");


    if (!container) {
        return;
    }


    /*
     * Si artistes.json existe,
     * on l'utilise.
     *
     * Sinon on reconstruit la liste
     * depuis sorties.json.
     */

    let artistData =
        artists.length
            ? artists
            : Array.from(
                new Map(
                    releases.map(
                        release => {

                            const name =
                                getReleaseArtist(
                                    release
                                );

                            return [
                                name,
                                {
                                    name
                                }
                            ];

                        }
                    )
                ).values()
            );


    const search =
        normalizeText(
            $("artist-search")
                ?.value || ""
        );


    artistData =
        artistData.filter(
            artist =>
                normalizeText(
                    getArtistName(artist)
                ).includes(search)
        );


    $("artist-count").textContent =
        formatNumber(
            artistData.length
        );


    if (!artistData.length) {

        container.innerHTML = `

            <div class="empty">

                Aucun artiste trouvé.

            </div>

        `;

        return;
    }


    container.innerHTML =
        artistData
            .map(
                artist => {

                    const name =
                        getArtistName(
                            artist
                        );

                    const image =
                        getArtistImage(
                            artist
                        );


                    return `

                        <div class="artist-card">

                            ${
                                image

                                    ? `

                                        <img
                                            src="${escapeHTML(image)}"
                                            alt="${escapeHTML(name)}"
                                            class="artist-image"
                                            loading="lazy"
                                        >

                                      `

                                    : `

                                        <div class="artist-image artist-image-empty">
                                            ♪
                                        </div>

                                      `
                            }


                            <div class="artist-name">

                                ${escapeHTML(name)}

                            </div>

                        </div>

                    `;

                }
            )
            .join("");

}


/* =========================================================
   STATISTIQUES
   ========================================================= */

function renderStats() {

    const today =
        getTodayParis();


    const todayReleases =
        releases.filter(
            release =>
                getReleaseDate(release) === today
        );


    const artistNames =
        new Set(
            releases.map(
                release =>
                    getReleaseArtist(
                        release
                    )
            )
        );


    const albums =
        releases.filter(
            release =>
                getReleaseType(release) === "album"
        );


    const singles =
        releases.filter(
            release =>
                getReleaseType(release) === "single"
        );


    const eps =
        releases.filter(
            release =>
                getReleaseType(release) === "ep"
        );


    $("stat-total").textContent =
        formatNumber(
            releases.length
        );


    $("stat-today").textContent =
        formatNumber(
            todayReleases.length
        );


    $("stat-artists").textContent =
        formatNumber(
            artistNames.size
        );


    $("stat-albums").textContent =
        formatNumber(
            albums.length
        );


    $("stat-singles").textContent =
        formatNumber(
            singles.length
        );


    $("stat-eps").textContent =
        formatNumber(
            eps.length
        );


    renderArtistStats();

}


function renderArtistStats() {

    const container =
        $("artist-stats");


    if (!container) {
        return;
    }


    const counts = {};


    releases.forEach(
        release => {

            const artist =
                getReleaseArtist(
                    release
                );


            counts[artist] =
                (counts[artist] || 0) + 1;

        }
    );


    const sorted =
        Object.entries(counts)
            .sort(
                (a, b) =>
                    b[1] - a[1]
            )
            .slice(0, 15);


    container.innerHTML =
        sorted
            .map(
                ([artist, count]) => `

                    <div class="artist-stat-row">

                        <span>
                            ${escapeHTML(artist)}
                        </span>

                        <strong>
                            ${formatNumber(count)}
                        </strong>

                    </div>

                `
            )
            .join("");

}


/* =========================================================
   DATE HEADER
   ========================================================= */

function displayCurrentDate() {

    const today =
        getTodayParis();


    $("current-date").textContent =
        formatDate(today);


    $("release-title").textContent =
        `Nouvelles sorties — ${formatDate(today)}`;


    $("release-description").textContent =
        `Sorties prévues le ${formatReadableDate(today)}`;

}


/* =========================================================
   CHARGEMENT
   ========================================================= */

async function initialize() {

    displayCurrentDate();


    try {

        const [
            loadedReleases,
            loadedArtists
        ] =
            await Promise.all([
                loadReleases(),
                loadArtists()
            ]);


        releases =
            loadedReleases;


        artists =
            loadedArtists;


        console.log(
            `${releases.length} sorties chargées`
        );


        renderTodayReleases();

        renderAllReleases();

        renderArtists();

        renderStats();


    } catch (error) {

        console.error(
            "Erreur de chargement :",
            error
        );


        $("release-list").innerHTML = `

            <div class="empty">

                <strong>
                    Impossible de charger les données
                </strong>

                <p>
                    ${escapeHTML(error.message)}
                </p>

            </div>

        `;

    }

}


/* =========================================================
   ÉVÉNEMENTS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        setupNavigation();


        /*
         * Recherche sorties du jour
         */

        $("release-search")
            ?.addEventListener(
                "input",
                renderTodayReleases
            );


        /*
         * Recherche toutes les sorties
         */

        $("all-release-search")
            ?.addEventListener(
                "input",
                renderAllReleases
            );


        /*
         * Recherche artistes
         */

        $("artist-search")
            ?.addEventListener(
                "input",
                renderArtists
            );


        /*
         * Fermeture popup
         */

        $("modal-close")
            ?.addEventListener(
                "click",
                closeModal
            );


        $("modal-overlay")
            ?.addEventListener(
                "click",
                closeModal
            );


        /*
         * Échap
         */

        document.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Escape"
                ) {

                    closeModal();

                }

            }
        );


        initialize();

    }
);
