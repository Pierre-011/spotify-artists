import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

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


def log(message: str) -> None:
    print(message, flush=True)


def normalize_url(value: Any) -> str:
    """
    Nettoie une URL classique ou Markdown.

    Exemple :
    [https://open.spotify.com/artist/ABC](https://open.spotify.com/artist/ABC)
    devient :
    https://open.spotify.com/artist/ABC
    """
    if not isinstance(value, str):
        return ""

    value = value.strip()

    markdown_match = re.fullmatch(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        value,
    )

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
    log(f"[INFO] Fichier artistes : {ARTISTS_FILE}")

    if not ARTISTS_FILE.exists():
        raise FileNotFoundError(
            f"Le fichier artistes.json est introuvable : {ARTISTS_FILE}"
        )

    with ARTISTS_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise ValueError("artistes.json doit contenir un objet JSON.")

    artists_container = data.get("artists")

    if not isinstance(artists_container, dict):
        raise ValueError(
            "La clé 'artists' est absente ou ne contient pas un objet."
        )

    artists: List[Dict[str, Any]] = []

    for artist_id, artist_data in artists_container.items():
        if not isinstance(artist_data, dict):
            continue

        artist_url = normalize_url(artist_data.get("url", ""))

        if not is_spotify_artist_url(artist_url):
            log(
                f"[WARN] URL Spotify invalide pour "
                f"{artist_data.get('name', artist_id)}"
            )
            continue

        artist = dict(artist_data)
        artist["id"] = artist.get("id") or artist_id
        artist["name"] = artist.get("name") or "Artiste inconnu"
        artist["url"] = artist_url

        artists.append(artist)

    log(f"[INFO] {len(artists)} artistes valides chargés.")

    if not artists:
        raise ValueError("Aucun artiste valide trouvé.")

    return artists


def load_releases() -> Dict[str, Any]:
    if not RELEASES_FILE.exists():
        log("[INFO] sorties.json absent, création d'une structure vide.")
        return {"tracks": []}

    with RELEASES_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        return {"tracks": []}

    if not isinstance(data.get("tracks"), list):
        data["tracks"] = []

    log(f"[INFO] {len(data['tracks'])} sorties déjà enregistrées.")

    return data


def save_releases(data: Dict[str, Any]) -> None:
    with RELEASES_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")

    log("[INFO] sorties.json sauvegardé.")


def extract_album_links(page) -> List[str]:
    """
    Extrait les projets dans l'ordre d'apparition dans le HTML rendu.
    """
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
            r"https://open\.spotify\.com/"
            r"(?:intl-[^/]+/)?album/([A-Za-z0-9]+)",
            href,
        )

        if not match:
            continue

        album_id = match.group(1)
        canonical_url = f"https://open.spotify.com/album/{album_id}"

        if canonical_url not in links:
            links.append(canonical_url)

    return links


def extract_project_title(page, album_url: str) -> str:
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

        if album_id in href and text:
            text = " ".join(text.split())

            # Évite de récupérer des textes trop longs ou inutiles.
            if len(text) <= 250:
                return text

    return ""


