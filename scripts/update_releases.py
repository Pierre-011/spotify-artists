import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright


SPOTIFY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

SOUNDCHARTS_URL = "https://soundcharts.com/en/isrc-finder"


def log(message: str) -> None:
    print(message, flush=True)


def repo_root() -> Path:
    return Path.cwd()


def normalize_url(value: Any) -> str:
    """
    Transforme notamment :
    [https://example.com](https://example.com)
    en :
    https://example.com
    """
    if not isinstance(value, str):
        return ""

    value = value.strip()

    markdown_match = re.fullmatch(r"\[([^\]]+)\]\((https?://[^)]+)\)", value)
    if markdown_match:
        value = markdown_match.group(2)

    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1].strip()

    return value


def spotify_artist_url(value: Any) -> str:
    url = normalize_url(value)

    if not url:
        return ""

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return ""

    if "open.spotify.com" not in parsed.netloc:
        return ""

    if "/artist/" not in parsed.path:
        return ""

    return url


def load_artists(path: str = "data/artistes.json") -> List[Dict[str, Any]]:
    file_path = repo_root() / path

    log(f"[INFO] Répertoire courant : {Path.cwd()}")
    log(f"[INFO] Lecture du fichier : {file_path}")

    if not file_path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")

    with file_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise ValueError("artistes.json doit contenir un objet JSON.")

    # Format réel :
    # {
    #   "artists": {
    #       "spotify_id": {...}
    #   },
    #   "timestamp": "..."
    # }
    artists_container = data.get("artists")

    if not isinstance(artists_container, dict):
        raise ValueError(
            "La clé 'artists' est absente ou ne contient pas un objet JSON."
        )

    artists: List[Dict[str, Any]] = []

    for artist_id, artist_data in artists_container.items():
        if not isinstance(artist_data, dict):
            log(f"[WARN] Artiste ignoré : {artist_id} n'est pas un objet.")
            continue

        raw_url = artist_data.get("url", "")
        url = spotify_artist_url(raw_url)

        if not url:
            log(
                f"[WARN] Artiste ignoré : "
                f"{artist_data.get('name', artist_id)} — URL Spotify invalide."
            )
            continue

        artist = dict(artist_data)
        artist["id"] = artist.get("id") or artist_id
        artist["url"] = url

        artists.append(artist)

    log(f"[INFO] {len(artists)} artistes valides chargés.")

    if not artists:
        raise ValueError("Aucun artiste valide trouvé dans data/artistes.json.")

    return artists


def extract_spotify_id(url: str, kind: str) -> str:
    match = re.search(rf"/{kind}/([A-Za-z0-9]+)", url)
    return match.group(1) if match else ""


def get_artist_page(artist_url: str) -> Optional[BeautifulSoup]:
    log(f"[SPOTIFY] Téléchargement : {artist_url}")

    try:
        response = requests.get(
            artist_url,
            headers=SPOTIFY_HEADERS,
            timeout=30,
        )
        response.raise_for_status()
    except requests.RequestException as error:
        log(f"[ERREUR][SPOTIFY] {error}")
        return None

    log(f"[SPOTIFY] Réponse reçue : HTTP {response.status_code}")

    return BeautifulSoup(response.text, "html.parser")


