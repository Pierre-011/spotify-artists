import asyncio
import json
import re
import time

from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import (
    async_playwright,
    TimeoutError as PlaywrightTimeoutError,
)


# ============================================================
# CONFIGURATION
# ============================================================

ARTISTS_FILE = Path("data/artistes.json")
RELEASES_FILE = Path("data/sorties.json")

SPOTIFY_ARTIST_URL = (
    "https://open.spotify.com/artist/{}"
)

# ------------------------------------------------------------
# PERFORMANCE
# ------------------------------------------------------------

# Nombre d'artistes traités simultanément.
CONCURRENCY = 8

# Navigateur invisible.
HEADLESS = True

# Timeout général d'une page.
PAGE_TIMEOUT = 8_000

# Temps d'attente après le survol de l'année.
TOOLTIP_WAIT = 200

# Fenêtre conservée pour compatibilité avec
# ton ancien système.
DAYS_TO_SCAN = 7

TIMEZONE = "Europe/Paris"


# ============================================================
# MOIS
# ============================================================

MONTHS_FR = {
    "janvier": 1,
    "février": 2,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "août": 8,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "décembre": 12,
    "decembre": 12,
}


# ============================================================
# DATES
# ============================================================

def today():
    return datetime.now().strftime(
        "%Y-%m-%d"
    )


def date_days_ago(days):
    return (
        datetime.now()
        - timedelta(days=days)
    ).strftime("%Y-%m-%d")


def parse_spotify_date(text):
    """
    Transforme :

        21 août 2026

    en :

        2026-08-21
    """

    text = text.strip().lower()

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    match = re.search(
        r"\b"
        r"(\d{1,2})"
        r"\s+"
        r"([a-zàâçéèêëîïôûùüÿ]+)"
        r"\s+"
        r"(\d{4})"
        r"\b",
        text
    )

    if not match:
        return None

    day = int(
        match.group(1)
    )

    month_name = match.group(2)

    year = int(
        match.group(3)
    )

    month = MONTHS_FR.get(
        month_name
    )

    if month is None:
        return None

    try:

        return datetime(
            year,
            month,
            day
        ).strftime(
            "%Y-%m-%d"
        )

    except ValueError:

        return None


# ============================================================
# JSON
# ============================================================

def load_json(path, default):

    if not path.exists():
        return default

    try:

        text = path.read_text(
            encoding="utf-8"
        ).strip()

        if not text:
            return default

        return json.loads(text)

    except Exception as error:

        print(
            f"[ERREUR JSON] "
            f"{path}: {error}",
            flush=True
        )

        return default


def parse_artists(data):

    if not data:
        return []

    if isinstance(
        data,
        list
    ):
        return data

    if isinstance(
        data,
        dict
    ):

        artists = data.get(
            "artists"
        )

        if isinstance(
            artists,
            list
        ):
            return artists

        if isinstance(
            artists,
            dict
        ):
            return list(
                artists.values()
            )

    return []


def parse_releases(data):

    if not data:
        return []

    if isinstance(
        data,
        list
    ):
        return data

    if isinstance(
        data,
        dict
    ):

        tracks = data.get(
            "tracks"
        )

        if isinstance(
            tracks,
            list
        ):
            return tracks

        releases = data.get(
            "releases"
        )

        if isinstance(
            releases,
            list
        ):
            return releases

        if isinstance(
            releases,
            dict
        ):

            result = []

            for values in releases.values():

                if isinstance(
                    values,
                    list
                ):

                    result.extend(
                        values
                    )

            return result

    return []


# ============================================================
# URL
# ============================================================

def normalize_spotify_url(url):

    parsed = urlparse(
        url
    )

    return (
        f"{parsed.scheme}://"
        f"{parsed.netloc}"
        f"{parsed.path}"
    )


# ============================================================
# RESSOURCES INUTILES
# ============================================================

async def route_handler(route):

    request = route.request

    resource_type = (
        request.resource_type
    )

    # Pas besoin des images/vidéos/fonts
    # pour cette recherche.
    if resource_type in {
        "image",
        "media",
        "font",
    }:

        await route.abort()

        return

    url = request.url.lower()

    blocked_domains = [
        "google-analytics.com",
        "googletagmanager.com",
        "doubleclick.net",
        "facebook.net",
        "facebook.com/tr",
    ]

    for domain in blocked_domains:

        if domain in url:

            await route.abort()

            return

    await route.continue_()


# ============================================================
# DERNIÈRE SORTIE
# ============================================================

