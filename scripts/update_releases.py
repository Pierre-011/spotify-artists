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
    """Affiche immédiatement un message dans les logs GitHub Actions."""
    print(message, flush=True)


def normalize_url(value: Any) -> str:
    """
    Nettoie une URL classique ou une URL enregistrée au format Markdown.

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
        return markdown_match.group(2).strip()

    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1].strip()

    return value


def get_spotify_artist_id(url: str) -> str:
    match = re.search(r"/artist/([A-Za-z0-9]+)", url)
    return match.group(1) if match else ""


def get_spotify_album_id(url: str) -> str:
    match = re.search(r"/album/([A-Za-z0-9]+)", url)
    return match.group(1) if match else ""


def is_spotify_artist_url(url: str) -> bool:
    parsed = urlparse(url)

    return (
        parsed.scheme in {"http", "https"}
        and "open.spotify.com" in parsed.netloc
        and "/artist/" in parsed.path
        and bool(get_spotify_artist_id(url))
    )


def build_discography_url(artist_url: str) -> str:
    """
    Construit l'URL /discography/all sans conserver un ancien suffixe.
    """
    clean_url = normalize_url(artist_url).rstrip("/")

    clean_url = re.sub(
        r"/discography/(?:all|albums|singles|compilations|appears-on)$",
        "",
        clean_url,
        flags=re.IGNORECASE,
    )

    return f"{clean_url}/discography/all"


def load_artists() -> List[Dict[str, Any]]:
    log(f"[INFO] Répertoire courant : {ROOT_DIR}")
    log(f"[INFO] Lecture des artistes : {ARTISTS_FILE}")

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
            log(f"[WARN] Artiste ignoré : {artist_id} n'est pas un objet.")
            continue

        raw_url = artist_data.get("url", "")
        artist_url = normalize_url(raw_url)

        if not is_spotify_artist_url(artist_url):
            log(
                f"[WARN] Artiste ignoré : "
                f"{artist_data.get('name', artist_id)} — URL invalide."
            )
            continue

        artist = dict(artist_data)
        artist["id"] = artist.get("id") or artist_id
        artist["url"] = artist_url
        artist["name"] = artist.get("name") or "Artiste inconnu"

        artists.append(artist)

    log(f"[INFO] {len(artists)} artistes valides chargés.")

    if not artists:
        raise ValueError("Aucun artiste valide trouvé dans artistes.json.")

    return artists


def load_releases() -> Dict[str, Any]:
    if not RELEASES_FILE.exists():
        log("[INFO] sorties.json absent : initialisation vide.")
        return {"tracks": []}

    with RELEASES_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        log("[WARN] sorties.json invalide : réinitialisation.")
        return {"tracks": []}

    if not isinstance(data.get("tracks"), list):
        data["tracks"] = []

    log(f"[INFO] {len(data['tracks'])} sorties existantes chargées.")

    return data


def save_releases(data: Dict[str, Any]) -> None:
    with RELEASES_FILE.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")

    log(f"[INFO] Fichier sauvegardé : {RELEASES_FILE}")


def get_visible_text(page) -> str:
    try:
        return page.locator("body").inner_text(timeout=10000)
    except Exception:
        return ""


def extract_album_links(page) -> List[str]:
    """
    Extrait tous les liens /album/ visibles dans la page.
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

        if not href.startswith("http"):
            continue

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


def get_album_title_from_link(page, album_url: str) -> str:
    album_id = get_spotify_album_id(album_url)

    anchors = page.locator("a[href*='/album/']")
    count = anchors.count()

    for index in range(count):
        anchor = anchors.nth(index)

        try:
            href = anchor.get_attribute("href") or ""
            text = anchor.inner_text(timeout=2000).strip()
        except Exception:
            continue

        if album_id in href and text:
            return " ".join(text.split())

    return ""


def extract_json_ld_projects(page) -> List[Dict[str, str]]:
    """
    Tente d'extraire les projets présents dans les balises JSON-LD.
    Cette méthode complète l'extraction des liens visibles.
    """
    projects: List[Dict[str, str]] = []

    scripts = page.locator("script[type='application/ld+json']")
    count = scripts.count()

    for index in range(count):
        try:
            raw = scripts.nth(index).inner_text(timeout=2000)
            parsed = json.loads(raw)
        except Exception:
            continue

        candidates: List[Any] = []

        if isinstance(parsed, list):
            candidates.extend(parsed)
        elif isinstance(parsed, dict):
            candidates.append(parsed)

        for item in candidates:
            if not isinstance(item, dict):
                continue

            url = normalize_url(item.get("url", ""))
            name = str(item.get("name", "")).strip()

            if "/album/" not in url:
                continue

            album_id = get_spotify_album_id(url)

            if not album_id:
                continue

            projects.append(
                {
                    "id": album_id,
                    "title": name,
                    "url": f"https://open.spotify.com/album/{album_id}",
                }
            )

    return projects


