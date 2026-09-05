/* ======================================================
   CONFIGURATION
====================================================== */

const ARTISTS_FILE = "data/artistes.json";
const RELEASES_FILE = "data/sorties.json";


/* ======================================================
   VARIABLES
====================================================== */

let artists = [];
let releases = [];


/* ======================================================
   OUTIL DOM
====================================================== */

function $(id) {
    return document.getElementById(id);
}


/* ======================================================
   DATE EUROPE / PARIS
====================================================== */

function getTodayParis() {

    const parts = new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: "Europe/Paris",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(new Date());


    function getPart(type) {

        const part = parts.find(
            item => item.type === type
        );

        return part ? part.value : "";
    }


    return (
        getPart("year") +
        "-" +
        getPart("month") +
        "-" +
        getPart("day")
    );
}


/* ======================================================
   FORMAT DATE
====================================================== */

function formatDate(date) {

    if (!date) {
        return "";
    }


    const value = String(date);

    const parts =
        value.substring(0, 10).split("-");


    if (parts.length !== 3) {
        return value;
    }


    return (
        parts[2] +
        "/" +
        parts[1] +
        "/" +
        parts[0]
    );
}


/* ======================================================
   FORMAT DATE LISIBLE
====================================================== */

function formatReadableDate(date) {

    if (!date) {
        return "";
    }


    const parsed =
        new Date(date + "T12:00:00");


    if (Number.isNaN(parsed.getTime())) {
        return date;
    }


    return parsed.toLocaleDateString(
        "fr-FR",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );
}


/* ======================================================
   NOMBRE
====================================================== */

function formatNumber(number) {

    if (
        number === null ||
        number === undefined ||
        number === ""
    ) {

        return "—";
    }


    if (
        typeof number !== "number" &&
        isNaN(Number(number))
    ) {

        return String(number);
    }


    return new Intl.NumberFormat(
        "fr-FR"
    ).format(Number(number));
}


/* ======================================================
   PROTECTION HTML
====================================================== */

function escapeHTML(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }


    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ======================================================
   CHARGEMENT JSON
====================================================== */

async function loadJSON(file) {

    const url =
        file +
        (
            file.includes("?")
                ? "&"
                : "?"
        ) +
        "cache=" +
        Date.now();


    console.log(
        "Chargement :",
        url
    );


    const response =
        await fetch(url);


    if (!response.ok) {

        throw new Error(
            "Impossible de charger " +
            file +
            " (" +
            response.status +
            ")"
        );
    }


    return await response.json();
}


/* ======================================================
   NORMALISATION ARTISTES
====================================================== */

function parseArtists(data) {

    if (!data) {

        console.warn(
            "Aucune donnée artiste."
        );

        return [];
    }


    /*
    ======================================================
    TON FORMAT

    {
        "artists": {
            "ID": {
                "id": "...",
                "name": "...",
                ...
            }
        }
    }
    ======================================================
    */

    if (
        data.artists &&
        typeof data.artists === "object" &&
        !Array.isArray(data.artists)
    ) {

        const result =
            Object.values(data.artists)
                .filter(
                    artist =>
                        artist &&
                        typeof artist === "object"
                );


        console.log(
            "Artistes détectés :",
            result.length
        );


        return result;
    }


    /*
    ======================================================
    FORMAT :

    {
        "artists": [...]
    }
    ======================================================
    */

    if (
        Array.isArray(data.artists)
    ) {

        console.log(
            "Artistes détectés :",
            data.artists.length
        );


        return data.artists;
    }


    /*
    ======================================================
    FORMAT :

    [...]
    ======================================================
    */

    if (Array.isArray(data)) {

        console.log(
            "Artistes détectés :",
            data.length
        );


        return data;
    }


    console.warn(
        "Format artistes.json non reconnu."
    );


    return [];
}


/* ======================================================
   NORMALISATION SORTIES
====================================================== */

function parseReleases(data) {

    if (!data) {
        return [];
    }


    /*
    ======================================================
    FORMAT :

    {
        "tracks": [...]
    }
    ======================================================
    */

    if (
        Array.isArray(data.tracks)
    ) {

        return data.tracks;
    }


    /*
    ======================================================
    FORMAT :

    {
        "releases": {
            "2026-08-19": [...],
            "2026-08-20": [...]
        }
    }
    ======================================================
    */

    if (
        data.releases &&
        typeof data.releases === "object" &&
        !Array.isArray(data.releases)
    ) {

        return Object.values(
            data.releases
        ).flat();
    }


    /*
    ======================================================
    FORMAT :

    {
        "releases": [...]
    }
    ======================================================
    */

    if (
        Array.isArray(data.releases)
    ) {

        return data.releases;
    }


    /*
    ======================================================
    FORMAT :

    [...]
    ======================================================
    */

    if (Array.isArray(data)) {

        return data;
    }


    return [];
}