async def find_latest_release(
    page
):

    print(
        "      → recherche dernière sortie...",
        flush=True
    )

    try:

        await page.wait_for_selector(
            'a[href*="/album/"]',
            timeout=PAGE_TIMEOUT
        )

    except PlaywrightTimeoutError:

        print(
            "      ✗ aucune sortie trouvée",
            flush=True
        )

        return None

    links = page.locator(
        'a[href*="/album/"]'
    )

    count = await links.count()

    for i in range(count):

        link = links.nth(i)

        try:

            if not await link.is_visible():
                continue

            href = await link.get_attribute(
                "href"
            )

            if not href:
                continue

            if "/album/" not in href:
                continue

            if href.startswith("/"):

                href = (
                    "https://open.spotify.com"
                    + href
                )

            href = normalize_spotify_url(
                href
            )

            print(
                f"      ✓ sortie trouvée",
                flush=True
            )

            return href

        except Exception:

            continue

    print(
        "      ✗ impossible de trouver "
        "la dernière sortie",
        flush=True
    )

    return None


# ============================================================
# NOM SORTIE
# ============================================================

async def get_release_name(
    page
):

    try:

        title = await page.title()

        if title:

            title = title.replace(
                " | Spotify",
                ""
            ).strip()

            return title

    except Exception:
        pass

    return "Sortie inconnue"


# ============================================================
# DATE EXACTE
# ============================================================

async def get_exact_release_date(
    page
):

    print(
        "      → recherche de l'année...",
        flush=True
    )

    # --------------------------------------------------------
    # On cherche directement les années visibles.
    # --------------------------------------------------------

    try:

        await page.wait_for_selector(
            "text=/\\b(19|20)\\d{2}\\b/",
            timeout=PAGE_TIMEOUT
        )

    except PlaywrightTimeoutError:

        print(
            "      ✗ année introuvable",
            flush=True
        )

        return None

    years = page.locator(
        "text=/\\b(19|20)\\d{2}\\b/"
    )

    count = await years.count()

    print(
        f"      → {count} élément(s) contenant "
        f"une année trouvé(s)",
        flush=True
    )

    for i in range(count):

        element = years.nth(i)

        try:

            if not await element.is_visible():
                continue

            text = (
                await element.inner_text()
            ).strip()

            if not re.fullmatch(
                r"(19|20)\d{2}",
                text
            ):
                continue

            print(
                f"      → hover sur {text}...",
                flush=True
            )

            # ------------------------------------------------
            # SURVOL
            # ------------------------------------------------

            await element.hover(
                timeout=3_000
            )

            await page.wait_for_timeout(
                TOOLTIP_WAIT
            )

            # ------------------------------------------------
            # RÉCUPÉRATION DU BODY
            # ------------------------------------------------

            body_text = (
                await page.locator(
                    "body"
                ).inner_text()
            )

            # ------------------------------------------------
            # DATES FRANÇAISES
            # ------------------------------------------------

            matches = re.findall(
                r"\b"
                r"\d{1,2}"
                r"\s+"
                r"(?:janvier|février|fevrier|mars|"
                r"avril|mai|juin|juillet|août|aout|"
                r"septembre|octobre|novembre|"
                r"décembre|decembre)"
                r"\s+"
                r"\d{4}"
                r"\b",
                body_text,
                flags=re.IGNORECASE
            )

            for date_text in reversed(
                matches
            ):

                result = parse_spotify_date(
                    date_text
                )

                if result:

                    print(
                        f"      ✓ date exacte : "
                        f"{result}",
                        flush=True
                    )

                    return result

            # ------------------------------------------------
            # DATES ANGLAISES
            # ------------------------------------------------

            matches_en = re.findall(
                r"\b"
                r"(?:January|February|March|April|"
                r"May|June|July|August|September|"
                r"October|November|December)"
                r"\s+"
                r"\d{1,2}"
                r",\s+"
                r"\d{4}"
                r"\b",
                body_text,
                flags=re.IGNORECASE
            )

            for date_text in reversed(
                matches_en
            ):

                try:

                    parsed = datetime.strptime(
                        date_text,
                        "%B %d, %Y"
                    )

                    result = parsed.strftime(
                        "%Y-%m-%d"
                    )

                    print(
                        f"      ✓ date exacte : "
                        f"{result}",
                        flush=True
                    )

                    return result

                except ValueError:
                    pass

        except PlaywrightTimeoutError:

            continue

        except Exception:

            continue

    print(
        "      ✗ date exacte non trouvée",
        flush=True
    )

    return None


# ============================================================
# CLÉ DE DÉDOUBLONNAGE
# ============================================================