def scrape_first_spotify_project(
    page,
    artist: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Ouvre la discographie complète et retourne uniquement
    le premier projet apparaissant dans la page.
    """
    artist_name = artist["name"]
    discography_url = build_discography_url(artist["url"])

    log(f"[SPOTIFY] Artiste : {artist_name}")
    log(f"[SPOTIFY] Ouverture : {discography_url}")

    try:
        page.goto(
            discography_url,
            wait_until="domcontentloaded",
            timeout=45000,
        )
    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Timeout de chargement, analyse poursuivie.")
    except Exception as error:
        log(f"[ERREUR][SPOTIFY] {error}")
        return None

    try:
        page.wait_for_timeout(5000)
    except Exception:
        pass

    # On ne parcourt pas toute la discographie.
    # Le but est uniquement de récupérer le premier élément affiché.
    album_links = extract_album_links(page)

    if not album_links:
        log("[SPOTIFY] Aucun projet trouvé dans la discographie.")
        return None

    first_album_url = album_links[0]
    first_album_id = get_spotify_id(first_album_url, "album")
    title = extract_project_title(page, first_album_url)

    if not title:
        title = artist_name

    log(f"[SPOTIFY] Premier projet trouvé : {title}")
    log(f"[SPOTIFY] ID du projet : {first_album_id}")
    log(f"[SPOTIFY] URL du projet : {first_album_url}")

    return {
        "title": title,
        "artists": [artist_name],
        "album_id": first_album_id,
        "album_url": first_album_url,
        "release_type": "album",
    }


def parse_date(value: str) -> Optional[str]:
    formats = (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
    )

    for date_format in formats:
        try:
            return datetime.strptime(
                value.strip(),
                date_format,
            ).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return None


def extract_date_from_html(html: str) -> Optional[str]:
    """
    Recherche la date dans le HTML retourné par Soundcharts.
    """
    patterns = (
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{2}/\d{2}/\d{4}\b",
        r"\b\d{2}-\d{2}-\d{4}\b",
        r"\b\d{4}/\d{2}/\d{2}\b",
    )

    for pattern in patterns:
        matches = re.findall(pattern, html)

        for value in matches:
            parsed = parse_date(value)

            if parsed:
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


def search_soundcharts(
    page,
    project: Dict[str, Any],
) -> Optional[str]:
    """
    Recherche le premier projet dans Soundcharts et lit
    la date directement dans le HTML rendu.
    """
    title = project["title"]
    artist_names = project["artists"]

    query = f"{title} {' & '.join(artist_names)}".strip()

    log(f"[SOUNDCHARTS] Recherche du projet : {query}")

    try:
        page.goto(
            SOUNDCHARTS_URL,
            wait_until="domcontentloaded",
            timeout=45000,
        )
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Page inaccessible : {error}")
        return None

    search_input = find_soundcharts_input(page)

    if search_input is None:
        log("[ERREUR][SOUNDCHARTS] Champ de recherche introuvable.")
        return None

    try:
        search_input.fill(query)
        log("[SOUNDCHARTS] Champ de recherche rempli.")
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Impossible de remplir le champ : {error}")
        return None

    search_button = find_soundcharts_button(page)

    if search_button is None:
        log("[ERREUR][SOUNDCHARTS] Bouton de recherche introuvable.")
        return None

    try:
        search_button.click()
        log("[SOUNDCHARTS] Recherche envoyée.")
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Impossible de cliquer : {error}")
        return None

    try:
        page.wait_for_timeout(5000)
    except Exception:
        pass

    # Important : récupération du HTML après l'exécution de la recherche.
    rendered_html = page.content()

    log(
        f"[SOUNDCHARTS] HTML récupéré "
        f"({len(rendered_html)} caractères)."
    )

    release_date = extract_date_from_html(rendered_html)

    if release_date:
        log(f"[SOUNDCHARTS] Date trouvée dans le HTML : {release_date}")
    else:
        log("[SOUNDCHARTS] Aucune date trouvée dans le HTML.")

    return release_date


def release_exists(
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
        "release_type": project.get("release_type", "album"),
        "release_date": release_date,
        "album_image": "",
        "url": project.get("album_url", ""),
    }


def main() -> None:
    today = date.today().isoformat()

    log("=" * 70)
    log("[DÉMARRAGE] Mise à jour des sorties")
    log(f"[DÉMARRAGE] Date du jour : {today}")
    log("=" * 70)

    artists = load_artists()
    releases_data = load_releases()
    tracks = releases_data["tracks"]

    log(f"[INFO] Nombre d'artistes à traiter : {len(artists)}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        context = browser.new_context(
            locale="fr-FR",
            user_agent=SPOTIFY_USER_AGENT,
            viewport={
                "width": 1440,
                "height": 1000,
            },
        )

        spotify_page = context.new_page()
        soundcharts_page = context.new_page()

        try:
            for index, artist in enumerate(artists, start=1):
                artist_name = artist["name"]

                log("")
                log("=" * 70)
                log(f"[ARTISTE {index}/{len(artists)}] {artist_name}")
                log("=" * 70)

                # Récupération du premier projet uniquement.
                project = scrape_first_spotify_project(
                    spotify_page,
                    artist,
                )

                if project is None:
                    log("[SKIP] Aucun premier projet trouvé.")
                    continue

                release_date = search_soundcharts(
                    soundcharts_page,
                    project,
                )

                if release_date is None:
                    log("[SKIP] Date de sortie introuvable.")
                    continue

                if release_date != today:
                    log(
                        f"[INFO] Projet ignoré : date trouvée "
                        f"{release_date}, date attendue {today}."
                    )
                    continue

                if release_exists(
                    tracks,
                    project,
                    artist,
                    release_date,
                ):
                    log("[INFO] Projet déjà présent dans sorties.json.")
                    continue

                entry = build_release_entry(
                    artist,
                    project,
                    release_date,
                )

                tracks.append(entry)
                save_releases(releases_data)

                log(
                    f"[SUCCÈS] Sortie ajoutée : "
                    f"{entry['album_name']} — {entry['artist_name']}"
                )

        finally:
            browser.close()
            log("[INFO] Navigateur fermé.")

    log("")
    log("=" * 70)
    log(f"[FIN] Sorties enregistrées : {len(tracks)}")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
