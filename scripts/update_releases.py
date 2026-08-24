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

SPOTIFY_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 "
    "(KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def log(message: str) -> None:
    print(message, flush=True)


def normalize_url(value: Any) -> str:
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
    match = re.search(
        rf"/{item_type}/([A-Za-z0-9]+)",
        url,
        flags=re.IGNORECASE,
    )

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
        raise FileNotFoundError(
            f"Fichier introuvable : {ARTISTS_FILE}"
        )

    with ARTISTS_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict):
        raise ValueError(
            "artistes.json doit contenir un objet JSON."
        )

    artists_container = data.get("artists")

    if not isinstance(artists_container, dict):
        raise ValueError(
            "La clé 'artists' est absente ou incorrecte."
        )

    artists: List[Dict[str, Any]] = []

    for artist_id, artist_data in artists_container.items():
        if not isinstance(artist_data, dict):
            continue

        artist_url = normalize_url(
            artist_data.get("url", "")
        )

        if not is_spotify_artist_url(artist_url):
            log(
                f"[WARN] URL invalide pour "
                f"{artist_data.get('name', artist_id)}"
            )
            continue

        artist = dict(artist_data)
        artist["id"] = artist_data.get("id") or artist_id
        artist["name"] = artist_data.get(
            "name",
            "Artiste inconnu",
        )
        artist["url"] = artist_url

        artists.append(artist)

    log(f"[INFO] {len(artists)} artistes chargés.")

    if not artists:
        raise ValueError(
            "Aucun artiste valide trouvé dans artistes.json."
        )

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

    log(
        f"[INFO] {len(data['tracks'])} sortie(s) "
        "déjà enregistrée(s)."
    )

    return data


def save_releases(data: Dict[str, Any]) -> None:
    RELEASES_FILE.parent.mkdir(parents=True, exist_ok=True)

    with RELEASES_FILE.open("w", encoding="utf-8") as file:
        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")

    log(f"[INFO] Fichier sauvegardé : {RELEASES_FILE}")


def parse_date(value: str) -> Optional[date]:
    """Parse une date Spotify en français ou en anglais.

    Formats pris en charge notamment :
    - 2026-08-07
    - 07/08/2026
    - 07-08-2026
    - 08/07/2026
    - August 7, 2026
    - August 7 2026
    - 7 August 2026
    - 7 août 2026
    - 7 aout 2026
    - 7 août 2026 avec espace insécable
    """
    if not value:
        return None

    value = " ".join(str(value).strip().split())
    value = value.replace("\u00a0", " ")

    # Normalisation légère pour pouvoir reconnaître les accents français
    # (août -> aout, février -> fevrier, décembre -> decembre, etc.).
    import unicodedata

    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(
        char for char in normalized
        if unicodedata.category(char) != "Mn"
    )

    # Format ISO : 2026-08-24 / 2026/08/24
    match = re.search(
        r"\b((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})\b",
        normalized,
    )

    if match:
        try:
            return date(
                int(match.group(1)),
                int(match.group(2)),
                int(match.group(3)),
            )
        except ValueError:
            return None

    # Formats numériques.
    # On conserve l'ordre existant : DD/MM/YYYY avant MM/DD/YYYY.
    for fmt in (
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%Y/%m/%d",
    ):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass

    # Mois anglais + français.
    months = {
        # Anglais
        "january": 1,
        "jan": 1,
        "february": 2,
        "feb": 2,
        "march": 3,
        "mar": 3,
        "april": 4,
        "apr": 4,
        "may": 5,
        "june": 6,
        "jun": 6,
        "july": 7,
        "jul": 7,
        "august": 8,
        "aug": 8,
        "september": 9,
        "sep": 9,
        "sept": 9,
        "october": 10,
        "oct": 10,
        "november": 11,
        "nov": 11,
        "december": 12,
        "dec": 12,

        # Français (sans accents car `normalized` les retire)
        "janvier": 1,
        "janv": 1,
        "fevrier": 2,
        "fevr": 2,
        "fev": 2,
        "mars": 3,
        "avril": 4,
        "avr": 4,
        "mai": 5,
        "juin": 6,
        "juillet": 7,
        "juil": 7,
        "aout": 8,
        "septembre": 9,
        "octobre": 10,
        "novembre": 11,
        "decembre": 12,
    }

    # Format anglais : August 24, 2026 / August 24 2026
    match = re.search(
        r"\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+"
        r"((?:19|20)\d{2})\b",
        normalized,
        flags=re.IGNORECASE,
    )

    if match:
        month = months.get(match.group(1).lower())

        if month:
            try:
                return date(
                    int(match.group(3)),
                    month,
                    int(match.group(2)),
                )
            except ValueError:
                return None

    # Format français : 7 août 2026 / 1er août 2026
    match = re.search(
        r"\b(\d{1,2})(?:er)?\s+([A-Za-z]+)\s+"
        r"((?:19|20)\d{2})\b",
        normalized,
        flags=re.IGNORECASE,
    )

    if match:
        month = months.get(match.group(2).lower())

        if month:
            try:
                return date(
                    int(match.group(3)),
                    month,
                    int(match.group(1)),
                )
            except ValueError:
                return None

    return None


