import asyncio
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError


ARTISTS_FILE = Path("data/artistes.json")
RELEASES_FILE = Path("data/sorties.json")

SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/{}"
SPOTIFY_BASE = "https://open.spotify.com"

CONCURRENCY = 8
HEADLESS = True
PAGE_TIMEOUT = 12_000
TOOLTIP_WAIT = 250
DAYS_TO_SCAN = 7
TIMEZONE = "Europe/Paris"

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

STATUS_TODAY = "today"
STATUS_OLD = "old"
STATUS_NO_RELEASE = "no_release"
STATUS_DATE_NOT_FOUND = "date_not_found"
STATUS_TIMEOUT_ARTIST = "timeout_artist"
STATUS_TIMEOUT_RELEASE = "timeout_release"
STATUS_ERROR_ARTIST = "error_artist"
STATUS_ERROR_RELEASE = "error_release"

ARTIST_READY_SELECTORS = [
    'main a[href*="/album/"]',
    'main a[href*="/track/"]',
    'main a[href*="/episode/"]',
    'main a[href*="/show/"]',
]

RELEASE_LINK_SELECTORS = [
    'a[href*="/album/"]',
    'a[href*="/track/"]',
    'a[href*="/episode/"]',
    'a[href*="/show/"]',
]


def today():
    return datetime.now().strftime("%Y-%m-%d")