def get_last_release_from_spotify(
    artist: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    artist_url = artist["url"]
    artist_name = artist.get("name", "Artiste inconnu")

    soup = get_artist_page(artist_url)
    if soup is None:
        return None

    # Les pages Spotify sont souvent rendues en JavaScript.
    # On exploite d'abord les métadonnées présentes dans le HTML.
    album_links = []

    for link in soup.find_all("a", href=True):
        href = normalize_url(link.get("href", ""))

        if "/album/" in href:
            if href not in album_links:
                album_links.append(href)

    # Recherche également dans les données JSON intégrées à la page.
    html = str(soup)

    json_album_urls = re.findall(
        r'https?://open\.spotify\.com/(?:intl-[^/]+/)?album/[A-Za-z0-9]+',
        html,
    )

    for album_url in json_album_urls:
        if album_url not in album_links:
            album_links.append(album_url)

    if not album_links:
        log(f"[SPOTIFY] Aucune URL d'album trouvée pour {artist_name}.")
        return None

    # Spotify affiche généralement la sortie la plus récente en premier.
    album_url = album_links[0]
    album_id = extract_spotify_id(album_url, "album")

    title = ""

    for link in soup.find_all("a", href=True):
        href = normalize_url(link.get("href", ""))
        if "/album/" in href and extract_spotify_id(href, "album") == album_id:
            title = link.get_text(" ", strip=True)
            if title:
                break

    if not title:
        title = artist_name

    log(f"[SPOTIFY] Dernière sortie détectée : {title}")
    log(f"[SPOTIFY] URL du projet : {album_url}")
    log(f"[SPOTIFY] ID du projet : {album_id}")

    return {
        "title": title,
        "artists": [artist_name],
        "album_url": album_url,
        "album_id": album_id,
        "release_type": "album",
    }


def parse_release_date(value: str) -> Optional[str]:
    value = value.strip()

    formats = (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
    )

    for date_format in formats:
        try:
            return datetime.strptime(value, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue

    return None


def extract_release_date(text: str) -> Optional[str]:
    patterns = (
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{2}/\d{2}/\d{4}\b",
        r"\b\d{2}-\d{2}-\d{4}\b",
        r"\b\d{4}/\d{2}/\d{2}\b",
    )

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            parsed = parse_release_date(match.group(0))
            if parsed:
                return parsed

    return None


def find_search_input(page):
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
            if locator.is_visible(timeout=2000):
                return locator
        except Exception:
            pass

    return None


def click_search_button(page) -> bool:
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
            if locator.is_visible(timeout=2000):
                locator.click()
                return True
        except Exception:
            pass

    return False


def get_release_date_from_soundcharts(
    title: str,
    artists: List[str],
    page,
) -> Optional[str]:
    query = f"{title} {' & '.join(artists)}".strip()

    log(f"[SOUNDCHARTS] Recherche : {query}")

    try:
        page.goto(
            SOUNDCHARTS_URL,
            wait_until="domcontentloaded",
            timeout=30000,
        )
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Chargement impossible : {error}")
        return None

    search_input = find_search_input(page)

    if search_input is None:
        log("[ERREUR][SOUNDCHARTS] Champ de recherche introuvable.")
        return None

    try:
        search_input.fill(query)
        log("[SOUNDCHARTS] Champ rempli.")
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Champ impossible à remplir : {error}")
        return None

    if not click_search_button(page):
        log("[ERREUR][SOUNDCHARTS] Bouton de recherche introuvable.")
        return None

    log("[SOUNDCHARTS] Recherche envoyée.")

    try:
        page.wait_for_timeout(5000)
    except Exception:
        pass

    try:
        visible_text = page.locator("body").inner_text(timeout=10000)
    except Exception:
        visible_text = page.content()

    release_date = extract_release_date(visible_text)

    if release_date:
        log(f"[SOUNDCHARTS] Date trouvée : {release_date}")
    else:
        log("[SOUNDCHARTS] Aucune date trouvée.")

    return release_date


def load_sorties(path: str = "data/sorties.json") -> Dict[str, Any]:
    file_path = repo_root() / path

    if not file_path.exists():
        log("[INFO] sorties.json absent : création d'une liste vide.")
        return {"tracks": []}

    with file_path.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        return {"tracks": []}

    if not isinstance(data.get("tracks"), list):
        data["tracks"] = []

    log(f"[INFO] Sorties existantes : {len(data['tracks'])}")

    return data


def save_sorties(data: Dict[str, Any], path: str = "data/sorties.json") -> None:
    file_path = repo_root() / path

    with file_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")

    log(f"[INFO] sorties.json sauvegardé : {file_path}")


def already_exists(
    tracks: List[Dict[str, Any]],
    release_info: Dict[str, Any],
    artist: Dict[str, Any],
    release_date: str,
) -> bool:
    album_id = release_info.get("album_id", "")
    artist_id = artist.get("id", "")

    for track in tracks:
        if album_id and track.get("id") == album_id:
            return True

        if (
            track.get("artist_id") == artist_id
            and track.get("album_name") == release_info.get("title")
            and track.get("release_date") == release_date
        ):
            return True

    return False


def build_track_entry(
    artist: Dict[str, Any],
    release_info: Dict[str, Any],
    release_date: str,
) -> Dict[str, Any]:
    title = release_info.get("title", "")
    artist_name = artist.get("name", "Artiste inconnu")
    artist_id = artist.get("id", "")

    return {
        "id": release_info.get("album_id", ""),
        "name": title,
        "artist_name": artist_name,
        "artist_id": artist_id,
        "album_name": title,
        "release_type": release_info.get("release_type", "album"),
        "release_date": release_date,
        "album_image": "",
        "url": release_info.get("album_url", ""),
    }


def main() -> None:
    today = date.today().isoformat()

    log("=" * 70)
    log("[DÉMARRAGE] Mise à jour des sorties")
    log(f"[DÉMARRAGE] Date du jour : {today}")
    log("=" * 70)

    artists = load_artists()
    sorties = load_sorties()
    tracks = sorties["tracks"]

    log(f"[INFO] Artistes à traiter : {len(artists)}")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            locale="fr-FR",
            user_agent=SPOTIFY_HEADERS["User-Agent"],
        )
        page = context.new_page()

        try:
            for index, artist in enumerate(artists, start=1):
                artist_name = artist.get("name", "Artiste inconnu")
                artist_url = artist["url"]

                log("")
                log("=" * 70)
                log(f"[ARTISTE {index}/{len(artists)}] {artist_name}")
                log("=" * 70)

                release = get_last_release_from_spotify(artist)

                if release is None:
                    log("[SKIP] Dernière sortie introuvable.")
                    continue

                release_date = get_release_date_from_soundcharts(
                    release["title"],
                    release["artists"],
                    page,
                )

                if release_date is None:
                    log("[SKIP] Date de sortie introuvable.")
                    continue

                log(f"[INFO] Date SoundCharts : {release_date}")

                if release_date != today:
                    log("[INFO] Ce projet n'est pas sorti aujourd'hui.")
                    continue

                if already_exists(tracks, release, artist, release_date):
                    log("[INFO] Sortie déjà présente dans sorties.json.")
                    continue

                tracks.append(
                    build_track_entry(
                        artist,
                        release,
                        release_date,
                    )
                )

                save_sorties(sorties)
                log("[SUCCÈS] Nouvelle sortie ajoutée.")

        finally:
            browser.close()
            log("[INFO] Navigateur fermé.")

    log("")
    log("=" * 70)
    log(f"[FIN] Traitement terminé. Total de sorties : {len(tracks)}")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        raise