/* ======================================================
   AFFICHAGE DATE ACTUELLE
====================================================== */

function displayCurrentDate() {

    const element =
        $("current-date");


    if (!element) {
        return;
    }


    const today =
        getTodayParis();


    element.textContent =
        formatDate(today);
}


/* ======================================================
   AFFICHAGE SORTIES
====================================================== */

function renderReleases() {

    const container =
        $("release-list");


    if (!container) {
        return;
    }


    const today =
        getTodayParis();


    const searchElement =
        $("release-search");


    const search =
        searchElement
            ? searchElement.value
                .trim()
                .toLocaleLowerCase("fr")
            : "";


    /*
    ======================================================
    SORTIES DU JOUR UNIQUEMENT
    ======================================================
    */

    let todayReleases =
        releases.filter(
            release => {

                if (
                    !release ||
                    !release.release_date
                ) {

                    return false;
                }


                return (
                    String(
                        release.release_date
                    ).substring(0, 10)
                    ===
                    today
                );
            }
        );


    /*
    ======================================================
    RECHERCHE
    ======================================================
    */

    if (search) {

        todayReleases =
            todayReleases.filter(
                release => {

                    const text = (

                        (release.name || "") +
                        " " +
                        (release.artist_name || "") +
                        " " +
                        (release.album_name || "")

                    ).toLocaleLowerCase("fr");


                    return text.includes(
                        search
                    );
                }
            );
    }


    /*
    ======================================================
    COMPTEUR
    ======================================================
    */

    const totalToday =
        releases.filter(
            release => {

                if (
                    !release ||
                    !release.release_date
                ) {

                    return false;
                }


                return (
                    String(
                        release.release_date
                    ).substring(0, 10)
                    ===
                    today
                );
            }
        ).length;


    const releaseCount =
        $("release-count");


    if (releaseCount) {

        releaseCount.textContent =
            formatNumber(totalToday);
    }


    const releaseTitle =
        $("release-title");


    if (releaseTitle) {

        releaseTitle.textContent =
            "Nouvelles sorties — " +
            formatDate(today);
    }


    const releaseDescription =
        $("release-description");


    if (releaseDescription) {

        releaseDescription.textContent =
            formatReadableDate(today);
    }


    /*
    ======================================================
    AUCUNE SORTIE
    ======================================================
    */

    if (
        todayReleases.length === 0
    ) {

        container.innerHTML = `

            <div class="empty">

                <div>
                    🎵
                </div>

                <br>

                Aucune nouvelle musique
                trouvée aujourd'hui.

            </div>

        `;

        return;
    }


    /*
    ======================================================
    AFFICHAGE
    ======================================================
    */

    container.innerHTML =
        todayReleases.map(
            release => {

                const image =
                    release.album_image ||
                    (
                        Array.isArray(
                            release.images
                        )
                            ? release.images[0]
                            : ""
                    ) ||
                    "";


                const title =
                    release.name ||
                    "Titre inconnu";


                const artist =
                    release.artist_name ||
                    "Artiste inconnu";


                const album =
                    release.album_name ||
                    "";


                const releaseType =
                    (
                        release.release_type ||
                        "SORTIE"
                    ).toUpperCase();


                const spotifyURL =
                    release.url ||
                    release.external_urls?.spotify ||
                    "";


                return `

                    <article
                        class="release-card"
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

                                    <div
                                        class="release-cover"
                                    ></div>

                                  `
                        }


                        <div
                            class="release-information"
                        >

                            <div
                                class="release-type"
                            >

                                ${escapeHTML(
                                    releaseType
                                )}

                            </div>


                            <div
                                class="release-name"
                            >

                                ${escapeHTML(
                                    title
                                )}

                            </div>


                            <div
                                class="release-artist"
                            >

                                ${escapeHTML(
                                    artist
                                )}

                            </div>


                            <div
                                class="release-album"
                            >

                                ${
                                    album
                                        ? escapeHTML(album)
                                        : ""
                                }

                                ${
                                    release.release_date
                                        ? " · " +
                                          formatDate(
                                              release.release_date
                                          )
                                        : ""
                                }

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
            }
        ).join("");
}


/* ======================================================
   AFFICHAGE ARTISTES
====================================================== */

