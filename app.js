"use strict";

const ARTISTS_FILE = "./data/artistes.json";
const RELEASES_FILE = "./data/sorties.json";

let artists = [];
let releases = [];

// Cache des données calculées pour éviter de refaire les mêmes calculs
let statisticsCache = null;

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
if (
value === null ||
value === undefined ||
value === ""
) {
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
const date = {};

for (const part of parts) {
    if (part.type !== "literal") {
        date[part.type] = part.value;
    }
}

return `${date.year}-${date.month}-${date.day}`;
```

}

function formatDate(date) {
if (!date) return "—";

```
const cleanDate = String(date)
    .trim()
    .slice(0, 10);

const parts = cleanDate.split("-");

if (parts.length !== 3) {
    return cleanDate;
}

return `${parts[2]}/${parts[1]}/${parts[0]}`;
```

}

function parseLocalDate(dateString) {
if (!dateString) return null;

```
const cleanDate = String(dateString)
    .trim()
    .slice(0, 10);

const match = cleanDate.match(
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

function formatReadableDate(date) {
if (!date) {
return "Date inconnue";
}

```
const parsedDate = parseLocalDate(date);

if (!parsedDate) {
    return String(date);
}

return parsedDate.toLocaleDateString(
    "fr-FR",
    {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }
);
```

}

function displayCurrentDate() {
const today = getTodayParis();

```
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
```

}

/* =========================================================
CHARGEMENT JSON
========================================================= */

async function loadJSON(filePath) {
const response = await fetch(filePath, {
method: "GET",
cache: "default"
});

```
if (!response.ok) {
    throw new Error(
        `Erreur HTTP ${response.status} pour ${filePath}`
    );
}

const text = await response.text();

if (!text.trim()) {
    throw new Error(
        `${filePath} est vide.`
    );
}

return JSON.parse(text);
```

}

/* =========================================================
PARSING ARTISTES
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
```

}

/* =========================================================
PARSING SORTIES
========================================================= */

function parseReleases(data) {
if (!data) return [];

```
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
```

}

/* =========================================================
RECHERCHE
========================================================= */

function getSearchValue(id) {
const element = $(id);

```
return element
    ? element.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";
```

}

/* =========================================================
DATE D'UNE SORTIE
========================================================= */

function getReleaseDate(release) {
if (!release) return "";

```
const rawDate =
    release.release_date ??
    release.releaseDate ??
    release.date ??
    release.published_at ??
    release.publishedAt ??
    "";

if (!rawDate) return "";

const value = String(rawDate).trim();

const isoMatch = value.match(
    /^(\d{4}-\d{2}-\d{2})/
);

if (isoMatch) {
    return isoMatch[1];
}

const frenchMatch = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})/
);

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
```

}

/* =========================================================
SORTIES DU JOUR
========================================================= */

function renderReleases() {
const container = $("release-list");
const countElement = $("release-count");
const searchElement = $("release-search");

```
if (!container) return;

const today = getTodayParis();

const search = searchElement
    ? searchElement.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";

const releasesToday = [];

for (const release of releases) {
    if (getReleaseDate(release) === today) {
        releasesToday.push(release);
    }
}

const filteredReleases = search
    ? releasesToday.filter(release => {
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
    })
    : releasesToday;

if (countElement) {
    countElement.textContent =
        filteredReleases.length;
}

if (!filteredReleases.length) {
    container.innerHTML = `
        <div class="empty">
            Aucune sortie trouvée pour le
            ${formatDate(today)}.
        </div>
    `;
    return;
}

const sorted = [...filteredReleases].sort(
    (a, b) =>
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
);

container.innerHTML = sorted
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
```

}

/* =========================================================
TOUTES LES SORTIES
========================================================= */

function renderAllReleases() {
const container = $("all-release-list");
const countElement = $("all-release-count");
const searchElement = $("all-release-search");
const sortElement = $("all-release-sort");

```
if (!container) return;

const search = searchElement
    ? searchElement.value
        .trim()
        .toLocaleLowerCase("fr-FR")
    : "";

const sort = sortElement
    ? sortElement.value
    : "newest";

let filteredReleases = search
    ? releases.filter(release => {
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
    })
    : [...releases];

filteredReleases.sort((a, b) => {
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
        formatNumber(filteredReleases.length);
}

if (!filteredReleases.length) {
    container.innerHTML = `
        <div class="empty all-release-empty">
            <div class="empty-icon">🎵</div>
            <strong>Aucune sortie trouvée</strong>
            <p>Essayez une autre recherche.</p>
        </div>
    `;
    return;
}

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

container.innerHTML = Object.entries(groups)
    .map(([date, dateReleases]) => {
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
                                                String(releaseType).toUpperCase()
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
                        })
                        .join("")}

                </div>

            </section>
        `;
    })
    .join("");
```

}

/* =========================================================
ARTISTES
========================================================= */

function renderArtists() {
const container = $("artist-table");

```
if (!container) return;

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
            {
                sensitivity: "base"
            }
        );
    });
}