def date_days_ago(days):
    return (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")


def parse_spotify_date(text):
    text = re.sub(r"\s+", " ", text.strip().lower())
    match = re.search(r"\b(\d{1,2})\s+([a-zàâçéèêëîïôûùüÿ]+)\s+(\d{4})\b", text)
    if not match:
        return None
    day = int(match.group(1))
    month = MONTHS_FR.get(match.group(2))
    year = int(match.group(3))
    if month is None:
        return None
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def load_json(path, default):
    if not path.exists():
        return default
    try:
        text = path.read_text(encoding="utf-8").strip()
        return default if not text else json.loads(text)
    except Exception as error:
        print(f"[ERREUR JSON] {path}: {error}", flush=True)
        return default


def parse_artists(data):
    if not data:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        artists = data.get("artists")
        if isinstance(artists, list):
            return artists
        if isinstance(artists, dict):
            return list(artists.values())
    return []


def parse_releases(data):
    if not data:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        tracks = data.get("tracks")
        if isinstance(tracks, list):
            return tracks
        releases = data.get("releases")
        if isinstance(releases, list):
            return releases
        if isinstance(releases, dict):
            result = []
            for values in releases.values():
                if isinstance(values, list):
                    result.extend(values)
            return result
    return []


def normalize_spotify_url(url):
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


async def route_handler(route):
    request = route.request
    if request.resource_type in {"image", "media", "font"}:
        await route.abort()
        return

    url = request.url.lower()
    for domain in [
        "google-analytics.com",
        "googletagmanager.com",
        "doubleclick.net",
        "facebook.net",
        "facebook.com/tr",
    ]:
        if domain in url:
            await route.abort()
            return

    await route.continue_()


async def safe_goto(page, url, timeout=PAGE_TIMEOUT):
    for attempt in range(2):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            return True
        except PlaywrightTimeoutError:
            if attempt == 1:
                return False
            await page.wait_for_timeout(400)
    return False


async def wait_any_selector(page, selectors, timeout=PAGE_TIMEOUT):
    deadline = time.perf_counter() + timeout / 1000
    while time.perf_counter() < deadline:
        for selector in selectors:
            try:
                loc = page.locator(selector).first
                if await loc.count() and await loc.is_visible():
                    return selector
            except Exception:
                pass
        await page.wait_for_timeout(150)
    raise PlaywrightTimeoutError("No selector became visible")


def release_key(release):
    release_id = release.get("id")
    if release_id:
        return "id:" + str(release_id)
    return (
        "fallback:"
        + str(release.get("artist_id", ""))
        + "|"
        + str(release.get("name", "")).strip().lower()
        + "|"
        + str(release.get("release_date", ""))
    )


def normalize_release(artist, release_url, release_name, release_date, release_type="album"):
    parsed = urlparse(release_url)
    parts = [p for p in parsed.path.split("/") if p]
    release_id = parts[-1] if parts else ""
    return {
        "id": release_id,
        "name": str(release_name),
        "artist_name": artist.get("name", "Artiste inconnu"),
        "artist_id": artist.get("id", ""),
        "album_name": str(release_name),
        "release_type": release_type,
        "release_date": str(release_date),
        "album_image": "",
        "url": release_url,
    }


async def find_latest_release(page):
    print("      → recherche dernière sortie...", flush=True)

    try:
        await wait_any_selector(page, RELEASE_LINK_SELECTORS, timeout=PAGE_TIMEOUT)
    except PlaywrightTimeoutError:
        print("      ✗ aucune sortie trouvée", flush=True)
        return None, None

    candidates = []
    for selector in RELEASE_LINK_SELECTORS:
        loc = page.locator(selector)
        count = await loc.count()
        for i in range(count):
            item = loc.nth(i)
            try:
                if not await item.is_visible():
                    continue
                href = await item.get_attribute("href")
                if not href:
                    continue
                if href.startswith("/"):
                    href = SPOTIFY_BASE + href
                href = normalize_spotify_url(href)
                text = (await item.inner_text()).strip()
                candidates.append((href, text, selector))
            except Exception:
                continue

    if not candidates:
        print("      ✗ impossible de trouver la dernière sortie", flush=True)
        return None, None

    def score(c):
        href, text, selector = c
        s = 0
        if "/album/" in href:
            s += 30
        if text:
            s += min(len(text), 20)
        if selector == 'a[href*="/album/"]':
            s += 10
        return s

    candidates.sort(key=score, reverse=True)
    href, _, _ = candidates[0]
    print("      ✓ sortie trouvée", flush=True)
    return href, "album" if "/album/" in href else "release"


async def get_release_name(page):
    try:
        title = await page.title()
        if title:
            return title.replace(" | Spotify", "").strip()
    except Exception:
        pass
    return "Sortie inconnue"


async def get_exact_release_date(page, expected_year=None):
    print("      → recherche de l'année...", flush=True)

    try:
        await page.wait_for_selector(r"text=/\b(19|20)\d{2}\b/", timeout=PAGE_TIMEOUT)
    except PlaywrightTimeoutError:
        print("      ✗ année introuvable", flush=True)
        return None

    years = page.locator(r"text=/\b(19|20)\d{2}\b/")
    count = await years.count()
    print(f"      → {count} élément(s) contenant une année trouvé(s)", flush=True)

    for i in range(count - 1, -1, -1):
        element = years.nth(i)
        try:
            if not await element.is_visible():
                continue

            text = (await element.inner_text()).strip()
            if not re.fullmatch(r"(19|20)\d{2}", text):
                continue

            if expected_year and text != str(expected_year):
                continue

            print(f"      → hover sur {text}...", flush=True)
            await element.hover(timeout=3_000)
            await page.wait_for_timeout(TOOLTIP_WAIT)

            candidate_texts = []

            tooltips = page.locator('[role="tooltip"]')
            tooltip_count = await tooltips.count()
            for j in range(tooltip_count):
                tooltip = tooltips.nth(j)
                try:
                    if await tooltip.is_visible():
                        tooltip_text = (await tooltip.inner_text()).strip()
                        if tooltip_text:
                            candidate_texts.append(tooltip_text)
                except Exception:
                    continue

            if not candidate_texts:
                try:
                    candidate_texts.append(await page.locator("body").inner_text())
                except Exception:
                    pass

            for candidate in reversed(candidate_texts):
                fr_matches = re.findall(
                    r"\b\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4}\b",
                    candidate,
                    flags=re.IGNORECASE,
                )
                for date_text in reversed(fr_matches):
                    parsed = parse_spotify_date(date_text)
                    if parsed:
                        print(f"      ✓ date exacte : {parsed}", flush=True)
                        return parsed

                en_matches = re.findall(
                    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b",
                    candidate,
                    flags=re.IGNORECASE,
                )
                for date_text in reversed(en_matches):
                    try:
                        parsed = datetime.strptime(date_text, "%B %d, %Y").strftime("%Y-%m-%d")
                        print(f"      ✓ date exacte : {parsed}", flush=True)
                        return parsed
                    except ValueError:
                        continue

        except Exception:
            continue

    print("      ✗ date exacte non trouvée", flush=True)
    return None


async def process_artist(context, artist, index, total):
    start = time.perf_counter()
    artist_name = artist.get("name", "Artiste inconnu")
    artist_id = artist.get("id")
    prefix = f"[{index}/{total}] {artist_name}"

    print()
    print(prefix, flush=True)

    result = {
        "artist": artist,
        "release": None,
        "status": "error",
        "reason": "",
        "duration": 0,
    }

    if not artist_id:
        result["status"] = STATUS_ERROR_ARTIST
        result["reason"] = "ID Spotify absent."
        print(f"    ✗ {result['reason']}", flush=True)
        return result

    page = None
    try:
        page = await context.new_page()
        artist_url = SPOTIFY_ARTIST_URL.format(artist_id)

        print("    → chargement page artiste...", flush=True)
        if not await safe_goto(page, artist_url):
            result["status"] = STATUS_TIMEOUT_ARTIST
            result["reason"] = "Timeout lors du chargement de la page artiste."
            print(f"    ✗ {result['reason']}", flush=True)
            return result

        try:
            await wait_any_selector(page, ARTIST_READY_SELECTORS, timeout=PAGE_TIMEOUT)
        except PlaywrightTimeoutError:
            pass

        print("    ✓ page artiste chargée", flush=True)

        release_url, release_type = await find_latest_release(page)
        if not release_url:
            result["status"] = STATUS_NO_RELEASE
            result["reason"] = "Aucune sortie Spotify détectée."
            return result

        print("      → chargement page sortie...", flush=True)
        if not await safe_goto(page, release_url):
            result["status"] = STATUS_TIMEOUT_RELEASE
            result["reason"] = "Timeout lors du chargement de la page de sortie."
            print(f"      ✗ {result['reason']}", flush=True)
            return result

        print("      ✓ page sortie chargée", flush=True)

        try:
            await wait_any_selector(page, ["main", "body"], timeout=PAGE_TIMEOUT)
        except PlaywrightTimeoutError:
            pass

        release_name = await get_release_name(page)
        print(f"      → sortie : {release_name}", flush=True)

        expected_year = datetime.now().year
        release_date = await get_exact_release_date(page, expected_year=expected_year)
        if not release_date:
            result["status"] = STATUS_DATE_NOT_FOUND
            result["reason"] = "La sortie a été trouvée, mais la date exacte Spotify n'a pas été récupérée."
            return result

        release = normalize_release(
            artist,
            release_url,
            release_name,
            release_date,
            release_type=release_type,
        )
        result["release"] = release

        if release_date == today():
            result["status"] = STATUS_TODAY
            result["reason"] = f"La dernière sortie Spotify est datée exactement du {release_date}, qui correspond à la date du jour."
            print("    ★ SORTIE DU JOUR", flush=True)
        else:
            result["status"] = STATUS_OLD
            result["reason"] = f"La dernière sortie Spotify est datée du {release_date}, donc ce n'est pas une sortie du jour."
            print(f"    ✓ aucune sortie aujourd'hui ({release_date})", flush=True)

        return result

    except Exception as error:
        result["status"] = STATUS_ERROR_ARTIST
        result["reason"] = f"Erreur : {error}"
        print(f"    ✗ {result['reason']}", flush=True)
        return result

    finally:
        result["duration"] = time.perf_counter() - start
        if page:
            try:
                await page.close()
            except Exception:
                pass
        print(f"    Temps : {result['duration']:.2f}s", flush=True)


async def worker(semaphore, context, artist, index, total):
    async with semaphore:
        return await process_artist(context, artist, index, total)


def save_releases(releases):
    RELEASES_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {"tracks": releases}
    temporary_file = RELEASES_FILE.with_suffix(".tmp")
    temporary_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_file.replace(RELEASES_FILE)


def print_final_report(results, total_duration):
    today_results = [r for r in results if r["status"] == STATUS_TODAY]
    old_results = [r for r in results if r["status"] == STATUS_OLD]
    no_release_results = [r for r in results if r["status"] == STATUS_NO_RELEASE]
    date_not_found_results = [r for r in results if r["status"] == STATUS_DATE_NOT_FOUND]
    timeout_artist_results = [r for r in results if r["status"] == STATUS_TIMEOUT_ARTIST]
    timeout_release_results = [r for r in results if r["status"] == STATUS_TIMEOUT_RELEASE]
    error_results = [r for r in results if r["status"] in {STATUS_ERROR_ARTIST, STATUS_ERROR_RELEASE}]

    print()
    print()
    print("=" * 70)
    print("                    RAPPORT FINAL")
    print("=" * 70)
    print()
    print(f"Artistes analysés      : {len(results)}")
    print(f"Sorties du jour        : {len(today_results)}")
    print(f"Pas de sortie du jour  : {len(old_results)}")
    print(f"Sortie introuvable      : {len(no_release_results)}")
    print(f"Date introuvable        : {len(date_not_found_results)}")
    print(f"Timeout page artiste    : {len(timeout_artist_results)}")
    print(f"Timeout page sortie     : {len(timeout_release_results)}")
    print(f"Erreurs                 : {len(error_results)}")
    print(f"Durée totale            : {total_duration:.2f}s")
    if results:
        print(f"Temps moyen/artiste     : {total_duration / len(results):.2f}s")

    print()
    print("=" * 70)
    print("                    SORTIES DU JOUR")
    print("=" * 70)
    if not today_results:
        print()
        print("Aucune sortie détectée aujourd'hui.")
    else:
        for result in today_results:
            release = result["release"]
            print()
            print(f"✓ {release['artist_name']}")
            print(f"  Sortie : {release['name']}")
            print(f"  Date : {release['release_date']}")
            print(f"  URL : {release['url']}")
            print(f"  Justification : {result['reason']}")

    for title, group in [
        ("SORTIES INTROUVABLES", no_release_results),
        ("DATES INTROUVABLES", date_not_found_results),
        ("TIMEOUTS PAGE ARTISTE", timeout_artist_results),
        ("TIMEOUTS PAGE SORTIE", timeout_release_results),
    ]:
        if not group:
            continue
        print()
        print("=" * 70)
        print(f"                    {title}")
        print("=" * 70)
        for result in group:
            artist = result["artist"]
            print()
            print(f"⚠ {artist.get('name', 'Inconnu')}")
            print(f"  {result['reason']}")

    if error_results:
        print()
        print("=" * 70)
        print("                      ERREURS")
        print("=" * 70)
        for result in error_results:
            artist = result["artist"]
            print()
            print(f"⚠ {artist.get('name', 'Inconnu')}")
            print(f"  {result['reason']}")

    print()
    print("=" * 70)
    print("                         FIN")
    print("=" * 70)


async def main():
    start = time.perf_counter()

    print()
    print("=" * 70)
    print("        MISE À JOUR DES SORTIES SPOTIFY")
    print("=" * 70)
    print(f"Date : {today()}", flush=True)

    artists = parse_artists(load_json(ARTISTS_FILE, {}))
    if not artists:
        print("Aucun artiste trouvé.")
        return

    print(f"Artistes trouvés : {len(artists)}", flush=True)

    existing = parse_releases(load_json(RELEASES_FILE, {"tracks": []}))
    print(f"Sorties existantes : {len(existing)}", flush=True)

    releases_by_key = {}
    for release in existing:
        if isinstance(release, dict):
            releases_by_key[release_key(release)] = release

    print("Démarrage de Playwright...", flush=True)

    async with async_playwright() as p:
        print("Lancement de Chromium...", flush=True)
        browser = await p.chromium.launch(headless=HEADLESS)
        context = await browser.new_context(
            locale="fr-FR",
            timezone_id=TIMEZONE,
            viewport={"width": 1280, "height": 720},
        )
        await context.route("**/*", route_handler)

        print(f"Chromium prêt — {CONCURRENCY} workers", flush=True)

        semaphore = asyncio.Semaphore(CONCURRENCY)
        tasks = [
            asyncio.create_task(worker(semaphore, context, artist, index, len(artists)))
            for index, artist in enumerate(artists, start=1)
        ]

        print("Lancement du traitement...", flush=True)
        results = await asyncio.gather(*tasks)
        await browser.close()

    new_releases = 0
    successful_artists = 0

    for result in results:
        if result["status"] in {STATUS_TODAY, STATUS_OLD}:
            successful_artists += 1

        release = result.get("release")
        if not release:
            continue

        release_date = release.get("release_date", "")
        if not release_date or release_date < date_days_ago(DAYS_TO_SCAN):
            continue

        key = release_key(release)
        if key not in releases_by_key:
            new_releases += 1
            print(
                f"\nNOUVELLE SORTIE : {release['artist_name']} — {release['name']} — {release['release_date']}",
                flush=True,
            )
        else:
            old = releases_by_key[key]
            for field in ("album_image", "url", "release_date", "release_type", "album_name"):
                if not old.get(field) and release.get(field):
                    old[field] = release[field]
            release = old

        releases_by_key[key] = release

    if successful_artists == 0:
        print()
        print("⚠ Aucun artiste n'a été vérifié correctement.")
        print("sorties.json est conservé.")
        total_duration = time.perf_counter() - start
        print_final_report(results, total_duration)
        return

    all_releases = list(releases_by_key.values())
    all_releases.sort(
        key=lambda r: (
            r.get("release_date", ""),
            r.get("artist_name", "").lower(),
            r.get("name", "").lower(),
        ),
        reverse=True,
    )

    save_releases(all_releases)

    total_duration = time.perf_counter() - start
    print_final_report(results, total_duration)
    print()
    print(f"Sorties totales : {len(all_releases)}")
    print(f"Nouvelles sorties : {new_releases}")
    print(f"Fichier : {RELEASES_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