def scrape_spotify_discography(
    page,
    artist: Dict[str, Any],
) -> List[Dict[str, Any]]:
    artist_name = artist["name"]
    artist_url = artist["url"]
    discography_url = build_discography_url(artist_url)

    log(f"[SPOTIFY] Artiste : {artist_name}")
    log(f"[SPOTIFY] Ouverture : {discography_url}")

    try:
        page.goto(
            discography_url,
            wait_until="domcontentloaded",
            timeout=45000,
        )
    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Timeout de chargement, poursuite de l'analyse.")
    except Exception as error:
        log(f"[ERREUR][SPOTIFY] Impossible d'ouvrir la page : {error}")
        return []

    try:
        page.wait_for_timeout(5000)
    except Exception:
        pass

    # Défilement pour permettre le chargement d'une éventuelle liste dynamique.
    for _ in range(5):
        try:
            page.mouse.wheel(0, 2500)
            page.wait_for_timeout(800)
        except Exception:
            break

    album_links = extract_album_links(page)
    json_projects = extract_json_ld_projects(page)

    projects: List[Dict[str, Any]] = []
    seen_ids = set()

    for project in json_projects:
        album_id = project["id"]

        if album_id in seen_ids:
            continue

        seen_ids.add(album_id)

        projects.append(
            {
                "title": project.get("title") or artist_name,
                "artists": [artist_name],
                "album_url": project["url"],
                "album_id": album_id,
                "release_type": "album",
            }
        )

    for album_url in album_links:
        album_id = get_spotify_album_id(album_url)

        if not album_id or album_id in seen_ids:
            continue

        title = get_album_title_from_link(page, album_url)

        if not title:
            title = artist_name

        seen_ids.add(album_id)

        projects.append(
            {
                "title": title,
                "artists": [artist_name],
                "album_url": album_url,
                "album_id": album_id,
                "release_type": "album",
            }
        )

    log(f"[SPOTIFY] {len(projects)} projet(s) trouvé(s) pour {artist_name}.")

    for index, project in enumerate(projects, start=1):
        log(
            f"[SPOTIFY] Projet {index}/{len(projects)} : "
            f"{project['title']} — {project['album_url']}"
        )

    return projects


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
            return datetime.strptime(value.strip(), date_format).strftime(
                "%Y-%m-%d"
            )
        except ValueError:
            continue

    return None


def extract_date(text: str) -> Optional[str]:
    patterns = (
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{2}/\d{2}/\d{4}\b",
        r"\b\d{2}-\d{2}-\d{4}\b",
        r"\b\d{4}/\d{2}/\d{2}\b",
    )

    for pattern in patterns:
        match = re.search(pattern, text)

        if not match:
            continue

        parsed = parse_date(match.group(0))

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
    title = project["title"]
    artists = project["artists"]
    query = f"{title} {' & '.join(artists)}".strip()

    log(f"[SOUNDCHARTS] Recherche : {query}")

    try:
        page.goto(
            SOUNDCHARTS_URL,
            wait_until="domcontentloaded",
            timeout=45000,
        )
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Chargement impossible : {error}")
        return None

    search_input = find_soundcharts_input(page)

    if search_input is None:
        log("[ERREUR][SOUNDCHARTS] Champ de recherche introuvable.")
        return None

    try:
        search_input.fill(query)
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Champ impossible à remplir : {error}")
        return None

    search_button = find_soundcharts_button(page)

    if search_button is None:
        log("[ERREUR][SOUNDCHARTS] Bouton de recherche introuvable.")
        return None

    try:
        search_button.click()
        log("[SOUNDCHARTS] Recherche envoyée.")
    except Exception as error:
        log(f"[ERREUR][SOUNDCHARTS] Clic impossible : {error}")
        return None

    try:
        page.wait_for_timeout(5000)
    except Exception:
        pass

    visible_text = get_visible_text(page)
    release_date = extract_date(visible_text)

    if release_date:
        log(f"[SOUNDCHARTS] Date trouvée : {release_date}")
    else:
        log("[SOUNDCHARTS] Date introuvable.")

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
    title = project["title"]

    return {
        "id": project.get("album_id", ""),
        "name": title,
        "artist_name": artist.get("name", "Artiste inconnu"),
        "artist_id": artist.get("id", ""),
        "album_name": title,
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
        browser = playwright.chromium.launch(
            headless=True,
        )

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
            for artist_index, artist in enumerate(artists, start=1):
                artist_name = artist["name"]

                log("")
                log("=" * 70)
                log(
                    f"[ARTISTE {artist_index}/{len(artists)}] "
                    f"{artist_name}"
                )
                log("=" * 70)

                projects = scrape_spotify_discography(
                    spotify_page,
                    artist,
                )

                if not projects:
                    log("[SKIP] Aucun projet trouvé.")
                    continue

                for project_index, project in enumerate(projects, start=1):
                    log("")
                    log(
                        f"[PROJET {project_index}/{len(projects)}] "
                        f"{project['title']}"
                    )

                    release_date = search_soundcharts(
                        soundcharts_page,
                        project,
                    )

                    if not release_date:
                        log("[SKIP] Date de sortie non trouvée.")
                        continue

                    if release_date != today:
                        log(
                            f"[INFO] Date {release_date} différente "
                            f"de la date du jour {today}."
                        )
                        continue

                    if release_already_exists(
                        tracks,
                        project,
                        artist,
                        release_date,
                    ):
                        log("[INFO] Sortie déjà présente dans sorties.json.")
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
    log(f"[FIN] Total de sorties enregistrées : {len(tracks)}")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