const artistCount = $("artist-count");

if (artistCount) {
    artistCount.textContent =
        formatNumber(artists.length);
}

if (!filteredArtists.length) {
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
                    ${formatNumber(artist.followers)}
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

function getReleaseArtistName(release) {
return (
release.artist_name ||
release.artistName ||
release.artist ||
"Artiste inconnu"
);
}

function getReleaseArtistKey(release) {
return (
release.artist_id ||
release.artistId ||
getReleaseArtistName(release)
.toLocaleLowerCase("fr-FR")
);
}

function getReleaseType(release) {
return String(
release.release_type ||
release.releaseType ||
""
)
.trim()
.toLocaleLowerCase("fr-FR");
}

function getMonthKey(date) {
return `${date.getFullYear()}-${String(
        date.getMonth() + 1
    ).padStart(2, "0")}`;
}

function getMonthLabel(key) {
const [
year,
month
] = key.split("-");

```
const date = new Date(
    Number(year),
    Number(month) - 1,
    1,
    12,
    0,
    0
);

const label = date.toLocaleDateString(
    "fr-FR",
    {
        month: "long",
        year: "numeric"
    }
);

return label.charAt(0).toUpperCase() +
    label.slice(1);
```

}

/*

* Calcul des statistiques une seule fois.
* Les résultats sont ensuite réutilisés.
  */
  function calculateStatistics() {
  if (statisticsCache) {
  return statisticsCache;
  }

  const total = releases.length;

  const artistMap = new Map();
  const monthMap = new Map();

  const releasesWithDates = [];

  let singles = 0;
  let albums = 0;
  let eps = 0;
  let other = 0;

  for (const release of releases) {

  ```
   /* Artistes */

   const artistKey =
       getReleaseArtistKey(release);

   const artistName =
       getReleaseArtistName(release);

   if (!artistMap.has(artistKey)) {
       artistMap.set(
           artistKey,
           {
               name: artistName,
               count: 0
           }
       );
   }

   artistMap.get(artistKey).count++;

   /* Types */

   const type =
       getReleaseType(release);

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

   /* Dates */

   const date =
       parseLocalDate(
           getReleaseDate(release)
       );

   if (date) {
       releasesWithDates.push({
           release,
           date
       });

       const monthKey =
           getMonthKey(date);

       monthMap.set(
           monthKey,
           (monthMap.get(monthKey) || 0) + 1
       );
   }
  ```

  }

  const today =
  parseLocalDate(
  getTodayParis()
  );

  function countLastDays(numberOfDays) {
  if (!today) return 0;

  ```
   const start = new Date(today);

   start.setDate(
       start.getDate() -
       (numberOfDays - 1)
   );

   let count = 0;

   for (const item of releasesWithDates) {
       if (
           item.date >= start &&
           item.date <= today
       ) {
           count++;
       }
   }

   return count;
  ```

  }

  let oldestDate = null;
  let newestDate = null;

  for (const item of releasesWithDates) {
  if (
  !oldestDate ||
  item.date < oldestDate
  ) {
  oldestDate = item.date;
  }

  ```
   if (
       !newestDate ||
       item.date > newestDate
   ) {
       newestDate = item.date;
   }
  ```

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
  .sort(
  (a, b) =>
  a[0].localeCompare(b[0])
  );

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

  if (
  oldestDate &&
  newestDate
  ) {
  duration = Math.round(
  (
  newestDate.getTime() -
  oldestDate.getTime()
  ) /
  (1000 * 60 * 60 * 24)
  );
  }

  statisticsCache = {
  total,

  ```
   last7Days:
       countLastDays(7),

   last30Days:
       countLastDays(30),

   last365Days:
       countLastDays(365),

   activeArtists:
       artistMap.size,

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
  ```

  };

  return statisticsCache;
  }

function renderStatistics() {
/*
* Important :
* les statistiques ne sont calculées que lorsque
* l'utilisateur ouvre l'onglet.
*/

```
const totalElement = $("stats-total");
const sevenDaysElement = $("stats-7-days");
const thirtyDaysElement = $("stats-30-days");
const threeHundredSixtyFiveDaysElement =
    $("stats-365-days");
const artistsCountElement =
    $("stats-artists-count");

const singlesElement = $("stats-singles");
const albumsElement = $("stats-albums");
const epsElement = $("stats-eps");
const otherElement = $("stats-other");

const artistsContainer =
    $("stats-artists");

const monthsContainer =
    $("stats-months");

const summaryContainer =
    $("stats-summary");

if (!releases.length) {
    if (totalElement) totalElement.textContent = "0";
    if (sevenDaysElement) sevenDaysElement.textContent = "0";
    if (thirtyDaysElement) thirtyDaysElement.textContent = "0";
    if (threeHundredSixtyFiveDaysElement) {
        threeHundredSixtyFiveDaysElement.textContent = "0";
    }
    if (artistsCountElement) {
        artistsCountElement.textContent = "0";
    }

    if (artistsContainer) {
        artistsContainer.innerHTML = `
            <div class="empty">
                Aucune donnée disponible.
            </div>
        `;
    }

    if (monthsContainer) {
        monthsContainer.innerHTML = `
            <div class="empty">
                Aucune donnée disponible.
            </div>
        `;
    }

    if (summaryContainer) {
        summaryContainer.textContent =
            "Aucune sortie disponible.";
    }

    return;
}

const stats = calculateStatistics();

/* Cartes */

if (totalElement) {
    totalElement.textContent =
        formatNumber(stats.total);
}

if (sevenDaysElement) {
    sevenDaysElement.textContent =
        formatNumber(stats.last7Days);
}

if (thirtyDaysElement) {
    thirtyDaysElement.textContent =
        formatNumber(stats.last30Days);
}

if (threeHundredSixtyFiveDaysElement) {
    threeHundredSixtyFiveDaysElement.textContent =
        formatNumber(stats.last365Days);
}

if (artistsCountElement) {
    artistsCountElement.textContent =
        formatNumber(stats.activeArtists);
}

/* Types */

if (singlesElement) {
    singlesElement.textContent =
        formatNumber(stats.singles);
}

if (albumsElement) {
    albumsElement.textContent =
        formatNumber(stats.albums);
}

if (epsElement) {
    epsElement.textContent =
        formatNumber(stats.eps);
}

if (otherElement) {
    otherElement.textContent =
        formatNumber(stats.other);
}

/* Top artistes */

if (artistsContainer) {
    if (!stats.topArtists.length) {
        artistsContainer.innerHTML = `
            <div class="empty">
                Aucun artiste trouvé.
            </div>
        `;
    } else {
        artistsContainer.innerHTML =
            stats.topArtists
                .map((artist, index) => `
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
                `)
                .join("");
    }
}

/* Évolution mensuelle */

if (monthsContainer) {
    if (!stats.months.length) {
        monthsContainer.innerHTML = `
            <div class="empty">
                Aucune date disponible.
            </div>
        `;
    } else {
        const maxCount = Math.max(
            ...stats.months.map(
                item => item[1]
            )
        );

        monthsContainer.innerHTML =
            stats.months
                .map(([key, count]) => {
                    const percentage =
                        maxCount > 0
                            ? (
                                count /
                                maxCount
                            ) * 100
                            : 0;

                    return `
                        <div class="monthly-stat-row">

                            <div class="monthly-stat-header">

                                <span>
                                    ${escapeHTML(
                                        getMonthLabel(key)
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
}

/* Résumé */

if (summaryContainer) {
    if (
        !stats.oldestDate ||
        !stats.newestDate
    ) {
        summaryContainer.innerHTML = `
            <p>
                Le catalogue contient
                <strong>${formatNumber(
                    stats.total
                )}</strong>
                sortie(s), mais aucune date
                exploitable n'a été trouvée.
            </p>
        `;
    } else {
        const topArtist =
            stats.topArtists[0];

        summaryContainer.innerHTML = `
            <p>
                Le catalogue contient
                <strong>${formatNumber(
                    stats.total
                )}</strong>
                sortie(s).
            </p>

            <p>
                Les sorties couvrent la période du
                <strong>${formatDate(
                    `${stats.oldestDate.getFullYear()}-${String(
                        stats.oldestDate.getMonth() + 1
                    ).padStart(2, "0")}-${String(
                        stats.oldestDate.getDate()
                    ).padStart(2, "0")}`
                )}</strong>
                au
                <strong>${formatDate(
                    `${stats.newestDate.getFullYear()}-${String(
                        stats.newestDate.getMonth() + 1
                    ).padStart(2, "0")}-${String(
                        stats.newestDate.getDate()
                    ).padStart(2, "0")}`
                )}</strong>,
                soit
                <strong>${formatNumber(
                    stats.duration
                )}</strong>
                jour(s).
            </p>

            ${
                topArtist
                    ? `
                        <p>
                            L'artiste avec le plus de sorties est
                            <strong>${escapeHTML(
                                topArtist.name
                            )}</strong>
                            avec
                            <strong>${formatNumber(
                                topArtist.count
                            )}</strong>
                            sortie(s).
                        </p>
                    `
                    : ""
            }

            ${
                stats.busiestMonth
                    ? `
                        <p>
                            Le mois avec le plus de sorties est
                            <strong>${escapeHTML(
                                getMonthLabel(
                                    stats.busiestMonth.key
                                )
                            )}</strong>
                            avec
                            <strong>${formatNumber(
                                stats.busiestMonth.count
                            )}</strong>
                            sortie(s).
                        </p>
                    `
                    : ""
            }
        `;
    }
}
```

}

/* =========================================================
NAVIGATION
========================================================= */

function setupNavigation() {
const buttons =
document.querySelectorAll(".nav-button");

```
const pages =
    document.querySelectorAll(".page");

buttons.forEach(button => {
    button.addEventListener("click", () => {
        const target =
            button.dataset.page;

        if (!target) return;

        buttons.forEach(item =>
            item.classList.remove("active")
        );

        pages.forEach(page =>
            page.classList.remove("active")
        );

        button.classList.add("active");

        const targetPage =
            $(`page-${target}`);

        if (targetPage) {
            targetPage.classList.add("active");
        }

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
    });
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
 * On charge les deux fichiers en parallèle.
 * Avant, ils étaient chargés l'un puis l'autre.
 */

const releasesPromise =
    loadJSON(RELEASES_FILE);

const artistsPromise =
    loadJSON(ARTISTS_FILE);

/* -----------------------------------------------------
   SORTIES
   ----------------------------------------------------- */

try {
    const releasesData =
        await releasesPromise;

    releases =
        parseReleases(releasesData);

    /*
     * Affichage immédiat.
     * Les statistiques ne sont PAS calculées ici.
     */
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

    const statsArtists =
        $("stats-artists");

    const statsMonths =
        $("stats-months");

    const statsSummary =
        $("stats-summary");

    if (statsArtists) {
        statsArtists.innerHTML = message;
    }

    if (statsMonths) {
        statsMonths.innerHTML = message;
    }

    if (statsSummary) {
        statsSummary.innerHTML = message;
    }
}

/* -----------------------------------------------------
   ARTISTES
   ----------------------------------------------------- */

try {
    const artistsData =
        await artistsPromise;

    artists =
        parseArtists(artistsData);

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
```

}

/* =========================================================
ÉVÉNEMENTS
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {
const artistSearch =
$("artist-search");

```
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
```

);

````

### Ce qui change vraiment

Le point le plus important est ici :

**Avant :**

```js
renderReleases();
renderAllReleases();
renderStatistics();
````

Donc au chargement, ton navigateur devait **calculer toutes les statistiques avant d'avoir fini son travail d'affichage**.

**Maintenant :**

```js
renderReleases();
renderAllReleases();
```

Les statistiques sont calculées **uniquement quand tu cliques sur 📊 Statistiques**.

En plus, les deux JSON sont maintenant demandés **en parallèle** :

```js
const releasesPromise = loadJSON(RELEASES_FILE);
const artistsPromise = loadJSON(ARTISTS_FILE);
```

Et j'ai supprimé :

```js
?t=Date.now()
```

avec :

```js
cache: "no-store"
```

qui forçait ton navigateur à **retélécharger les JSON à chaque chargement**, même lorsqu'ils n'avaient pas changé.

Donc cette version devrait être nettement plus réactive, surtout si `sorties.json` est volumineux.

**Remplace uniquement ton `app.js` par celui-ci.** Ne touche ni au HTML ni au CSS.