def release_key(
    release
):

    release_id = release.get(
        "id"
    )

    if release_id:

        return (
            "id:"
            + str(release_id)
        )

    return (
        "fallback:"
        + str(
            release.get(
                "artist_id",
                ""
            )
        )
        + "|"
        + str(
            release.get(
                "name",
                ""
            )
        ).strip().lower()
        + "|"
        + str(
            release.get(
                "release_date",
                ""
            )
        )
    )


# ============================================================
# NORMALISATION
# ============================================================

def normalize_release(
    artist,
    release_url,
    release_name,
    release_date
):

    parsed = urlparse(
        release_url
    )

    parts = parsed.path.split(
        "/"
    )

    release_id = ""

    if parts:

        release_id = parts[-1]

    return {
        "id": release_id,
        "name": str(
            release_name
        ),
        "artist_name": artist.get(
            "name",
            "Artiste inconnu"
        ),
        "artist_id": artist.get(
            "id",
            ""
        ),
        "album_name": str(
            release_name
        ),
        "release_type": "single",
        "release_date": str(
            release_date
        ),
        "album_image": "",
        "url": release_url,
    }


# ============================================================
# TRAITEMENT D'UN ARTISTE
# ============================================================

async def process_artist(
    context,
    artist,
    index,
    total
):

    start = time.perf_counter()

    artist_name = artist.get(
        "name",
        "Artiste inconnu"
    )

    artist_id = artist.get(
        "id"
    )

    prefix = (
        f"[{index}/{total}] "
        f"{artist_name}"
    )

    print()
    print(
        prefix,
        flush=True
    )

    result = {
        "artist": artist,
        "release": None,
        "status": "error",
        "reason": "",
        "duration": 0,
    }

    if not artist_id:

        result["reason"] = (
            "ID Spotify absent."
        )

        print(
            f"    ✗ {result['reason']}",
            flush=True
        )

        return result

    page = None

    try:

        # ----------------------------------------------------
        # PAGE
        # ----------------------------------------------------

        page = await context.new_page()

        artist_url = (
            SPOTIFY_ARTIST_URL.format(
                artist_id
            )
        )

        print(
            "    → chargement page artiste...",
            flush=True
        )

        await page.goto(
            artist_url,
            wait_until="domcontentloaded",
            timeout=PAGE_TIMEOUT
        )

        print(
            "    ✓ page artiste chargée",
            flush=True
        )

        # ----------------------------------------------------
        # DERNIÈRE SORTIE
        # ----------------------------------------------------

        release_url = (
            await find_latest_release(
                page
            )
        )

        if not release_url:

            result["status"] = "unknown"

            result["reason"] = (
                "Aucune dernière sortie "
                "détectée."
            )

            return result

        # ----------------------------------------------------
        # PAGE DE LA SORTIE
        # ----------------------------------------------------

        print(
            "      → chargement page sortie...",
            flush=True
        )

        await page.goto(
            release_url,
            wait_until="domcontentloaded",
            timeout=PAGE_TIMEOUT
        )

        print(
            "      ✓ page sortie chargée",
            flush=True
        )

        # ----------------------------------------------------
        # NOM
        # ----------------------------------------------------

        release_name = (
            await get_release_name(
                page
            )
        )

        print(
            f"      → sortie : "
            f"{release_name}",
            flush=True
        )

        # ----------------------------------------------------
        # DATE EXACTE
        # ----------------------------------------------------

        release_date = (
            await get_exact_release_date(
                page
            )
        )

        if not release_date:

            result["status"] = "unknown"

            result["reason"] = (
                "La sortie a été trouvée, "
                "mais la date exacte Spotify "
                "n'a pas été récupérée."
            )

            return result

        # ----------------------------------------------------
        # OBJET
        # ----------------------------------------------------

        release = normalize_release(
            artist=artist,
            release_url=release_url,
            release_name=release_name,
            release_date=release_date,
        )

        result["release"] = release

        # ----------------------------------------------------
        # JUSTIFICATION
        # ----------------------------------------------------

        if release_date == today():

            result["status"] = "today"

            result["reason"] = (
                f"La dernière sortie Spotify "
                f"est datée exactement du "
                f"{release_date}, qui correspond "
                f"à la date du jour."
            )

            print(
                "    ★ SORTIE DU JOUR",
                flush=True
            )

        else:

            result["status"] = "old"

            result["reason"] = (
                f"La dernière sortie Spotify "
                f"est datée du "
                f"{release_date}, donc ce n'est "
                f"pas une sortie du jour."
            )

            print(
                f"    ✓ aucune sortie aujourd'hui "
                f"({release_date})",
                flush=True
            )

        return result

    except PlaywrightTimeoutError:

        result["status"] = "error"

        result["reason"] = (
            "Timeout Spotify/Playwright."
        )

        print(
            f"    ✗ {result['reason']}",
            flush=True
        )

        return result

    except Exception as error:

        result["status"] = "error"

        result["reason"] = (
            f"Erreur : {error}"
        )

        print(
            f"    ✗ {result['reason']}",
            flush=True
        )

        return result

    finally:

        result["duration"] = (
            time.perf_counter()
            - start
        )

        if page:

            try:
                await page.close()
            except Exception:
                pass

        print(
            f"    Temps : "
            f"{result['duration']:.2f}s",
            flush=True
        )


