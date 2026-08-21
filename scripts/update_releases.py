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
# CONFIGURATION EXISTANTE
# ============================================================

ARTISTS_FILE = Path("data/artistes.json")
RELEASES_FILE = Path("data/sorties.json")

SPOTIFY_ARTIST_URL = (
    "https://open.spotify.com/artist/{}"
)

# ============================================================
# OPTIMISATION
# ============================================================

# Nombre d'artistes traités simultanément.
#
# Commence à 8 sur GitHub Actions.
#
# Tu pourras tester :
#
#   8
#   12
#   16
#
# et comparer les temps.
CONCURRENCY = 8

# Le navigateur n'est jamais affiché.
HEADLESS = True

# Timeout maximum d'une navigation.
PAGE_TIMEOUT = 15_000

# Petite attente après le hover.
TOOLTIP_WAIT = 150

# Fenêtre de recherche conservée pour
# rester compatible avec ton système actuel.
DAYS_TO_SCAN = 7

TIMEZONE = "Europe/Paris"


# ============================================================
# MOIS FRANÇAIS
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
    Convertit une date Spotify française :

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
# JSON EXISTANT
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
            f"{path}: {error}"
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
# URL SPOTIFY
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
# BLOQUAGE DES RESSOURCES INUTILES
# ============================================================

async def route_handler(route):

    request = route.request

    resource_type = (
        request.resource_type
    )

    # Pour récupérer les informations
    # nous n'avons pas besoin des images,
    # vidéos ou polices.
    if resource_type in {
        "image",
        "media",
        "font",
    }:

        await route.abort()

        return

    # Tracking inutile.
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
# NOM ARTISTE
# ============================================================

async def get_artist_name(page):

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

    return "Artiste inconnu"


# ============================================================
# DERNIÈRE SORTIE
# ============================================================

async def find_latest_release(page):

    try:

        await page.wait_for_selector(
            'a[href*="/album/"]',
            timeout=PAGE_TIMEOUT
        )

    except PlaywrightTimeoutError:

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

            return normalize_spotify_url(
                href
            )

        except Exception:

            continue

    return None


# ============================================================
# NOM DE LA SORTIE
# ============================================================

async def get_release_name(page):

    try:

        title = await page.title()

        if title:

            return title.replace(
                " | Spotify",
                ""
            ).strip()

    except Exception:
        pass

    return "Sortie inconnue"


# ============================================================
# DATE EXACTE SPOTIFY
# ============================================================

async def get_exact_release_date(page):

    try:

        await page.wait_for_selector(
            "text=/\\b(19|20)\\d{2}\\b/",
            timeout=PAGE_TIMEOUT
        )

    except PlaywrightTimeoutError:

        return None

    candidates = page.locator(
        "text=/\\b(19|20)\\d{2}\\b/"
    )

    count = await candidates.count()

    if count == 0:
        return None

    for i in range(count):

        element = candidates.nth(i)

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

            # ------------------------------------------------
            # HOVER SUR L'ANNÉE
            # ------------------------------------------------

            await element.hover()

            await page.wait_for_timeout(
                TOOLTIP_WAIT
            )

            # ------------------------------------------------
            # CONTENU DU BODY
            # ------------------------------------------------

            body_text = (
                await page.locator(
                    "body"
                ).inner_text()
            )

            # ------------------------------------------------
            # FRANÇAIS
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

            if matches:

                for date_text in reversed(
                    matches
                ):

                    result = parse_spotify_date(
                        date_text
                    )

                    if result:
                        return result

            # ------------------------------------------------
            # ANGLAIS
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

            if matches_en:

                for date_text in reversed(
                    matches_en
                ):

                    try:

                        parsed = datetime.strptime(
                            date_text,
                            "%B %d, %Y"
                        )

                        return parsed.strftime(
                            "%Y-%m-%d"
                        )

                    except ValueError:
                        pass

        except Exception:

            continue

    return None


# ============================================================
# IDENTIFIANT DE SORTIE
# ============================================================

