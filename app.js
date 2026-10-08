"use strict";


/* =========================================================
   SOURCES
   ========================================================= */

const RELEASES_URL =
    "https://pierre-011.github.io/spotify-artists/data/sorties.json";

const ARTISTS_URL =
    "./data/artistes.json";


let releases = [];
let artists = [];


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


function getToday() {

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


    const values = {};

    parts.forEach(part => {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    });


    return `${values.year}-${values.month}-${values.day}`;
}


function normalizeDate(value) {

    if (!value) {
        return "";
    }


    const valueString =
        String(value).trim();


    const iso =
        valueString.match(
            /^(\d{4}-\d{2}-\d{2})/
        );


    if (iso) {
        return iso[1];
    }


    const french =
        valueString.match(
            /^(\d{2})\/(\d{2})\/(\d{4})/
        );


    if (french) {

        return `${french[3]}-${french[2]}-${french[1]}`;

    }


    return "";
}


function formatDate(value) {

    const date =
        normalizeDate(value);


    if (!date) {
        return "--";
    }


    const [
        year,
        month,
        day
    ] = date.split("-");


    return `${day}/${month}/${year}`;
}


/* =========================================================
   EXTRACTION DES INFORMATIONS
   ========================================================= */

function releaseTitle(item) {

    return (
        item.name ||
        item.title ||
        item.track_name ||
        item.trackName ||
        item.album_name ||
        item.albumName ||
        "Titre inconnu"
    );
}


function releaseArtist(item) {

    if (item.artist_name) {
        return item.artist_name;
    }

    if (item.artistName) {
        return item.artistName;
    }

    if (typeof item.artist === "string") {
        return item.artist;
    }

    if (
        Array.isArray(item.artists) &&
        item.artists.length
    ) {
        return (
            item.artists[0].name ||
            item.artists[0]
        );
    }

    return "Artiste inconnu";
}


function releaseDate(item) {

    return normalizeDate(
        item.release_date ||
        item.releaseDate ||
        item.date ||
        ""
    );
}


function releaseImage(item) {

    if (item.album_image) {
        return item.album_image;
    }

    if (item.albumImage) {
        return item.albumImage;
    }

    if (item.image) {
        return item.image;
    }

    if (
        Array.isArray(item.images) &&
        item.images.length
    ) {
        return item.images[0].url || item.images[0];
    }

    if (
        item.album &&
        Array.isArray(item.album.images) &&
        item.album.images.length
    ) {
        return item.album.images[0].url;
    }

    return "";
}


function releaseURL(item) {

    return (
        item.spotify_url ||
        item.spotifyUrl ||
        item.url ||
        item.external_url ||
        item.external_urls?.spotify ||
        ""
    );
}


function releaseType(item) {

    return (
        item.release_type ||
        item.releaseType ||
        item.album_type ||
        item.type ||
        "release"
    );
}


/* =========================================================
   CHARGEMENT JSON
   ========================================================= */

async function loadJSON(url) {

    const response =
        await fetch(
            `${url}?t=${Date.now()}`,
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            `Impossible de charger ${url}`
        );

    }


    return response.json();
}


function extractReleases(data) {

    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data.tracks)) {
        return data.tracks;
    }

    if (Array.isArray(data.releases)) {
        return data.releases;
    }

    if (Array.isArray(data.albums)) {
        return data.albums;
    }

    return [];
}