def parse_date_from_encore_element(
    element: Any,
) -> Optional[date]:
    """
    Analyse un élément ayant data-encore-id.

    La date peut se trouver :
    - dans le texte de l'élément ;
    - dans son HTML interne ;
    - dans ses attributs ;
    - dans un élément enfant.
    """

    values: List[str] = []

    try:
        values.append(element.get_text(" ", strip=True))
    except Exception:
        pass

    try:
        values.append(str(element))
    except Exception:
        pass

    if hasattr(element, "attrs"):
        for attribute_value in element.attrs.values():
            if isinstance(attribute_value, list):
                values.extend(
                    str(item)
                    for item in attribute_value
                )
            else:
                values.append(str(attribute_value))

    for value in values:
        parsed = parse_date(value)

        if parsed:
            return parsed

    return None


def extract_release_date_from_html(
    html: str,
) -> Optional[date]:
    """
    Recherche prioritairement les éléments Spotify
    utilisant data-encore-id.
    """

    soup = BeautifulSoup(html, "html.parser")

    encore_elements = soup.select("[data-encore-id]")

    log(
        f"[DEBUG] Éléments data-encore-id trouvés : "
        f"{len(encore_elements)}"
    )

    # Recherche prioritaire dans data-encore-id
    for element in encore_elements:
        encore_id = element.get("data-encore-id", "")

        parsed = parse_date_from_encore_element(element)

        if parsed:
            log(
                "[DATE] Date trouvée dans "
                f"data-encore-id='{encore_id}' : "
                f"{parsed.isoformat()}"
            )
            return parsed

    # Recherche dans les éléments contenant un identifiant Encore
    # associé à la date ou à la sortie
    for element in soup.find_all(True):
        attributes_text = " ".join(
            f"{key}={value}"
            for key, value in element.attrs.items()
        )

        if not re.search(
            r"date|release|album|metadata",
            attributes_text,
            flags=re.IGNORECASE,
        ):
            continue

        parsed = parse_date_from_encore_element(element)

        if parsed:
            log(
                "[DATE] Date trouvée dans un élément "
                "Encore lié aux métadonnées : "
                f"{parsed.isoformat()}"
            )
            return parsed

    # Fallback : métadonnées HTML
    metadata_selectors = [
        ("time", "datetime"),
        ("meta[property='music:release_date']", "content"),
        ("meta[name='release_date']", "content"),
        ("meta[property='release_date']", "content"),
        ("meta[itemprop='datePublished']", "content"),
        ("meta[itemprop='releaseDate']", "content"),
    ]

    for selector, attribute in metadata_selectors:
        for element in soup.select(selector):
            value = element.get(attribute, "")
            parsed = parse_date(value)

            if not parsed:
                parsed = parse_date(
                    element.get_text(" ", strip=True)
                )

            if parsed:
                log(
                    f"[DATE] Date trouvée avec {selector}: "
                    f"{parsed.isoformat()}"
                )
                return parsed

    # Fallback : scripts JSON/JavaScript
    patterns = [
        r'"release_date"\s*:\s*"([^"]+)"',
        r'"releaseDate"\s*:\s*"([^"]+)"',
        r'"datePublished"\s*:\s*"([^"]+)"',
    ]

    for script in soup.find_all("script"):
        raw = script.string or script.get_text()

        if not raw:
            continue

        for pattern in patterns:
            for match in re.finditer(
                pattern,
                raw,
                flags=re.IGNORECASE,
            ):
                parsed = parse_date(match.group(1))

                if parsed:
                    log(
                        "[DATE] Date trouvée dans un script : "
                        f"{parsed.isoformat()}"
                    )
                    return parsed

    # Dernier fallback : texte global de la page
    visible_text = soup.get_text(" ", strip=True)
    parsed = parse_date(visible_text)

    if parsed:
        log(
            "[DATE] Date trouvée dans le texte global : "
            f"{parsed.isoformat()}"
        )
        return parsed

    return None


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
            r"https://open\.spotify\.com/"
            r"(?:intl-[^/]+/)?album/([A-Za-z0-9]+)",
            href,
            flags=re.IGNORECASE,
        )

        if not match:
            continue

        album_id = match.group(1)
        canonical_url = (
            f"https://open.spotify.com/album/{album_id}"
        )

        if canonical_url not in links:
            links.append(canonical_url)

    return links


