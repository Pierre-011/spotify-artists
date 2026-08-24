import json
import re
import sys
import time
import random
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT_DIR = Path.cwd()
ARTISTS_FILE = ROOT_DIR / "data" / "artistes.json"
RELEASES_FILE = ROOT_DIR / "data" / "sorties.json"

SOUNDCHARTS_URL = "https://soundcharts.com/en/isrc-finder"

SPOTIFY_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 "
    "(KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

TARGET_YEAR = 2026

ENGLISH_MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "sept": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def log(message: str) -> None:
    print(message, flush=True)


def normalize_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    markdown_match = re.fullmatch(r"\[([^\]]+)\]\((https?://[^)]+)\)", value)
    if markdown_match:
        value = markdown_match.group(2).strip()
    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1].strip()
    return value


def is_spotify_artist_url(url: str) -> bool:
    parsed = urlparse(url)
    return (
        parsed.scheme in {"http", "https"}
        and "open.spotify.com" in parsed.netloc
        and "/artist/" in parsed.path
    )


def get_spotify_id(url: str, item_type: str) -> str:
    match = re.search(rf"/{item_type}/([A-Za-z0-9]+)", url)
    return match.group(1) if match else ""


def build_discography_url(artist_url: str) -> str:
    clean_url = normalize_url(artist_url).rstrip("/")
    clean_url = re.sub(
        r"/discography/(all|albums|singles|compilations|appears-on)$",
        "",
        clean_url,
        flags=re.IGNORECASE,
    )
    return f"{clean_url}/discography/all"


def load_artists() -> List[Dict[str, Any]]:
    log(f"[INFO] Répertoire courant : {ROOT_DIR}")
    log(f"[INFO] Lecture de : {ARTISTS_FILE}")

    if not ARTISTS_FILE.exists():
        raise FileNotFoundError(f"Fichier introuvable : {ARTISTS_FILE}")

    with ARTISTS_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise ValueError("artistes.json doit contenir un objet JSON.")

    artists_container = data.get("artists")
    if not isinstance(artists_container, dict):
        raise ValueError("La clé 'artists' est absente ou incorrecte.")

    artists: List[Dict[str, Any]] = []

    for artist_id, artist_data in artists_container.items():
        if not isinstance(artist_data, dict):
            continue

        artist_url = normalize_url(artist_data.get("url", ""))
        if not is_spotify_artist_url(artist_url):
            log(f"[WARN] URL invalide pour {artist_data.get('name', artist_id)}")
            continue

        artist = dict(artist_data)
        artist["id"] = artist_data.get("id") or artist_id
        artist["name"] = artist_data.get("name", "Artiste inconnu")
        artist["url"] = artist_url
        artists.append(artist)

    log(f"[INFO] {len(artists)} artistes chargés.")
    if not artists:
        raise ValueError("Aucun artiste valide trouvé dans artistes.json.")
    return artists


def load_releases() -> Dict[str, Any]:
    if not RELEASES_FILE.exists():
        log("[INFO] sorties.json absent.")
        return {"tracks": []}

    with RELEASES_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        log("[WARN] sorties.json invalide.")
        return {"tracks": []}

    if not isinstance(data.get("tracks"), list):
        data["tracks"] = []

    log(f"[INFO] {len(data['tracks'])} sortie(s) déjà enregistrée(s).")
    return data


def save_releases(data: Dict[str, Any]) -> None:
    with RELEASES_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")
    log(f"[INFO] Fichier sauvegardé : {RELEASES_FILE}")


def extract_album_links(page) -> List[str]:
    links: List[str] = []
    anchors = page.locator("a[href*='/album/']")
    count = anchors.count()

    for index in range(count):
        try:
            href = anchors.nth(index).get_attribute("href")
        except Exception:
            continue

        if not href:
            continue

        href = normalize_url(href)
        if href.startswith("/"):
            href = f"https://open.spotify.com{href}"

        match = re.search(
            r"https://open\.spotify\.com/(?:intl-[^/]+/)?album/([A-Za-z0-9]+)",
            href,
        )
        if not match:
            continue

        album_id = match.group(1)
        canonical_url = f"https://open.spotify.com/album/{album_id}"
        if canonical_url not in links:
            links.append(canonical_url)

    return links