# ============================================================
# WORKER
# ============================================================

async def worker(
    semaphore,
    context,
    artist,
    index,
    total
):

    async with semaphore:

        return await process_artist(
            context=context,
            artist=artist,
            index=index,
            total=total,
        )


# ============================================================
# SAUVEGARDE
# ============================================================

def save_releases(
    releases
):

    RELEASES_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    data = {
        "tracks": releases
    }

    temporary_file = (
        RELEASES_FILE.with_suffix(
            ".tmp"
        )
    )

    temporary_file.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )

    temporary_file.replace(
        RELEASES_FILE
    )


# ============================================================
# RAPPORT FINAL
# ============================================================

def print_final_report(
    results,
    total_duration
):

    today_results = [
        r for r in results
        if r["status"] == "today"
    ]

    old_results = [
        r for r in results
        if r["status"] == "old"
    ]

    unknown_results = [
        r for r in results
        if r["status"] == "unknown"
    ]

    error_results = [
        r for r in results
        if r["status"] == "error"
    ]

    print()
    print()
    print("=" * 70)
    print(
        "                    RAPPORT FINAL"
    )
    print("=" * 70)

    print()

    print(
        f"Artistes analysés      : {len(results)}"
    )

    print(
        f"Sorties du jour        : "
        f"{len(today_results)}"
    )

    print(
        f"Pas de sortie du jour  : "
        f"{len(old_results)}"
    )

    print(
        f"Impossible à vérifier  : "
        f"{len(unknown_results)}"
    )

    print(
        f"Erreurs                 : "
        f"{len(error_results)}"
    )

    print(
        f"Durée totale            : "
        f"{total_duration:.2f}s"
    )

    if results:

        print(
            f"Temps moyen/artiste     : "
            f"{total_duration / len(results):.2f}s"
        )

    # --------------------------------------------------------
    # SORTIES DU JOUR
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print(
        "                    SORTIES DU JOUR"
    )
    print("=" * 70)

    if not today_results:

        print()
        print(
            "Aucune sortie détectée aujourd'hui."
        )

    else:

        for result in today_results:

            release = result["release"]

            print()
            print(
                f"✓ {release['artist_name']}"
            )

            print(
                f"  Sortie : {release['name']}"
            )

            print(
                f"  Date : {release['release_date']}"
            )

            print(
                f"  URL : {release['url']}"
            )

            print(
                f"  Justification : "
                f"{result['reason']}"
            )

    # --------------------------------------------------------
    # IMPOSSIBLES À VÉRIFIER
    # --------------------------------------------------------

    if unknown_results:

        print()
        print("=" * 70)
        print(
            "                    À VÉRIFIER"
        )
        print("=" * 70)

        for result in unknown_results:

            artist = result["artist"]

            print()

            print(
                f"⚠ {artist.get('name', 'Inconnu')}"
            )

            print(
                f"  {result['reason']}"
            )

    # --------------------------------------------------------
    # ERREURS
    # --------------------------------------------------------

    if error_results:

        print()
        print("=" * 70)
        print(
            "                      ERREURS"
        )
        print("=" * 70)

        for result in error_results:

            artist = result["artist"]

            print()

            print(
                f"⚠ {artist.get('name', 'Inconnu')}"
            )

            print(
                f"  {result['reason']}"
            )

    print()
    print("=" * 70)
    print(
        "                         FIN"
    )
    print("=" * 70)


# ============================================================
# MAIN
# ============================================================