def get_album_title(
    page,
    album_url: str,
) -> str:
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

    try:
        headings = page.locator("h1")

        if headings.count() > 0:
            title = headings.first.inner_text(
                timeout=3000
            ).strip()

            if title:
                return " ".join(title.split())
    except Exception:
        pass

    return ""


def save_debug_html(
    html: str,
    artist_name: str,
) -> Path:
    safe_name = re.sub(
        r"[^A-Za-z0-9À-ÿ_.-]+",
        "_",
        artist_name,
    )

    debug_file = ROOT_DIR / (
        f"spotify_debug_{safe_name}.html"
    )

    debug_file.write_text(
        html,
        encoding="utf-8",
    )

    return debug_file


def wait_for_page_content(page) -> None:
    try:
        page.wait_for_selector(
            "main, h1, a[href*='/artist/']",
            timeout=30000,
        )
    except PlaywrightTimeoutError:
        log(
            "[WARN][SPOTIFY] Élément principal "
            "non détecté."
        )

    try:
        page.wait_for_selector(
            "[data-encore-id]",
            timeout=30000,
        )
    except PlaywrightTimeoutError:
        log(
            "[WARN][SPOTIFY] Aucun élément "
            "data-encore-id détecté."
        )

    page.wait_for_timeout(5000)