def get_album_title(page, album_url: str) -> str:
    album_id = get_spotify_id(album_url, "album")
    anchors = page.locator("a[href*='/album/']")
    count = anchors.count()

    for index in range(count):
        anchor = anchors.nth(index)
        try:
            href = anchor.get_attribute("href") or ""
            text = anchor.inner_text(timeout=3000).strip()
        except Exception:
            continue

        if album_id not in href or not text:
            continue

        title = " ".join(text.split())
        if len(title) <= 250:
            return title

    return ""


def parse_spotify_release_date_from_html(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")

    meta = soup.find("meta", attrs={"property": "music:release_date"})
    if meta and meta.get("content"):
        parsed = parse_date(meta["content"])
        if parsed:
            return parsed

    for script in soup.find_all("script"):
        script_text = script.get_text(" ", strip=True)
        if not script_text:
            continue

        match = re.search(
            r'"release_date"\s*:\s*"([^"]+)"',
            script_text,
            flags=re.IGNORECASE,
        )
        if match:
            parsed = parse_date(match.group(1))
            if parsed:
                return parsed

    text = " ".join(soup.get_text(" ", strip=True).split())
    match = re.search(
        r"\b(20\d{2})(?:-\d{2})?(?:-\d{2})?\b",
        text,
    )
    if match:
        parsed = parse_date(match.group(0))
        if parsed:
            return parsed

    return None


def spotify_project_info_from_html(html: str) -> Optional[Dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")

    meta_type = soup.find("meta", attrs={"property": "music:release_type"})
    if meta_type and meta_type.get("content"):
        release_type = meta_type["content"].strip().lower()
    else:
        release_type = ""

    if not release_type:
        for script in soup.find_all("script"):
            script_text = script.get_text(" ", strip=True)
            if not script_text:
                continue
            match = re.search(
                r'"album_type"\s*:\s*"([^"]+)"',
                script_text,
                flags=re.IGNORECASE,
            )
            if match:
                release_type = match.group(1).strip().lower()
                break

    release_date = parse_spotify_release_date_from_html(html)
    if not release_date:
        return None

    year = int(release_date[:4])
    if release_type != "single":
        return {"skip": True, "reason": f"release_type={release_type or 'unknown'}"}

    if year != TARGET_YEAR:
        return {"skip": True, "reason": f"year={year}"}

    return {
        "skip": False,
        "release_type": release_type,
        "release_date": release_date,
        "year": year,
    }


def scrape_first_project(page, artist: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    artist_name = artist["name"]
    discography_url = build_discography_url(artist["url"])

    log(f"[SPOTIFY] Artiste : {artist_name}")
    log(f"[SPOTIFY] URL : {discography_url}")

    try:
        page.goto(
            discography_url,
            wait_until="domcontentloaded",
            timeout=120000,
        )
        page.wait_for_selector("a[href*='/album/']", timeout=15000)
    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Timeout de chargement.")
    except Exception as error:
        log(f"[ERREUR][SPOTIFY] {error}")
        return None

    html = page.content()
    info = spotify_project_info_from_html(html)

    if info is None:
        log("[SKIP][SPOTIFY] Métadonnées de sortie introuvables.")
        return None

    if info.get("skip"):
        log(f"[SKIP][SPOTIFY] Projet ignoré : {info['reason']}.")
        return None

    album_links = extract_album_links(page)
    if not album_links:
        log(f"[SPOTIFY] Aucun projet trouvé pour {artist_name}.")
        return None

    first_album_url = album_links[0]
    first_album_id = get_spotify_id(first_album_url, "album")
    title = get_album_title(page, first_album_url) or artist_name

    project = {
        "title": title,
        "artists": [artist_name],
        "album_id": first_album_id,
        "album_url": first_album_url,
        "release_type": "single",
        "release_year": info["year"],
        "release_date": info["release_date"],
    }

    log(f"[SPOTIFY] Premier titre : {title}")
    log(f"[SPOTIFY] ID : {first_album_id}")
    log(f"[SPOTIFY] URL : {first_album_url}")

    return project


def parse_date(value: str) -> Optional[str]:
    value = " ".join(value.strip().split())
    numeric_formats = (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
    )

    for date_format in numeric_formats:
        try:
            return datetime.strptime(value, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue

    match = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})", value)
    if not match:
        return None

    month_name = match.group(1).lower()
    day_value = int(match.group(2))
    year_value = int(match.group(3))
    month_value = ENGLISH_MONTHS.get(month_name)

    if month_value is None:
        return None

    try:
        return date(year_value, month_value, day_value).isoformat()
    except ValueError:
        return None


def extract_release_date_from_html(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup(["script", "style", "noscript"]):
        element.decompose()

    visible_text = " ".join(soup.get_text(" ", strip=True).split())

    full_months = (
        "January|February|March|April|May|June|July|"
        "August|September|October|November|December"
    )
    short_months = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"

    patterns = [
        rf"\bRelease(?:d)?\s+({full_months})\s+(\d{{1,2}}),\s+(\d{{4}})",
        rf"\bRelease(?:d)?\s+({short_months})\.?\s+(\d{{1,2}}),\s+(\d{{4}})",
        rf"\b({full_months})\s+(\d{{1,2}}),\s+(\d{{4}})\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, visible_text, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = f"{match.group(1)} {match.group(2)}, {match.group(3)}"
        parsed = parse_date(candidate)
        if parsed:
            log(f"[SOUNDCHARTS] Date détectée : {parsed}")
            return parsed

    for pattern in [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{2}/\d{2}/\d{4}\b",
        r"\b\d{2}-\d{2}-\d{4}\b",
        r"\b\d{4}/\d{2}/\d{2}\b",
    ]:
        match = re.search(pattern, visible_text)
        if match:
            parsed = parse_date(match.group(0))
            if parsed:
                log(f"[SOUNDCHARTS] Date numérique : {parsed}")
                return parsed

    return None


def find_soundcharts_input(page):
    selectors = [
        "input[placeholder*='ISRC' i]",
        "input[placeholder*='title' i]",
        "input[placeholder*='artist' i]",
        "input[name*='search' i]",
        "input[type='search']",
        "input[type='text']",
    ]
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.is_visible(timeout=1500):
                return locator
        except Exception:
            pass
    return None


def find_soundcharts_button(page):
    selectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button:has-text('Search')",
        "button:has-text('search')",
        "button[class*='search' i]",
        "form button",
    ]
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.is_visible(timeout=1500):
                return locator
        except Exception:
            pass
    return None


def search_soundcharts(page, project: Dict[str, Any]) -> Optional[str]:
    title = project["title"]
    artist_name = project["artists"][0]
    query = f"{title} {artist_name}".strip()

    log(f"[SOUNDCHARTS] Recherche : {query}")

    try:
        page.goto(SOUNDCHARTS_URL, wait_until="domcontentloaded", timeout=120000)
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Page inaccessible : {error}")
        return None

    search_input = find_soundcharts_input(page)
    if search_input is None:
        log("[ERREUR][SOUNDCHARTS] Champ de recherche introuvable.")
        return None

    try:
        search_input.fill(query)
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Impossible de remplir le champ : {error}")
        return None

    search_button = find_soundcharts_button(page)
    if search_button is None:
        log("[ERREUR][SOUNDCHARTS] Bouton de recherche introuvable.")
        return None

    try:
        search_button.click()
        page.wait_for_timeout(4000)
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Impossible d’envoyer la recherche : {error}")
        return None

    rendered_html = page.content()
    release_date = extract_release_date_from_html(rendered_html)

    if release_date:
        log(f"[SOUNDCHARTS] Date de sortie : {release_date}")
    else:
        log("[SOUNDCHARTS] Date de sortie introuvable.")

    return release_date


def release_already_exists(
    tracks: List[Dict[str, Any]],
    project: Dict[str, Any],
    artist: Dict[str, Any],
    release_date: str,
) -> bool:
    album_id = project.get("album_id", "")
    artist_id = artist.get("id", "")
    title = project.get("title", "")

    for track in tracks:
        if album_id and track.get("id") == album_id:
            return True
        if (
            track.get("artist_id") == artist_id
            and track.get("album_name") == title
            and track.get("release_date") == release_date
        ):
            return True

    return False


def build_release_entry(
    artist: Dict[str, Any],
    project: Dict[str, Any],
    release_date: str,
) -> Dict[str, Any]:
    return {
        "id": project.get("album_id", ""),
        "name": project.get("title", ""),
        "artist_name": artist.get("name", "Artiste inconnu"),
        "artist_id": artist.get("id", ""),
        "album_name": project.get("title", ""),
        "release_type": project.get("release_type", "single"),
        "release_date": release_date,
        "album_image": "",
        "url": project.get("album_url", ""),
    }


def process_artist(
    spotify_page,
    soundcharts_page,
    artist: Dict[str, Any],
    tracks: List[Dict[str, Any]],
    today: str,
) -> None:
    project = scrape_first_project(spotify_page, artist)
    if project is None:
        log("[SKIP] Aucun projet trouvé.")
        return

    release_date = search_soundcharts(soundcharts_page, project)
    if release_date is None:
        log("[SKIP] Date introuvable dans Soundcharts.")
        return

    if release_date != today:
        log(f"[INFO] Projet ignoré : {release_date} != {today}")
        return

    if release_already_exists(tracks, project, artist, release_date):
        log("[INFO] Projet déjà présent dans sorties.json.")
        return

    entry = build_release_entry(artist, project, release_date)
    tracks.append(entry)
    save_releases({"tracks": tracks})
    log(f"[SUCCÈS] Sortie ajoutée : {entry['album_name']} — {entry['artist_name']}")


def main() -> None:
    today = date.today().isoformat()

    log("=" * 70)
    log("[DÉMARRAGE] Mise à jour des sorties")
    log(f"[DÉMARRAGE] Date du jour : {today}")
    log("=" * 70)

    artists = load_artists()
    releases_data = load_releases()
    tracks = releases_data["tracks"]

    log(f"[INFO] Artistes à traiter : {len(artists)}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            locale="fr-FR",
            user_agent=SPOTIFY_USER_AGENT,
            viewport={"width": 1440, "height": 1000},
        )
        context.set_default_timeout(30000)
        context.set_default_navigation_timeout(120000)

        spotify_page = context.new_page()
        soundcharts_page = context.new_page()

        try:
            for index, artist in enumerate(artists, start=1):
                log("")
                log("=" * 70)
                log(f"[ARTISTE {index}/{len(artists)}] {artist['name']}")
                log("=" * 70)

                try:
                    process_artist(
                        spotify_page,
                        soundcharts_page,
                        artist,
                        tracks,
                        today,
                    )
                except Exception as error:
                    log(f"[ERREUR ARTISTE] {artist['name']} : {error}")
                    continue

                if index % 75 == 0:
                    log("[INFO] Recréation du contexte navigateur.")
                    try:
                        spotify_page.close()
                        soundcharts_page.close()
                        context.close()
                    except Exception:
                        pass

                    context = browser.new_context(
                        locale="fr-FR",
                        user_agent=SPOTIFY_USER_AGENT,
                        viewport={"width": 1440, "height": 1000},
                    )
                    context.set_default_timeout(30000)
                    context.set_default_navigation_timeout(120000)
                    spotify_page = context.new_page()
                    soundcharts_page = context.new_page()

                time.sleep(random.uniform(1.5, 4.0))

        finally:
            try:
                context.close()
            except Exception:
                pass
            browser.close()
            log("[INFO] Navigateur fermé.")

    log("")
    log("=" * 70)
    log(f"[FIN] Total de sorties : {len(tracks)}")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
