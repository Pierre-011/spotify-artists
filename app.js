"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];
let statisticsCache = null;

let allReleasesRendered = false;
let statisticsRendered = false;

/* =========================================================
UTILITAIRES
========================================================= */

function $(id) {
return document.getElementById(id);
}

function escapeHTML(value) {
return String(value ?? "")
.replaceAll("&", "&")
.replaceAll("<", "<")
.replaceAll(">", ">")
.replaceAll('"', """)
.replaceAll("'", "'");
}

function formatNumber(value) {
if (value === null || value === undefined || value === "") {
return "—";
}

```
const number = Number(value);

if (Number.isNaN(number)) {
    return escapeHTML(value);
}

return new Intl.NumberFormat("fr-FR").format(number);
```

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

```
const result = {};

for (const part of parts) {
    if (part.type !== "literal") {
        result[part.type] = part.value;
    }
}

return `${result.year}-${result.month}-${result.day}`;
```

}

function normalizeDate(value) {
if (!value) return "";

```
const string = String(value).trim();

const iso = string.match(/^(\d{4}-\d{2}-\d{2})/);

if (iso) {
    return iso[1];
}

const french = string.match(
    /^(\d{2})\/(\d{2})\/(\d{4})/
);

if (french) {
    return `${french[3]}-${french[2]}-${french[1]}`;
}

return "";
```

}

function parseLocalDate(value) {
const normalized = normalizeDate(value);

```
if (!normalized) return null;

const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})$/
);

if (!match) return null;

const year = Number(match[1]);
const month = Number(match[2]);
const day = Number(match[3]);

const date = new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
);

if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
) {
    return null;
}

return date;
```

}

function formatDate(value) {
const normalized = normalizeDate(value);

```
if (!normalized) return "—";

const [year, month, day] = normalized.split("-");

return `${day}/${month}/${year}`;
```

}

function formatReadableDate(value) {
const date = parseLocalDate(value);

```
if (!date) {
    return "Date inconnue";
}

return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
});
```

}

/* =========================================================
CHARGEMENT DES JSON
========================================================= */

async function loadJSON(filePath) {
const response = await fetch(filePath, {
method: "GET",
cache: "default"
});

```
if (!response.ok) {
    throw new Error(
        `Erreur HTTP ${response.status} : ${filePath}`
    );
}

const text = await response.text();

if (!text.trim()) {
    throw new Error(`${filePath} est vide.`);
}

try {
    return JSON.parse(text);
} catch {
    throw new Error(
        `${filePath} contient un JSON invalide.`
    );
}
```

}

/* =========================================================
PARSING DES ARTISTES
========================================================= */

function parseArtists(data) {
if (!data) return [];

```
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
        .filter(Boolean);
}

if (
    data.id ||
    data.name ||
    data.artist_name
) {
    return [data];
}

return Object.values(data)
    .filter(
        value =>
            value &&
            typeof value === "object"
    );
```

}

/* =========================================================
PARSING DES SORTIES
========================================================= */

function parseReleases(data) {
if (!data) return [];

```
/*
 * Ton sorties.json utilise :
 *
 * {
 *   "tracks": [...]
 * }
 */

if (Array.isArray(data.tracks)) {
    return data.tracks.filter(Boolean);
}

if (Array.isArray(data.releases)) {
    return data.releases.filter(Boolean);
}

if (Array.isArray(data.albums)) {
    return data.albums.filter(Boolean);
}

if (Array.isArray(data)) {
    return data.filter(Boolean);
}

if (
    data.id ||
    data.name ||
    data.release_date
) {
    return [data];
}

return [];
```

}

/* =========================================================
INFORMATIONS SORTIE
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
"Artiste inconnu"
);
}

function getReleaseImage(release) {
return (
release?.album_image ||
release?.albumImage ||
release?.image ||
""
);
}

function getReleaseURL(release) {
return (
release?.url ||
release?.external_url ||
release?.external_urls?.spotify ||
""
);
}

function getReleaseType(release) {
return String(
release?.release_type ||
release?.releaseType ||
""
)
.trim()
.toLowerCase();
}

/* =========================================================
DATE DU JOUR
========================================================= */

function displayCurrentDate() {
const today = getTodayParis();

```
const currentDate = $("current-date");

if (currentDate) {
    currentDate.textContent = formatDate(today);
}

const title = $("release-title");

if (title) {
    title.textContent =
        `Nouvelles sorties — ${formatDate(today)}`;
}

const description = $("release-description");

if (description) {
    description.textContent =
        `Sorties prévues le ${formatReadableDate(today)}`;
}
```

}

/* =========================================================
SORTIES DU JOUR
========================================================= */

function renderReleases() {
const container = $("release-list");

```
if (!container) return;

const searchInput = $("release-search");
const countElement = $("release-count");

const search = searchInput
    ? searchInput.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";

const today = getTodayParis();

let todayReleases = releases.filter(
    release =>
        getReleaseDate(release) === today
);

if (search) {
    todayReleases = todayReleases.filter(
        release => {
            const text = [
                getReleaseTitle(release),
                getReleaseArtist(release),
                release.album_name
            ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase("fr-FR");

            return text.includes(search);
        }
    );
}

todayReleases.sort((a, b) =>
    getReleaseTitle(a).localeCompare(
        getReleaseTitle(b),
        "fr-FR"
    )
);

if (countElement) {
    countElement.textContent =
        formatNumber(todayReleases.length);
}

if (!todayReleases.length) {
    container.innerHTML = `
        <div class="empty">
            Aucune sortie trouvée pour le
            ${escapeHTML(formatDate(today))}.
        </div>
    `;

    return;
}

container.innerHTML = todayReleases
    .map(release => {
        const title = getReleaseTitle(release);
        const artist = getReleaseArtist(release);
        const image = getReleaseImage(release);
        const url = getReleaseURL(release);

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
                        ${escapeHTML(formatDate(today))}
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
```

}

/* =========================================================
TOUTES LES SORTIES
========================================================= */

/*

* Important :
* Cette fonction n'est appelée que lorsque l'utilisateur
* ouvre l'onglet "Toutes les sorties".
*
* Cela évite de construire plusieurs centaines/milliers
* d'éléments HTML au chargement initial.
  */

function renderAllReleases() {
const container = $("all-release-list");

```
if (!container) return;

const searchInput = $("all-release-search");
const sortSelect = $("all-release-sort");
const countElement = $("all-release-count");

const search = searchInput
    ? searchInput.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";

const sort = sortSelect
    ? sortSelect.value
    : "newest";

let filtered = [...releases];

if (search) {
    filtered = filtered.filter(release => {
        const text = [
            getReleaseTitle(release),
            getReleaseArtist(release),
            release.album_name
        ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("fr-FR");

        return text.includes(search);
    });
}

filtered.sort((a, b) => {
    const dateA = getReleaseDate(a);
    const dateB = getReleaseDate(b);

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;

    return sort === "oldest"
        ? dateA.localeCompare(dateB)
        : dateB.localeCompare(dateA);
});

if (countElement) {
    countElement.textContent =
        formatNumber(filtered.length);
}

if (!filtered.length) {
    container.innerHTML = `
        <div class="empty all-release-empty">
            <div class="empty-icon">🎵</div>
            <strong>Aucune sortie trouvée</strong>
            <p>Essayez une autre recherche.</p>
        </div>
    `;

    return;
}

/*
 * Groupement par date
 */

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

for (const [date, dateReleases] of groups) {
    const readableDate =
        date === "unknown"
            ? "Date inconnue"
            : formatReadableDate(date);

    html.push(`
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
                        ${escapeHTML(readableDate)}
                    </h3>

                </div>

                <span class="release-day-count">
                    ${formatNumber(dateReleases.length)}
                    ${
                        dateReleases.length > 1
                            ? "sorties"
                            : "sortie"
                    }
                </span>

            </div>

            <div class="release-day-grid">

                ${dateReleases
                    .map(release => {
                        const title =
                            getReleaseTitle(release);

                        const artist =
                            getReleaseArtist(release);

                        const image =
                            getReleaseImage(release);

                        const url =
                            getReleaseURL(release);

                        const type =
                            getReleaseType(release) ||
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
                    })
                    .join("")}

            </div>

        </section>
    `);
}

container.innerHTML = html.join("");

allReleasesRendered = true;
```

}

/* =========================================================
ARTISTES
========================================================= */

function renderArtists() {
const container = $("artist-table");

```
if (!container) return;

const searchInput = $("artist-search");
const sortSelect = $("artist-sort");
const countElement = $("artist-count");

const search = searchInput
    ? searchInput.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";

const sort = sortSelect
    ? sortSelect.value
    : "name";

let filtered = artists.filter(artist => {
    const name =
        artist.name ||
        artist.artist_name ||
        "";

    return name
        .toLocaleLowerCase("fr-FR")
        .includes(search);
});

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
    filtered.sort((a, b) => {
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
    });
}

if (countElement) {
    countElement.textContent =
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
            artist.name ||
            artist.artist_name ||
            "Artiste inconnu";

        const followers =
            artist.followers;

        const monthlyListeners =
            artist.monthly_listeners ??
            artist.monthlyListeners;

        const popularity =
            artist.popularity;

        const genres =
            Array.isArray(artist.genres)
                ? artist.genres.join(", ")
                : "";

        const spotifyURL =
            artist.url ||
            artist.external_urls?.spotify ||
            "";

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
                    ${formatNumber(followers)}
                </td>

                <td>
                    ${formatNumber(monthlyListeners)}
                </td>

                <td>
                    ${
                        popularity !== undefined &&
                        popularity !== null
                            ? escapeHTML(popularity)
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
```

}

/* =========================================================
STATISTIQUES
========================================================= */

function calculateStatistics() {
if (statisticsCache) {
return statisticsCache;
}

```
const artistMap = new Map();
const monthMap = new Map();
const datedReleases = [];

let singles = 0;
let albums = 0;
let eps = 0;
let other = 0;

for (const release of releases) {

    /* Artiste */

    const artistId =
        release.artist_id ||
        release.artistId ||
        getReleaseArtist(release)
            .toLocaleLowerCase("fr-FR");

    if (!artistMap.has(artistId)) {
        artistMap.set(
            artistId,
            {
                name: getReleaseArtist(release),
                count: 0
            }
        );
    }

    artistMap.get(artistId).count++;

    /* Type réel de sortie */

    const type = getReleaseType(release);

    if (
        type === "single" ||
        type === "singles"
    ) {
        singles++;
    } else if (
        type === "album" ||
        type === "albums"
    ) {
        albums++;
    } else if (
        type === "ep" ||
        type === "eps"
    ) {
        eps++;
    } else {
        other++;
    }

    /* Date */

    const date =
        parseLocalDate(
            getReleaseDate(release)
        );

    if (date) {
        datedReleases.push(date);

        const key =
            `${date.getFullYear()}-${String(
                date.getMonth() + 1
            ).padStart(2, "0")}`;

        monthMap.set(
            key,
            (monthMap.get(key) || 0) + 1
        );
    }
}

const today =
    parseLocalDate(getTodayParis());

function countLastDays(days) {
    if (!today) return 0;

    const start = new Date(today);

    start.setDate(
        start.getDate() - days + 1
    );

    return datedReleases.filter(
        date =>
            date >= start &&
            date <= today
    ).length;
}

const topArtists =
    [...artistMap.values()]
        .sort(
            (a, b) =>
                b.count - a.count ||
                a.name.localeCompare(
                    b.name,
                    "fr-FR"
                )
        )
        .slice(0, 10);

const months =
    [...monthMap.entries()]
        .sort((a, b) =>
            a[0].localeCompare(b[0])
        );

let oldestDate = null;
let newestDate = null;

for (const date of datedReleases) {
    if (!oldestDate || date < oldestDate) {
        oldestDate = date;
    }

    if (!newestDate || date > newestDate) {
        newestDate = date;
    }
}

let busiestMonth = null;

for (const [key, count] of monthMap) {
    if (
        !busiestMonth ||
        count > busiestMonth.count
    ) {
        busiestMonth = {
            key,
            count
        };
    }
}

let duration = 0;

if (oldestDate && newestDate) {
    duration = Math.round(
        (
            newestDate.getTime() -
            oldestDate.getTime()
        ) /
        (1000 * 60 * 60 * 24)
    );
}

statisticsCache = {
    total: releases.length,
    last7Days: countLastDays(7),
    last30Days: countLastDays(30),
    last365Days: countLastDays(365),
    activeArtists: artistMap.size,

    singles,
    albums,
    eps,
    other,

    topArtists,
    months,

    oldestDate,
    newestDate,
    duration,
    busiestMonth
};

return statisticsCache;
```

}

function renderStatistics() {
if (statisticsRendered) {
return;
}

```
statisticsRendered = true;

const stats = calculateStatistics();

/* Cartes */

$("stats-total").textContent =
    formatNumber(stats.total);

$("stats-7-days").textContent =
    formatNumber(stats.last7Days);

$("stats-30-days").textContent =
    formatNumber(stats.last30Days);

$("stats-365-days").textContent =
    formatNumber(stats.last365Days);

$("stats-artists-count").textContent =
    formatNumber(stats.activeArtists);

/* Types */

$("stats-singles").textContent =
    formatNumber(stats.singles);

$("stats-albums").textContent =
    formatNumber(stats.albums);

$("stats-eps").textContent =
    formatNumber(stats.eps);

$("stats-other").textContent =
    formatNumber(stats.other);

/* Top artistes */

const artistsContainer =
    $("stats-artists");

if (!stats.topArtists.length) {
    artistsContainer.innerHTML = `
        <div class="empty">
            Aucune donnée disponible.
        </div>
    `;
} else {
    artistsContainer.innerHTML =
        stats.topArtists
            .map(
                (artist, index) => `
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
                `
            )
            .join("");
}

/* Évolution mensuelle */

const monthsContainer =
    $("stats-months");

if (!stats.months.length) {
    monthsContainer.innerHTML = `
        <div class="empty">
            Aucune date disponible.
        </div>
    `;
} else {
    const max =
        Math.max(
            ...stats.months.map(
                item => item[1]
            )
        );

    monthsContainer.innerHTML =
        stats.months
            .map(([key, count]) => {
                const [year, month] =
                    key.split("-");

                const date =
                    new Date(
                        Number(year),
                        Number(month) - 1,
                        1
                    );

                const label =
                    date.toLocaleDateString(
                        "fr-FR",
                        {
                            month: "long",
                            year: "numeric"
                        }
                    );

                const percentage =
                    max > 0
                        ? (count / max) * 100
                        : 0;

                return `
                    <div class="monthly-stat-row">

                        <div class="monthly-stat-header">

                            <span>
                                ${escapeHTML(
                                    label
                                )}
                            </span>

                            <strong>
                                ${formatNumber(count)}
                            </strong>

                        </div>

                        <div class="monthly-bar">

                            <div
                                class="monthly-bar-fill"
                                style="width:${percentage}%"
                            ></div>

                        </div>

                    </div>
                `;
            })
            .join("");
}

/* Résumé */

const summary =
    $("stats-summary");

if (!stats.total) {
    summary.innerHTML = `
        <p>
            Aucune sortie disponible.
        </p>
    `;

    return;
}

if (!stats.oldestDate) {
    summary.innerHTML = `
        <p>
            Le catalogue contient
            <strong>${formatNumber(
                stats.total
            )}</strong>
            sortie(s), mais aucune date
            exploitable n'a été trouvée.
        </p>
    `;

    return;
}

const oldest =
    `${stats.oldestDate.getFullYear()}-${String(
        stats.oldestDate.getMonth() + 1
    ).padStart(2, "0")}-${String(
        stats.oldestDate.getDate()
    ).padStart(2, "0")}`;

const newest =
    `${stats.newestDate.getFullYear()}-${String(
        stats.newestDate.getMonth() + 1
    ).padStart(2, "0")}-${String(
        stats.newestDate.getDate()
    ).padStart(2, "0")}`;

let html = `
    <p>
        Le catalogue contient
        <strong>${formatNumber(
            stats.total
        )}</strong>
        sortie(s).
    </p>

    <p>
        Les sorties couvrent la période du
        <strong>${escapeHTML(
            formatDate(oldest)
        )}</strong>
        au
        <strong>${escapeHTML(
            formatDate(newest)
        )}</strong>,
        soit
        <strong>${formatNumber(
            stats.duration
        )}</strong>
        jour(s).
    </p>
`;

if (stats.topArtists[0]) {
    html += `
        <p>
            L'artiste avec le plus de sorties est
            <strong>${escapeHTML(
                stats.topArtists[0].name
            )}</strong>
            avec
            <strong>${formatNumber(
                stats.topArtists[0].count
            )}</strong>
            sortie(s).
        </p>
    `;
}

if (stats.busiestMonth) {
    const [year, month] =
        stats.busiestMonth.key.split("-");

    const date =
        new Date(
            Number(year),
            Number(month) - 1,
            1
        );

    const label =
        date.toLocaleDateString(
            "fr-FR",
            {
                month: "long",
                year: "numeric"
            }
        );

    html += `
        <p>
            Le mois avec le plus de sorties est
            <strong>${escapeHTML(
                label
            )}</strong>
            avec
            <strong>${formatNumber(
                stats.busiestMonth.count
            )}</strong>
            sortie(s).
        </p>
    `;
}

summary.innerHTML = html;
```

}

/* =========================================================
NAVIGATION
========================================================= */

function setupNavigation() {
const buttons =
document.querySelectorAll(
".nav-button"
);

```
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

            button.classList.add("active");

            const page =
                $(`page-${target}`);

            if (page) {
                page.classList.add("active");
            }

            /*
             * On ne rend que la page demandée.
             */

            if (target === "releases") {
                renderReleases();
            }

            if (target === "artists") {
                renderArtists();
            }

            if (target === "all-releases") {
                renderAllReleases();
            }

            if (target === "stats") {
                renderStatistics();
            }
        }
    );
});
```

}

/* =========================================================
INITIALISATION
========================================================= */

async function initialize() {
displayCurrentDate();

```
/*
 * Les deux fichiers sont demandés en parallèle.
 */

const releasesPromise =
    loadJSON(RELEASES_FILE);

const artistsPromise =
    loadJSON(ARTISTS_FILE);

/* -----------------------------------------------------
   SORTIES
   ----------------------------------------------------- */

try {
    const data =
        await releasesPromise;

    releases =
        parseReleases(data);

    /*
     * On affiche uniquement les sorties du jour.
     *
     * On NE construit PAS toutes les sorties ici.
     * Cela accélère fortement le chargement initial.
     */

    renderReleases();

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
                ${escapeHTML(error.message)}
            </p>
        </div>
    `;

    const releaseList =
        $("release-list");

    const allReleaseList =
        $("all-release-list");

    if (releaseList) {
        releaseList.innerHTML = message;
    }

    if (allReleaseList) {
        allReleaseList.innerHTML = message;
    }
}

/* -----------------------------------------------------
   ARTISTES
   ----------------------------------------------------- */

try {
    const data =
        await artistsPromise;

    artists =
        parseArtists(data);

    renderArtists();

} catch (error) {
    console.error(
        "Erreur artistes.json :",
        error
    );

    const table =
        $("artist-table");

    if (table) {
        table.innerHTML = `
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
```

}

/* =========================================================
ÉVÉNEMENTS
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {
const releaseSearch =
$("release-search");

```
    if (releaseSearch) {
        releaseSearch.addEventListener(
            "input",
            renderReleases
        );
    }

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
```

);

```

Cette version est volontairement calée sur **les IDs et classes exacts de ton HTML**. Surtout, elle corrige le problème de performance : au démarrage, elle ne construit plus tout le contenu de **« Toutes les sorties »** ni les statistiques. Ces deux blocs sont générés uniquement quand tu les ouvres.

Tu peux donc **remplacer uniquement `app.js`**. Ton HTML et ton CSS restent inchangés.
```