def get_latest_spotify_project(
    page,
    artist: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
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

        page.wait_for_selector(
            "a[href*='/album/']",
            timeout=30000,
        )

        page.wait_for_timeout(3000)

    except PlaywrightTimeoutError:
        log(
            "[WARN][SPOTIFY] Timeout de chargement "
            "de la discographie."
        )
    except Exception as error:
        log(f"[ERREUR][SPOTIFY] {error}")
        return None

    album_links = extract_album_links(page)

    if not album_links:
        log(
            f"[SPOTIFY] Aucun projet trouvé "
            f"pour {artist_name}."
        )
        return None

    # La première sortie affichée par Spotify est utilisée
    # comme dernière sortie de l'artiste.
    latest_album_url = album_links[0]
    latest_album_id = get_spotify_id(
        latest_album_url,
        "album",
    )

    log(
        "[SPOTIFY] Dernière sortie détectée : "
        f"{latest_album_url}"
    )

    try:
        page.goto(
            latest_album_url,
            wait_until="domcontentloaded",
            timeout=120000,
        )

        wait_for_page_content(page)

    except Exception as error:
        log(
            "[ERREUR][SPOTIFY] Impossible d’ouvrir "
            f"la sortie : {error}"
        )
        return None

    html = page.content()

    release_date = extract_release_date_from_html(html)

    if release_date is None:
        debug_file = save_debug_html(
            html,
            artist_name,
        )

        try:
            body_text = page.locator(
                "body"
            ).inner_text(timeout=5000)

            log(
                "[DEBUG] Texte visible de la page : "
                f"{body_text[:1000]}"
            )
        except Exception:
            pass

        log(
            "[SKIP][SPOTIFY] Date introuvable dans "
            "les éléments data-encore-id."
        )
        log(
            f"[DEBUG] HTML sauvegardé dans : "
            f"{debug_file}"
        )

        return None

    title = get_album_title(
        page,
        latest_album_url,
    ) or artist_name

    return {
        "title": title,
        "artists": [artist_name],
        "album_id": latest_album_id,
        "album_url": latest_album_url,
        "release_type": "unknown",
        "release_date": release_date,
    }


def release_already_exists(
    tracks: List[Dict[str, Any]],
    project: Dict[str, Any],
    artist: Dict[str, Any],
    release_date: date,
) -> bool:
    album_id = project.get("album_id", "")
    artist_id = artist.get("id", "")
    title = project.get("title", "")
    release_date_str = release_date.isoformat()

    for track in tracks:
        if album_id and track.get("id") == album_id:
            return True

        if (
            track.get("artist_id") == artist_id
            and track.get("album_name") == title
            and track.get("release_date") == release_date_str
        ):
            return True

    return False


def build_release_entry(
    artist: Dict[str, Any],
    project: Dict[str, Any],
    release_date: date,
) -> Dict[str, Any]:
    release_date_str = release_date.isoformat()

    return {
        "id": project.get("album_id", ""),
        "name": project.get("title", ""),
        "artist_name": artist.get(
            "name",
            "Artiste inconnu",
        ),
        "artist_id": artist.get("id", ""),
        "album_name": project.get("title", ""),
        "release_type": project.get(
            "release_type",
            "unknown",
        ),
        "release_date": release_date_str,
        "album_image": "",
        "url": project.get("album_url", ""),
    }


def process_artist(
    spotify_page,
    artist: Dict[str, Any],
    tracks: List[Dict[str, Any]],
    today: date,
) -> None:
    project = get_latest_spotify_project(
        spotify_page,
        artist,
    )

    if project is None:
        log("[SKIP] Dernière sortie non éligible.")
        return

    release_date = project["release_date"]

    if release_date != today:
        log(
            "[INFO] Projet ignoré : "
            f"{release_date.isoformat()} != "
            f"{today.isoformat()}"
        )
        return

    if release_already_exists(
        tracks,
        project,
        artist,
        release_date,
    ):
        log(
            "[INFO] Projet déjà présent "
            "dans sorties.json."
        )
        return

    entry = build_release_entry(
        artist,
        project,
        release_date,
    )

    tracks.append(entry)
    save_releases({"tracks": tracks})

    log(
        "[SUCCÈS] Sortie ajoutée : "
        f"{entry['album_name']} — "
        f"{entry['artist_name']}"
    )


def create_browser_context(browser):
    context = browser.new_context(
        locale="fr-FR",
        user_agent=SPOTIFY_USER_AGENT,
        viewport={
            "width": 1440,
            "height": 1000,
        },
    )

    context.set_default_timeout(30000)
    context.set_default_navigation_timeout(120000)

    return context


def main() -> None:
    today = date.today()

    log("=" * 70)
    log("[DÉMARRAGE] Mise à jour des sorties")
    log(
        f"[DÉMARRAGE] Date du jour : "
        f"{today.isoformat()}"
    )
    log("=" * 70)

    artists = load_artists()
    releases_data = load_releases()
    tracks = releases_data["tracks"]

    log(
        f"[INFO] Artistes à traiter : "
        f"{len(artists)}"
    )

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
        )

        context = create_browser_context(browser)
        spotify_page = context.new_page()

        try:
            for index, artist in enumerate(
                artists,
                start=1,
            ):
                log("")
                log("=" * 70)
                log(
                    f"[ARTISTE {index}/{len(artists)}] "
                    f"{artist['name']}"
                )
                log("=" * 70)

                try:
                    process_artist(
                        spotify_page,
                        artist,
                        tracks,
                        today,
                    )
                except Exception as error:
                    log(
                        f"[ERREUR ARTISTE] "
                        f"{artist['name']} : {error}"
                    )

                if index % 75 == 0:
                    log(
                        "[INFO] Recréation du "
                        "contexte navigateur."
                    )

                    try:
                        spotify_page.close()
                    except Exception:
                        pass

                    try:
                        context.close()
                    except Exception:
                        pass

                    context = create_browser_context(
                        browser,
                    )
                    spotify_page = context.new_page()

                time.sleep(
                    random.uniform(1.5, 4.0)
                )

        finally:
            try:
                spotify_page.close()
            except Exception:
                pass

            try:
                context.close()
            except Exception:
                pass

            browser.close()
            log("[INFO] Navigateur fermé.")

    log("")
    log("=" * 70)
    log(
        f"[FIN] Total de sorties : "
        f"{len(tracks)}"
    )
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