def release_key(release):

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

    artist_id = str(
        artist.get(
            "id",
            ""
        )
    )

    artist_name = str(
        artist.get(
            "name",
            "Artiste inconnu"
        )
    )

    parsed = urlparse(
        release_url
    )

    parts = parsed.path.split("/")

    release_id = ""

    if parts:

        release_id = parts[-1]

    # --------------------------------------------------------
    # On ne connaît pas forcément le type avec certitude.
    # Le comportement existant considère "single" par défaut.
    # --------------------------------------------------------

    release_type = "single"

    return {
        "id": release_id,
        "name": str(
            release_name
        ),
        "artist_name": artist_name,
        "artist_id": artist_id,
        "album_name": str(
            release_name
        ),
        "release_type": release_type,
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

    artist_id = artist.get(
        "id"
    )

    artist_name = artist.get(
        "name",
        "Artiste inconnu"
    )

    result = {
        "artist": artist,
        "release": None,
        "status": "error",
        "reason": "",
        "duration": 0,
    }

    if not artist_id:

        result["status"] = "error"

        result["reason"] = (
            "ID Spotify absent."
        )

        return result

    page = await context.new_page()

    try:

        artist_url = (
            SPOTIFY_ARTIST_URL.format(
                artist_id
            )
        )

        # ====================================================
        # PAGE ARTISTE
        # ====================================================

        await page.goto(
            artist_url,
            wait_until="domcontentloaded",
            timeout=PAGE_TIMEOUT
        )

        # ====================================================
        # DERNIÈRE SORTIE
        # ====================================================

        release_url = (
            await find_latest_release(
                page
            )
        )

        if not release_url:

            result["status"] = (
                "unknown"
            )

            result["reason"] = (
                "La page Spotify de l'artiste "
                "a été chargée mais aucune "
                "dernière sortie n'a été trouvée."
            )

            return result

        # ====================================================
        # PAGE SORTIE
        # ====================================================

        await page.goto(
            release_url,
            wait_until="domcontentloaded",
            timeout=PAGE_TIMEOUT
        )

        release_name = (
            await get_release_name(
                page
            )
        )

        # ====================================================
        # DATE EXACTE
        # ====================================================

        release_date = (
            await get_exact_release_date(
                page
            )
        )

        if not release_date:

            result["status"] = (
                "unknown"
            )

            result["reason"] = (
                "La dernière sortie a été trouvée, "
                "mais la date exacte Spotify n'a "
                "pas pu être récupérée."
            )

            return result

        # ====================================================
        # OBJET COMPATIBLE AVEC SORTIES.JSON
        # ====================================================

        release = normalize_release(
            artist=artist,
            release_url=release_url,
            release_name=release_name,
            release_date=release_date,
        )

        result["release"] = release

        # ====================================================
        # DÉCISION
        # ====================================================

        if release_date == today():

            result["status"] = "today"

            result["reason"] = (
                f"La date exacte Spotify "
                f"({release_date}) correspond "
                f"à la date du jour."
            )

        else:

            result["status"] = "old"

            result["reason"] = (
                f"La dernière sortie Spotify "
                f"date du {release_date}."
            )

        return result

    except PlaywrightTimeoutError:

        result["status"] = "error"

        result["reason"] = (
            "Timeout lors de la communication "
            "avec Spotify."
        )

        return result

    except Exception as error:

        result["status"] = "error"

        result["reason"] = (
            f"Erreur technique : {error}"
        )

        return result

    finally:

        result["duration"] = (
            time.perf_counter()
            - start
        )

        await page.close()


# ============================================================
# RETRY
# ============================================================

async def process_artist_with_retry(
    context,
    artist,
    index,
    total,
    retries=2
):

    last_result = None

    for attempt in range(
        retries + 1
    ):

        result = await process_artist(
            context=context,
            artist=artist,
            index=index,
            total=total,
        )

        last_result = result

        # Si tout s'est bien passé,
        # inutile de recommencer.
        if result["status"] in {
            "today",
            "old",
            "unknown",
        }:

            return result

        # Dernière tentative.
        if attempt >= retries:

            return result

        # Petit délai avant retry.
        await asyncio.sleep(
            1 + attempt
        )

    return last_result


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

        return await process_artist_with_retry(
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
        result
        for result in results
        if result["status"] == "today"
    ]

    old_results = [
        result
        for result in results
        if result["status"] == "old"
    ]

    unknown_results = [
        result
        for result in results
        if result["status"] == "unknown"
    ]

    error_results = [
        result
        for result in results
        if result["status"] == "error"
    ]

    print()
    print()
    print("=" * 70)

    print(
        "              RAPPORT FINAL"
    )

    print("=" * 70)

    print()

    print(
        f"Artistes analysés       : "
        f"{len(results)}"
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
        f"Erreurs techniques     : "
        f"{len(error_results)}"
    )

    print(
        f"Durée totale           : "
        f"{total_duration:.2f} secondes"
    )

    if results:

        print(
            f"Temps moyen/artiste    : "
            f"{total_duration / len(results):.2f} secondes"
        )

    # ========================================================
    # SORTIES DU JOUR
    # ========================================================

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
                f"  {release['name']}"
            )

            print(
                f"  Date : {release['release_date']}"
            )

            print(
                f"  URL  : {release['url']}"
            )

            print(
                f"  Justification : "
                f"{result['reason']}"
            )

    # ========================================================
    # À VÉRIFIER
    # ========================================================

    if unknown_results:

        print()
        print("=" * 70)

        print(
            "                 À VÉRIFIER"
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

    # ========================================================
    # ERREURS
    # ========================================================

    if error_results:

        print()
        print("=" * 70)

        print(
            "                    ERREURS"
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
# PROGRAMME PRINCIPAL
# ============================================================

async def main():

    start = time.perf_counter()

    # ========================================================
    # CHARGEMENT DES ARTISTES
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

    # ========================================================
    # CHARGEMENT DES SORTIES EXISTANTES
    # ========================================================

    existing_data = load_json(
        RELEASES_FILE,
        {"tracks": []}
    )

    existing = parse_releases(
        existing_data
    )

    # ========================================================
    # INDEX DES SORTIES EXISTANTES
    # ========================================================

    releases_by_key = {}

    for release in existing:

        if not isinstance(
            release,
            dict
        ):
            continue

        key = release_key(
            release
        )

        releases_by_key[key] = release

    print()
    print("=" * 70)

    print(
        "        MISE À JOUR DES SORTIES SPOTIFY"
    )

    print("=" * 70)

    print()

    print(
        f"Date : {today()}"
    )

    print(
        f"Artistes : {len(artists)}"
    )

    print(
        f"Sorties déjà enregistrées : "
        f"{len(existing)}"
    )

    print(
        f"Concurrence : {CONCURRENCY}"
    )

    print(
        "Navigateur : Edge headless"
    )

    print()

    # ========================================================
    # PLAYWRIGHT
    # ========================================================

    async with async_playwright() as p:

        browser = await p.chromium.launch(
            channel="msedge",
            headless=HEADLESS,
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

        semaphore = asyncio.Semaphore(
            CONCURRENCY
        )

        # ====================================================
        # TRAITEMENT PARALLÈLE
        # ====================================================

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

        results = await asyncio.gather(
            *tasks
        )

        await browser.close()

    # ========================================================
    # INTÉGRATION DES RÉSULTATS
    # ========================================================

    new_releases = 0

    successful_artists = 0
    failed_artists = 0

    for result in results:

        status = result["status"]

        if status in {
            "today",
            "old",
        }:

            successful_artists += 1

        elif status == "error":

            failed_artists += 1

        release = result.get(
            "release"
        )

        # ----------------------------------------------------
        # IMPORTANT :
        #
        # On conserve uniquement les sorties
        # qui entrent dans la fenêtre existante
        # de DAYS_TO_SCAN.
        #
        # Cela garde le comportement de ton
        # ancien système.
        # ----------------------------------------------------

        if not release:

            continue

        release_date = release.get(
            "release_date",
            ""
        )

        if not release_date:

            continue

        if release_date < date_days_ago(
            DAYS_TO_SCAN
        ):

            continue

        key = release_key(
            release
        )

        # ----------------------------------------------------
        # NOUVELLE SORTIE
        # ----------------------------------------------------

        if key not in releases_by_key:

            new_releases += 1

            print()

            print(
                "NOUVELLE SORTIE : "
                f"{release['artist_name']} "
                f"— {release['name']} "
                f"— {release['release_date']}"
            )

        else:

            # ------------------------------------------------
            # Complète les données existantes sans les
            # écraser inutilement.
            # ------------------------------------------------

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
    # SAUVEGARDE
    # ========================================================

    # Même format que ton système actuel.
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
        reverse=True,
    )

    # --------------------------------------------------------
    # Sécurité :
    #
    # si Spotify est totalement indisponible,
    # on NE remplace PAS sorties.json par une liste vide.
    # --------------------------------------------------------

    if successful_artists == 0:

        print()
        print(
            "⚠ Aucun artiste n'a pu être "
            "vérifié correctement."
        )

        print(
            "Le fichier sorties.json "
            "est conservé tel quel."
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
        f"Sorties totales dans sorties.json : "
        f"{len(all_releases)}"
    )

    print(
        f"Nouvelles sorties ajoutées : "
        f"{new_releases}"
    )

    print(
        f"Artistes correctement vérifiés : "
        f"{successful_artists}"
    )

    print(
        f"Artistes en erreur : "
        f"{failed_artists}"
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