function renderArtists() {

    const container =
        $("artist-table");


    if (!container) {

        console.error(
            "L'élément #artist-table est introuvable."
        );

        return;
    }


    const searchElement =
        $("artist-search");


    const search =
        searchElement
            ? searchElement.value
                .trim()
                .toLocaleLowerCase("fr")
            : "";


    const sortElement =
        $("artist-sort");


    const sort =
        sortElement
            ? sortElement.value
            : "name";


    /*
    ======================================================
    RECHERCHE
    ======================================================
    */

    let list =
        artists.filter(
            artist => {

                const name =
                    artist.name || "";


                return name
                    .toLocaleLowerCase("fr")
                    .includes(search);
            }
        );


    /*
    ======================================================
    TRI
    ======================================================
    */

    if (
        sort === "followers"
    ) {

        list.sort(
            (a, b) =>
                (Number(b.followers) || 0) -
                (Number(a.followers) || 0)
        );

    }

    else if (
        sort === "monthly_listeners"
    ) {

        list.sort(
            (a, b) =>
                (Number(b.monthly_listeners) || 0) -
                (Number(a.monthly_listeners) || 0)
        );

    }

    else if (
        sort === "popularity"
    ) {

        list.sort(
            (a, b) =>
                (Number(b.popularity) || 0) -
                (Number(a.popularity) || 0)
        );

    }

    else {

        list.sort(
            (a, b) =>
                (
                    a.name || ""
                ).localeCompare(
                    b.name || "",
                    "fr",
                    {
                        sensitivity: "base"
                    }
                )
        );
    }


    /*
    ======================================================
    COMPTEUR
    ======================================================
    */

    const artistCount =
        $("artist-count");


    if (artistCount) {

        artistCount.textContent =
            formatNumber(
                artists.length
            );
    }


    /*
    ======================================================
    AUCUN ARTISTE
    ======================================================
    */

    if (
        list.length === 0
    ) {

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


    /*
    ======================================================
    TABLEAU
    ======================================================
    */

    container.innerHTML =
        list.map(
            artist => {

                const genres =
                    Array.isArray(
                        artist.genres
                    )

                        ? artist.genres.join(", ")

                        : "";


                const spotifyURL =
                    artist.url ||
                    artist.external_urls?.spotify ||
                    "";


                return `

                    <tr>

                        <td
                            class="artist-name"
                        >

                            ${
                                spotifyURL

                                    ? `

                                        <a
                                            class="artist-link"
                                            href="${escapeHTML(spotifyURL)}"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >

                                            ${escapeHTML(
                                                artist.name ||
                                                "Inconnu"
                                            )}

                                        </a>

                                      `

                                    : escapeHTML(
                                        artist.name ||
                                        "Inconnu"
                                    )
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

                            ${
                                artist.popularity !== null &&
                                artist.popularity !== undefined
                                    ? escapeHTML(
                                        artist.popularity
                                    )
                                    : "—"
                            }

                        </td>


                        <td
                            class="genres-cell"
                        >

                            ${
                                escapeHTML(
                                    genres || "—"
                                )
                            }

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
            }
        ).join("");
}


/* ======================================================
   AFFICHAGE GENRES
====================================================== */

function renderGenres() {

    const container =
        $("genre-list");


    if (!container) {
        return;
    }


    const genreCounts = {};


    for (
        const artist of artists
    ) {

        if (
            !artist ||
            !Array.isArray(
                artist.genres
            )
        ) {

            continue;
        }


        for (
            const genre of artist.genres
        ) {

            if (
                typeof genre !== "string"
            ) {

                continue;
            }


            const clean =
                genre.trim();


            if (!clean) {
                continue;
            }


            genreCounts[clean] =
                (
                    genreCounts[clean] || 0
                ) + 1;
        }
    }


    const genres =
        Object.entries(
            genreCounts
        ).sort(
            (a, b) =>
                b[1] - a[1]
        );


    if (
        genres.length === 0
    ) {

        container.innerHTML = `

            <div class="empty">

                Aucun genre disponible.

            </div>

        `;

        return;
    }


    container.innerHTML =
        genres.map(
            ([genre, count]) => `

                <div
                    class="genre-card"
                >

                    <div
                        class="genre-count"
                    >

                        ${formatNumber(
                            count
                        )}

                    </div>


                    <div
                        class="genre-name"
                    >

                        ${escapeHTML(
                            genre
                        )}

                    </div>

                </div>

            `
        ).join("");
}


/* ======================================================
   NAVIGATION ONGLET
====================================================== */

function setupNavigation() {

    const buttons =
        document.querySelectorAll(
            ".nav-button"
        );


    const pages =
        document.querySelectorAll(
            ".page"
        );


    if (
        buttons.length === 0
    ) {

        console.warn(
            "Aucun bouton .nav-button trouvé."
        );

        return;
    }


    buttons.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const target =
                        button.dataset.page;


                    if (!target) {
                        return;
                    }


                    /*
                    Retire active des boutons
                    */

                    buttons.forEach(
                        item =>
                            item.classList.remove(
                                "active"
                            )
                    );


                    /*
                    Cache toutes les pages
                    */

                    pages.forEach(
                        page =>
                            page.classList.remove(
                                "active"
                            )
                    );


                    /*
                    Active le bouton
                    */

                    button.classList.add(
                        "active"
                    );


                    /*
                    Active la page
                    */

                    const targetPage =
                        $("page-" + target);


                    if (targetPage) {

                        targetPage.classList.add(
                            "active"
                        );

                    }

                }
            );

        }
    );
}


/* ======================================================
   INITIALISATION
====================================================== */

async function initialize() {

    console.log(
        "Initialisation du site..."
    );


    displayCurrentDate();


    try {

        /*
        ==================================================
        CHARGEMENT DES DEUX JSON
        ==================================================
        */

        const [
            artistData,
            releaseData
        ] = await Promise.all([

            loadJSON(
                ARTISTS_FILE
            ),

            loadJSON(
                RELEASES_FILE
            )

        ]);


        /*
        ==================================================
        ARTISTES
        ==================================================
        */

        artists =
            parseArtists(
                artistData
            );


        /*
        ==================================================
        SORTIES
        ==================================================
        */

        releases =
            parseReleases(
                releaseData
            );


        console.log(
            "Nombre d'artistes :",
            artists.length
        );


        console.log(
            "Nombre de sorties :",
            releases.length
        );


        /*
        ==================================================
        AFFICHAGE
        ==================================================
        */

        renderArtists();

        renderReleases();

        renderGenres();

    }

    catch (error) {

        console.error(
            "Erreur pendant l'initialisation :",
            error
        );


        /*
        Affichage erreur sorties
        */

        const releaseList =
            $("release-list");


        if (releaseList) {

            releaseList.innerHTML = `

                <div class="empty">

                    ❌ Impossible de charger
                    les données.

                    <br><br>

                    <strong>
                        ${escapeHTML(
                            error.message
                        )}
                    </strong>

                    <br><br>

                    Vérifie que les fichiers
                    existent dans :

                    <br><br>

                    <strong>
                        data/artistes.json
                    </strong>

                    <br>

                    <strong>
                        data/sorties.json
                    </strong>

                </div>

            `;
        }


        /*
        Affichage erreur artistes
        */

        const artistTable =
            $("artist-table");


        if (artistTable) {

            artistTable.innerHTML = `

                <tr>

                    <td
                        colspan="6"
                        class="muted"
                    >

                        ❌ Impossible de charger
                        les artistes.

                    </td>

                </tr>

            `;
        }
    }
}


/* ======================================================
   DÉMARRAGE
====================================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        /*
        ==================================================
        RECHERCHE ARTISTES
        ==================================================
        */

        const artistSearch =
            $("artist-search");


        if (artistSearch) {

            artistSearch.addEventListener(
                "input",
                renderArtists
            );

        }


        /*
        ==================================================
        TRI ARTISTES
        ==================================================
        */

        const artistSort =
            $("artist-sort");


        if (artistSort) {

            artistSort.addEventListener(
                "change",
                renderArtists
            );

        }
	


        /*
        ==================================================
        RECHERCHE SORTIES
        ==================================================
        */

        const releaseSearch =
            $("release-search");


        if (releaseSearch) {

            releaseSearch.addEventListener(
                "input",
                renderReleases
            );

        }


        /*
        ==================================================
        NAVIGATION
        ==================================================
        */

        setupNavigation();


        /*
        ==================================================
        CHARGEMENT
        ==================================================
        */

        initialize();

    }
)
async function triggerWorkflow() {
    const button = $("run-workflow-btn");
    const status = $("workflow-status");

    if (!button) {
        return;
    }

    button.disabled = true;

    if (status) {
        status.textContent = "Lancement du workflow...";
    }

    try {
        const response = await fetch("/api/run-workflow", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error("Impossible de lancer le workflow.");
        }

        if (status) {
            status.textContent = "Workflow lancé avec succès.";
        }
    } catch (error) {
        console.error(error);

        if (status) {
            status.textContent = "Erreur lors du lancement.";
        }
    } finally {
        button.disabled = false;
    }
};