function extractArtists(data) {

    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data.artists)) {
        return data.artists;
    }

    if (Array.isArray(data.followed_artists)) {
        return data.followed_artists;
    }

    return [];
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function setupTabs() {

    document
        .querySelectorAll(".tab")
        .forEach(tab => {

            tab.addEventListener(
                "click",
                () => {

                    const page =
                        tab.dataset.page;


                    document
                        .querySelectorAll(".tab")
                        .forEach(item => {
                            item.classList.remove(
                                "active"
                            );
                        });


                    document
                        .querySelectorAll(".page")
                        .forEach(item => {
                            item.classList.remove(
                                "active"
                            );
                        });


                    tab.classList.add(
                        "active"
                    );


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
   CARTE DE SORTIE
   ========================================================= */

function createReleaseCard(
    release,
    originalIndex
) {

    const title =
        releaseTitle(release);

    const artist =
        releaseArtist(release);

    const date =
        releaseDate(release);

    const image =
        releaseImage(release);

    const type =
        releaseType(release);


    return `

        <article
            class="release-card"
            data-index="${originalIndex}"
            tabindex="0"
        >

            ${
                image

                    ? `

                        <img
                            src="${escapeHTML(image)}"
                            alt="${escapeHTML(title)}"
                            class="release-image"
                            loading="lazy"
                        >

                      `

                    : `

                        <div class="release-image no-image">
                            ♪
                        </div>

                      `
            }


            <div class="release-content">

                <span class="release-type">
                    ${escapeHTML(type)}
                </span>

                <h3>
                    ${escapeHTML(title)}
                </h3>

                <p>
                    ${escapeHTML(artist)}
                </p>

                <time>
                    ${formatDate(date)}
                </time>

            </div>

        </article>
    `;
}


/* =========================================================
   RENDU SORTIES DU JOUR
   ========================================================= */

function renderToday() {

    const container =
        $("today-releases");


    const today =
        getToday();


    const data =
        releases
            .map(
                (release, index) => ({
                    release,
                    index
                })
            )
            .filter(
                item =>
                    releaseDate(
                        item.release
                    ) === today
            );


    $("today-count").textContent =
        data.length;


    if (!data.length) {

        container.innerHTML = `

            <div class="empty">

                <strong>
                    Aucune sortie aujourd'hui
                </strong>

                <p>
                    Aucune sortie n'a été trouvée pour
                    ${formatDate(today)}.
                </p>

            </div>
        `;

        return;
    }


    container.innerHTML =
        data
            .map(
                item =>
                    createReleaseCard(
                        item.release,
                        item.index
                    )
            )
            .join("");


    setupReleaseCards(container);

}


/* =========================================================
   TOUTES LES SORTIES
   ========================================================= */

function renderAllReleases() {

    const container =
        $("all-releases");


    const search =
        $("release-search")
            .value
            .toLowerCase()
            .trim();


    let data =
        releases
            .map(
                (release, index) => ({
                    release,
                    index
                })
            );


    if (search) {

        data =
            data.filter(
                item => {

                    const text =
                        `${releaseTitle(item.release)}
                         ${releaseArtist(item.release)}`
                            .toLowerCase();


                    return text.includes(search);

                }
            );

    }


    data.sort(
        (a, b) =>
            releaseDate(b.release)
                .localeCompare(
                    releaseDate(a.release)
                )
    );


    $("all-count").textContent =
        data.length;


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
                item =>
                    createReleaseCard(
                        item.release,
                        item.index
                    )
            )
            .join("");


    setupReleaseCards(container);

}


/* =========================================================
   POPUP
   ========================================================= */

function openReleaseModal(release) {

    const modal =
        $("release-modal");


    const title =
        releaseTitle(release);

    const artist =
        releaseArtist(release);

    const image =
        releaseImage(release);

    const url =
        releaseURL(release);

    const type =
        releaseType(release);

    const date =
        releaseDate(release);


    $("modal-title").textContent =
        title;


    $("modal-artist").textContent =
        artist;


    $("modal-type").textContent =
        String(type).toUpperCase();


    $("modal-date").textContent =
        `Date de sortie : ${formatDate(date)}`;


    const cover =
        $("modal-cover");


    if (image) {

        cover.src =
            image;

        cover.alt =
            title;

        cover.style.display =
            "block";

    } else {

        cover.removeAttribute(
            "src"
        );

        cover.style.display =
            "none";

    }


    const spotify =
        $("modal-spotify");


    if (url) {

        spotify.href =
            url;

        spotify.style.display =
            "inline-flex";

    } else {

        spotify.style.display =
            "none";

    }


    modal.classList.add("show");

    modal.setAttribute(
        "aria-hidden",
        "false"
    );


    document.body.classList.add(
        "modal-open"
    );

}


function closeReleaseModal() {

    const modal =
        $("release-modal");


    modal.classList.remove(
        "show"
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
   CLIC SUR UNE SORTIE
   ========================================================= */

function setupReleaseCards(container) {

    container
        .querySelectorAll(".release-card")
        .forEach(card => {

            const index =
                Number(
                    card.dataset.index
                );


            card.addEventListener(
                "click",
                () => {

                    openReleaseModal(
                        releases[index]
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

                        openReleaseModal(
                            releases[index]
                        );

                    }

                }
            );

        });

}


/* =========================================================
   ARTISTES
   ========================================================= */

function artistName(artist) {

    if (typeof artist === "string") {
        return artist;
    }


    return (
        artist.name ||
        artist.artist_name ||
        artist.artistName ||
        "Artiste"
    );
}


function artistImage(artist) {

    return (
        artist.image ||
        artist.image_url ||
        artist.imageUrl ||
        artist.images?.[0]?.url ||
        ""
    );
}


function renderArtists() {

    const container =
        $("artists-list");


    let data =
        artists;


    /*
     * Si artistes.json n'existe pas ou est vide,
     * on récupère automatiquement les artistes
     * présents dans sorties.json.
     */

    if (!data.length) {

        const map =
            new Map();


        releases.forEach(
            release => {

                const name =
                    releaseArtist(
                        release
                    );


                if (!map.has(name)) {

                    map.set(
                        name,
                        {
                            name
                        }
                    );

                }

            }
        );


        data =
            Array.from(
                map.values()
            );

    }


    const search =
        $("artist-search")
            .value
            .toLowerCase()
            .trim();


    if (search) {

        data =
            data.filter(
                artist =>
                    artistName(artist)
                        .toLowerCase()
                        .includes(search)
            );

    }


    $("artists-count").textContent =
        data.length;


    if (!data.length) {

        container.innerHTML = `
            <div class="empty">
                Aucun artiste trouvé.
            </div>
        `;

        return;
    }


    container.innerHTML =
        data
            .map(
                artist => {

                    const name =
                        artistName(
                            artist
                        );

                    const image =
                        artistImage(
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

                                        <div class="artist-image no-image">
                                            ♪
                                        </div>

                                      `
                            }

                            <strong>
                                ${escapeHTML(name)}
                            </strong>

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
        getToday();


    const todayCount =
        releases.filter(
            release =>
                releaseDate(release) === today
        ).length;


    const artistsSet =
        new Set(
            releases.map(
                release =>
                    releaseArtist(release)
            )
        );


    let albums = 0;
    let singles = 0;
    let eps = 0;


    releases.forEach(
        release => {

            const type =
                String(
                    releaseType(release)
                ).toLowerCase();


            if (type === "album") {
                albums++;
            }

            else if (type === "single") {
                singles++;
            }

            else if (type === "ep") {
                eps++;
            }

        }
    );


    $("stat-releases").textContent =
        releases.length;


    $("stat-today").textContent =
        todayCount;


    $("stat-artists").textContent =
        artistsSet.size;


    $("stat-albums").textContent =
        albums;


    $("stat-singles").textContent =
        singles;


    $("stat-eps").textContent =
        eps;


    renderArtistStats();

}


function renderArtistStats() {

    const container =
        $("artist-stats");


    const counts = {};


    releases.forEach(
        release => {

            const artist =
                releaseArtist(
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
            );


    container.innerHTML =
        sorted
            .slice(0, 20)
            .map(
                ([artist, count]) => `

                    <div class="artist-stat">

                        <span>
                            ${escapeHTML(artist)}
                        </span>

                        <strong>
                            ${count}
                        </strong>

                    </div>

                `
            )
            .join("");

}


/* =========================================================
   INITIALISATION
   ========================================================= */

async function init() {

    const today =
        getToday();


    $("current-date").textContent =
        formatDate(today);


    $("today-description").textContent =
        `Sorties du ${formatDate(today)}`;


    try {

        const releasesData =
            await loadJSON(
                RELEASES_URL
            );


        releases =
            extractReleases(
                releasesData
            );


    } catch (error) {

        console.error(
            "Erreur sorties :",
            error
        );


        $("today-releases").innerHTML = `
            <div class="empty">
                Impossible de charger sorties.json.
            </div>
        `;

    }


    try {

        const artistsData =
            await loadJSON(
                ARTISTS_URL
            );


        artists =
            extractArtists(
                artistsData
            );


    } catch (error) {

        console.warn(
            "artistes.json indisponible.",
            error
        );

        artists = [];

    }


    renderToday();

    renderAllReleases();

    renderArtists();

    renderStats();

}


/* =========================================================
   ÉVÉNEMENTS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        setupTabs();


        $("release-search")
            .addEventListener(
                "input",
                renderAllReleases
            );


        $("artist-search")
            .addEventListener(
                "input",
                renderArtists
            );


        $("modal-close")
            .addEventListener(
                "click",
                closeReleaseModal
            );


        $("modal-background")
            .addEventListener(
                "click",
                closeReleaseModal
            );


        document.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Escape"
                ) {

                    closeReleaseModal();

                }

            }
        );


        init();

    }
);