async def main():

    start = time.perf_counter()

    print()
    print("=" * 70)
    print(
        "        MISE À JOUR DES SORTIES SPOTIFY"
    )
    print("=" * 70)

    print(
        f"Date : {today()}",
        flush=True
    )

    # ========================================================
    # ARTISTES
    # ========================================================

    artists_data = load_json(
        ARTISTS_FILE,
        {}
    )

    artists = parse_artists(
        artists_data
    )

    if not artists:

        print(
            "Aucun artiste trouvé."
        )

        return

    print(
        f"Artistes trouvés : {len(artists)}",
        flush=True
    )

    # --------------------------------------------------------
    # TEST TEMPORAIRE
    #
    # Décommente cette ligne si tu veux tester
    # seulement les 5 premiers artistes.
    # --------------------------------------------------------

    # artists = artists[:5]

    # ========================================================
    # SORTIES EXISTANTES
    # ========================================================

    existing_data = load_json(
        RELEASES_FILE,
        {"tracks": []}
    )

    existing = parse_releases(
        existing_data
    )

    print(
        f"Sorties existantes : {len(existing)}",
        flush=True
    )

    # ========================================================
    # INDEX
    # ========================================================

    releases_by_key = {}

    for release in existing:

        if not isinstance(
            release,
            dict
        ):
            continue

        releases_by_key[
            release_key(release)
        ] = release

    # ========================================================
    # PLAYWRIGHT
    # ========================================================

    print(
        "Démarrage de Playwright...",
        flush=True
    )

    async with async_playwright() as p:

        print(
            "Lancement de Chromium...",
            flush=True
        )

        browser = await p.chromium.launch(
            headless=True
        )

        context = await browser.new_context(
            locale="fr-FR",
            timezone_id=TIMEZONE,
            viewport={
                "width": 1280,
                "height": 720,
            },
        )

        await context.route(
            "**/*",
            route_handler
        )

        print(
            f"Chromium prêt — "
            f"{CONCURRENCY} workers",
            flush=True
        )

        # ====================================================
        # TÂCHES
        # ====================================================

        semaphore = asyncio.Semaphore(
            CONCURRENCY
        )

        tasks = []

        for index, artist in enumerate(
            artists,
            start=1
        ):

            tasks.append(
                asyncio.create_task(
                    worker(
                        semaphore=semaphore,
                        context=context,
                        artist=artist,
                        index=index,
                        total=len(artists),
                    )
                )
            )

        print(
            "Lancement du traitement...",
            flush=True
        )

        results = await asyncio.gather(
            *tasks
        )

        await browser.close()

    # ========================================================
    # INTÉGRATION
    # ========================================================

    new_releases = 0

    successful_artists = 0
    failed_artists = 0

    for result in results:

        if result["status"] in {
            "today",
            "old",
        }:

            successful_artists += 1

        elif result["status"] == "error":

            failed_artists += 1

        release = result.get(
            "release"
        )

        if not release:
            continue

        release_date = release.get(
            "release_date",
            ""
        )

        if not release_date:
            continue

        # Compatible avec l'ancienne
        # fenêtre de 7 jours.
        if release_date < date_days_ago(
            DAYS_TO_SCAN
        ):

            continue

        key = release_key(
            release
        )

        if key not in releases_by_key:

            new_releases += 1

            print(
                f"\nNOUVELLE SORTIE : "
                f"{release['artist_name']} "
                f"— {release['name']} "
                f"— {release['release_date']}",
                flush=True
            )

        else:

            old = releases_by_key[key]

            for field in (
                "album_image",
                "url",
                "release_date",
                "release_type",
                "album_name",
            ):

                if (
                    not old.get(field)
                    and release.get(field)
                ):

                    old[field] = release[field]

            release = old

        releases_by_key[key] = release

    # ========================================================
    # SÉCURITÉ
    # ========================================================

    if successful_artists == 0:

        print()
        print(
            "⚠ Aucun artiste n'a été "
            "vérifié correctement."
        )

        print(
            "sorties.json est conservé."
        )

        total_duration = (
            time.perf_counter()
            - start
        )

        print_final_report(
            results,
            total_duration
        )

        return

    # ========================================================
    # SAUVEGARDE
    # ========================================================

    all_releases = list(
        releases_by_key.values()
    )

    all_releases.sort(
        key=lambda release: (
            release.get(
                "release_date",
                ""
            ),
            release.get(
                "artist_name",
                ""
            ).lower(),
            release.get(
                "name",
                ""
            ).lower(),
        ),
        reverse=True
    )

    save_releases(
        all_releases
    )

    # ========================================================
    # RAPPORT
    # ========================================================

    total_duration = (
        time.perf_counter()
        - start
    )

    print_final_report(
        results,
        total_duration
    )

    print()
    print(
        f"Sorties totales : "
        f"{len(all_releases)}"
    )

    print(
        f"Nouvelles sorties : "
        f"{new_releases}"
    )

    print(
        f"Fichier : {RELEASES_FILE}"
    )


# ============================================================
# LANCEMENT
# ============================================================

if __name__ == "__main__":

    asyncio.run(
        main()
    )
