import json
import os
import re
import sys
import time
import random
import multiprocessing as mp
from datetime import date, datetime
from pathlib import Path
from queue import Empty
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT_DIR = Path.cwd()
ARTISTS_FILE = ROOT_DIR / "data" / "artistes.json"
RELEASES_FILE = ROOT_DIR / "data" / "sorties.json"
SHARDS_DIR = ROOT_DIR / "data" / "shards"

# --- Sharding (répartition entre jobs GitHub Actions) -------------------
# SHARD_INDEX (0-based) et SHARD_TOTAL définissent quelle tranche des
# artistes CE job traite. Fournis via variables d'environnement par le
# workflow matrix — en local (sans les définir), le script traite tous
# les artistes comme un seul shard (comportement inchangé).
SHARD_INDEX = int(os.environ.get("SHARD_INDEX", "0"))
SHARD_TOTAL = int(os.environ.get("SHARD_TOTAL", "1"))

if SHARD_TOTAL < 1:
    raise ValueError("SHARD_TOTAL doit être >= 1.")

if not (0 <= SHARD_INDEX < SHARD_TOTAL):
    raise ValueError(
        f"SHARD_INDEX ({SHARD_INDEX}) doit être compris entre 0 et "
        f"SHARD_TOTAL - 1 ({SHARD_TOTAL - 1})."
    )

# Chaque shard écrit UNIQUEMENT ses nouvelles trouvailles dans son propre
# fichier (jamais dans data/sorties.json directement) : plusieurs jobs
# matrix tournent sur des runners séparés et ne peuvent pas se
# synchroniser entre eux. Un job de fusion dédié (scripts/merge_shards.py)
# combine ensuite tous les fichiers shard + l'historique existant.
SHARD_OUTPUT_FILE = SHARDS_DIR / f"sorties_shard_{SHARD_INDEX}.json"

SPOTIFY_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 "
    "(KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# --- Réglages de performance -------------------------------------------
# Nombre de PROCESSUS traités en parallèle, chacun avec son propre
# navigateur Playwright.
#
# IMPORTANT : Playwright sync API n'est PAS thread-safe (elle pilote sa
# boucle asyncio interne via des greenlets liés à un seul thread). Un
# ThreadPoolExecutor provoque des erreurs "cannot switch to a different
# thread". Le parallélisme doit donc passer par des PROCESSUS séparés
# (multiprocessing), chacun avec son propre interpréteur et sa propre
# instance Playwright — jamais par des threads.
#
# Chaque worker lance un Chromium complet : reste raisonnable en mémoire
# (2-4 sur un runner CI standard). Monte progressivement en observant les
# WARN/ERREUR dans les logs.
MAX_WORKERS = 3

# Nombre d'artistes traités avant de recréer le contexte navigateur
# À L'INTÉRIEUR d'un même worker (évite l'accumulation mémoire sur de
# longues chaînes de pages consultées par un seul processus).
CONTEXT_RECYCLE_EVERY = 40

# Délai aléatoire (secondes) entre deux artistes traités par un même worker.
MIN_DELAY_PER_WORKER = 1.0
MAX_DELAY_PER_WORKER = 2.5

# Timeout réseau "idle" utilisé à la place des attentes fixes.
NETWORK_IDLE_TIMEOUT_MS = 15000
# -------------------------------------------------------------------------


def log(message: str, worker_id: Optional[int] = None) -> None:
    prefix = f"[W{worker_id}] " if worker_id is not None else ""
    print(f"{prefix}{message}", flush=True)


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
    """N'est appelée QUE depuis le processus principal (voir main()) :
    un seul processus écrit sur disque, donc aucun verrou nécessaire."""
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


def save_shard_output(new_entries: List[Dict[str, Any]]) -> None:
    """Sauvegarde INCRÉMENTALE des nouvelles sorties trouvées par CE
    shard uniquement (pas l'historique complet). Appelée à chaque
    nouvelle trouvaille pour garder la sécurité anti-crash de la version
    précédente, sans jamais toucher à data/sorties.json — ce fichier
    est fusionné a posteriori par scripts/merge_shards.py."""
    SHARDS_DIR.mkdir(parents=True, exist_ok=True)

    with SHARD_OUTPUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(
            {"tracks": new_entries},
            file,
            ensure_ascii=False,
            indent=2,
        )
        file.write("\n")

    log(f"[INFO] Shard sauvegardé : {SHARD_OUTPUT_FILE} ({len(new_entries)} sortie(s))")


def select_shard_artists(
    artists: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Répartition déterministe par tranche (slicing avec un pas de
    SHARD_TOTAL) : chaque artiste appartient à exactement un shard, et
    le découpage ne dépend pas de l'ordre d'exécution des jobs."""
    return artists[SHARD_INDEX::SHARD_TOTAL]


def parse_date(value: str) -> Optional[date]:
    """Parse une date Spotify en français ou en anglais."""
    if not value:
        return None

    value = " ".join(str(value).strip().split())
    value = value.replace("\u00a0", " ")

    import unicodedata

    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(
        char for char in normalized
        if unicodedata.category(char) != "Mn"
    )

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

    months = {
        "january": 1, "jan": 1, "february": 2, "feb": 2,
        "march": 3, "mar": 3, "april": 4, "apr": 4,
        "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
        "august": 8, "aug": 8, "september": 9, "sep": 9,
        "sept": 9, "october": 10, "oct": 10, "november": 11,
        "nov": 11, "december": 12, "dec": 12,
        "janvier": 1, "janv": 1, "fevrier": 2, "fevr": 2,
        "fev": 2, "mars": 3, "avril": 4, "avr": 4, "mai": 5,
        "juin": 6, "juillet": 7, "juil": 7, "aout": 8,
        "septembre": 9, "octobre": 10, "novembre": 11,
        "decembre": 12,
    }

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


def parse_date_from_encore_element(element: Any) -> Optional[date]:
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
                values.extend(str(item) for item in attribute_value)
            else:
                values.append(str(attribute_value))

    for value in values:
        parsed = parse_date(value)

        if parsed:
            return parsed

    return None


def extract_release_date_from_html(
    html: str,
    worker_id: Optional[int] = None,
) -> Optional[date]:
    soup = BeautifulSoup(html, "html.parser")

    encore_elements = soup.select("[data-encore-id]")

    for element in encore_elements:
        encore_id = element.get("data-encore-id", "")
        parsed = parse_date_from_encore_element(element)

        if parsed:
            log(
                "[DATE] Date trouvée dans "
                f"data-encore-id='{encore_id}' : "
                f"{parsed.isoformat()}",
                worker_id,
            )
            return parsed

    for element in soup.find_all(True):
        attributes_text = " ".join(
            f"{key}={value}" for key, value in element.attrs.items()
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
                f"Encore lié aux métadonnées : {parsed.isoformat()}",
                worker_id,
            )
            return parsed

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
                parsed = parse_date(element.get_text(" ", strip=True))

            if parsed:
                log(
                    f"[DATE] Date trouvée avec {selector}: {parsed.isoformat()}",
                    worker_id,
                )
                return parsed

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
            for match in re.finditer(pattern, raw, flags=re.IGNORECASE):
                parsed = parse_date(match.group(1))

                if parsed:
                    log(
                        f"[DATE] Date trouvée dans un script : {parsed.isoformat()}",
                        worker_id,
                    )
                    return parsed

    visible_text = soup.get_text(" ", strip=True)
    parsed = parse_date(visible_text)

    if parsed:
        log(
            f"[DATE] Date trouvée dans le texte global : {parsed.isoformat()}",
            worker_id,
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

    try:
        headings = page.locator("h1")

        if headings.count() > 0:
            title = headings.first.inner_text(timeout=3000).strip()

            if title:
                return " ".join(title.split())
    except Exception:
        pass

    return ""


def save_debug_html(html: str, artist_name: str, worker_id: int) -> Path:
    safe_name = re.sub(r"[^A-Za-z0-9À-ÿ_.-]+", "_", artist_name)
    debug_file = ROOT_DIR / f"spotify_debug_w{worker_id}_{safe_name}.html"
    debug_file.write_text(html, encoding="utf-8")
    return debug_file


def wait_for_page_ready(page, worker_id: int) -> None:
    """Attentes conditionnelles (au lieu de wait_for_timeout fixes) :
    on avance dès que le contenu et le réseau sont prêts."""
    try:
        page.wait_for_selector(
            "main, h1, a[href*='/artist/'], a[href*='/album/']",
            timeout=30000,
        )
    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Élément principal non détecté.", worker_id)

    try:
        page.wait_for_selector("[data-encore-id]", timeout=30000)
    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Aucun élément data-encore-id détecté.", worker_id)

    try:
        page.wait_for_load_state(
            "networkidle",
            timeout=NETWORK_IDLE_TIMEOUT_MS,
        )
    except PlaywrightTimeoutError:
        pass


def get_latest_spotify_project(
    page,
    artist: Dict[str, Any],
    worker_id: int,
) -> Optional[Dict[str, Any]]:
    artist_name = artist["name"]
    discography_url = build_discography_url(artist["url"])

    log(f"[SPOTIFY] Artiste : {artist_name}", worker_id)
    log(f"[SPOTIFY] URL : {discography_url}", worker_id)

    try:
        page.goto(
            discography_url,
            wait_until="domcontentloaded",
            timeout=120000,
        )

        page.wait_for_selector("a[href*='/album/']", timeout=30000)

        try:
            page.wait_for_load_state(
                "networkidle",
                timeout=NETWORK_IDLE_TIMEOUT_MS,
            )
        except PlaywrightTimeoutError:
            pass

    except PlaywrightTimeoutError:
        log("[WARN][SPOTIFY] Timeout de chargement de la discographie.", worker_id)
    except Exception as error:
        log(f"[ERREUR][SPOTIFY] {error}", worker_id)
        return None

    album_links = extract_album_links(page)

    if not album_links:
        log(f"[SPOTIFY] Aucun projet trouvé pour {artist_name}.", worker_id)
        return None

    latest_album_url = album_links[0]
    latest_album_id = get_spotify_id(latest_album_url, "album")

    log(f"[SPOTIFY] Dernière sortie détectée : {latest_album_url}", worker_id)

    try:
        page.goto(
            latest_album_url,
            wait_until="domcontentloaded",
            timeout=120000,
        )

        wait_for_page_ready(page, worker_id)

    except Exception as error:
        log(f"[ERREUR][SPOTIFY] Impossible d'ouvrir la sortie : {error}", worker_id)
        return None

    html = page.content()

    release_date = extract_release_date_from_html(html, worker_id)

    if release_date is None:
        debug_file = save_debug_html(html, artist_name, worker_id)

        try:
            body_text = page.locator("body").inner_text(timeout=5000)
            log(f"[DEBUG] Texte visible de la page : {body_text[:1000]}", worker_id)
        except Exception:
            pass

        log("[SKIP][SPOTIFY] Date introuvable dans les éléments data-encore-id.", worker_id)
        log(f"[DEBUG] HTML sauvegardé dans : {debug_file}", worker_id)

        return None

    title = get_album_title(page, latest_album_url) or artist_name

    return {
        "title": title,
        "artists": [artist_name],
        "album_id": latest_album_id,
        "album_url": latest_album_url,
        "release_type": "unknown",
        "release_date": release_date,
    }


def entry_already_exists(
    tracks: List[Dict[str, Any]],
    entry: Dict[str, Any],
) -> bool:
    album_id = entry.get("id", "")

    for track in tracks:
        if album_id and track.get("id") == album_id:
            return True

        if (
            track.get("artist_id") == entry.get("artist_id")
            and track.get("album_name") == entry.get("album_name")
            and track.get("release_date") == entry.get("release_date")
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
        "artist_name": artist.get("name", "Artiste inconnu"),
        "artist_id": artist.get("id", ""),
        "album_name": project.get("title", ""),
        "release_type": project.get("release_type", "unknown"),
        "release_date": release_date_str,
        "album_image": "",
        "url": project.get("album_url", ""),
    }


def create_browser_context(browser):
    context = browser.new_context(
        locale="fr-FR",
        user_agent=SPOTIFY_USER_AGENT,
        viewport={"width": 1440, "height": 1000},
    )

    context.set_default_timeout(30000)
    context.set_default_navigation_timeout(120000)

    return context


def worker_main(
    worker_id: int,
    artists_chunk: List[Dict[str, Any]],
    today_iso: str,
    result_queue: "mp.Queue",
) -> None:
    """Fonction exécutée dans un PROCESSUS séparé. Chaque worker possède
    son propre interpréteur Python et sa propre instance Playwright —
    c'est ce qui rend le parallélisme possible sans toucher aux
    limitations thread-safety de l'API sync de Playwright.

    Ne touche jamais au disque directement : tout résultat est envoyé
    au processus principal via `result_queue`, qui centralise l'écriture
    de sorties.json.
    """
    today = date.fromisoformat(today_iso)

    log(f"[INFO] Démarrage, {len(artists_chunk)} artiste(s) à traiter.", worker_id)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = create_browser_context(browser)
        page = context.new_page()

        try:
            for index, artist in enumerate(artists_chunk, start=1):
                try:
                    project = get_latest_spotify_project(page, artist, worker_id)

                    if project is None:
                        result_queue.put(("skip", worker_id, artist["name"], "aucun projet éligible"))
                    else:
                        release_date = project["release_date"]

                        if release_date != today:
                            result_queue.put((
                                "skip",
                                worker_id,
                                artist["name"],
                                f"{release_date.isoformat()} != {today.isoformat()}",
                            ))
                        else:
                            entry = build_release_entry(artist, project, release_date)
                            result_queue.put(("release", worker_id, entry))

                except Exception as error:
                    log(f"[ERREUR ARTISTE] {artist['name']} : {error}", worker_id)
                    result_queue.put(("error", worker_id, artist["name"], str(error)))

                if index % CONTEXT_RECYCLE_EVERY == 0 and index != len(artists_chunk):
                    log("[INFO] Recréation du contexte navigateur.", worker_id)

                    try:
                        page.close()
                    except Exception:
                        pass

                    try:
                        context.close()
                    except Exception:
                        pass

                    context = create_browser_context(browser)
                    page = context.new_page()

                time.sleep(random.uniform(MIN_DELAY_PER_WORKER, MAX_DELAY_PER_WORKER))

        finally:
            try:
                page.close()
            except Exception:
                pass

            try:
                context.close()
            except Exception:
                pass

            browser.close()

    result_queue.put(("worker_done", worker_id, None))
    log("[INFO] Terminé.", worker_id)


def split_round_robin(
    items: List[Dict[str, Any]],
    n_buckets: int,
) -> List[List[Dict[str, Any]]]:
    buckets: List[List[Dict[str, Any]]] = [[] for _ in range(n_buckets)]

    for index, item in enumerate(items):
        buckets[index % n_buckets].append(item)

    return buckets


def main() -> None:
    today = date.today()

    log("=" * 70)
    log("[DÉMARRAGE] Mise à jour des sorties (mode multiprocessus)")
    log(f"[DÉMARRAGE] Date du jour : {today.isoformat()}")
    log(f"[DÉMARRAGE] Workers : {MAX_WORKERS}")
    log(f"[DÉMARRAGE] Shard : {SHARD_INDEX + 1}/{SHARD_TOTAL}")
    log("=" * 70)

    all_artists = load_artists()
    artists = select_shard_artists(all_artists)

    log(
        f"[INFO] Artistes dans ce shard : {len(artists)} "
        f"(sur {len(all_artists)} au total)"
    )

    if not artists:
        log("[INFO] Aucun artiste pour ce shard, fin immédiate.")
        return

    # data/sorties.json n'est lu ici que pour la DÉDUPLICATION (éviter de
    # re-signaler une sortie déjà connue) — ce shard n'écrit jamais dedans.
    releases_data = load_releases()
    known_tracks = releases_data["tracks"]

    # Nouvelles sorties trouvées PAR CE SHARD uniquement.
    new_entries: List[Dict[str, Any]] = []

    stats = {"traités": 0, "ajoutés": 0, "ignorés": 0, "erreurs": 0}

    n_workers = min(MAX_WORKERS, len(artists)) or 1
    chunks = split_round_robin(artists, n_workers)

    result_queue: mp.Queue = mp.Queue()

    processes: List[mp.Process] = []

    start_time = time.monotonic()

    for worker_id, chunk in enumerate(chunks, start=1):
        if not chunk:
            continue

        process = mp.Process(
            target=worker_main,
            args=(worker_id, chunk, today.isoformat(), result_queue),
            daemon=True,
        )
        process.start()
        processes.append(process)

    workers_remaining = len(processes)
    progress_counter = 0

    # Boucle de consommation : le processus principal est le SEUL à écrire
    # sur disque, donc aucun verrou n'est nécessaire ici.
    while workers_remaining > 0:
        try:
            message = result_queue.get(timeout=300)
        except Empty:
            log("[WARN] Aucun résultat reçu depuis 5 minutes, vérification des workers...")

            if all(not process.is_alive() for process in processes):
                log("[WARN] Tous les workers sont arrêtés, fin de la boucle.")
                break

            continue

        kind = message[0]

        if kind == "worker_done":
            workers_remaining -= 1
            continue

        if kind == "skip":
            _, worker_id, artist_name, reason = message
            log(f"[INFO] Projet ignoré ({artist_name}) : {reason}", worker_id)
            stats["ignorés"] += 1

        elif kind == "error":
            _, worker_id, artist_name, error_text = message
            stats["erreurs"] += 1

        elif kind == "release":
            _, worker_id, entry = message

            # Dédup contre l'historique connu ET contre ce que ce shard
            # a déjà trouvé lui-même dans ce run.
            if entry_already_exists(known_tracks, entry) or entry_already_exists(new_entries, entry):
                log(
                    f"[INFO] Projet déjà présent : {entry['album_name']}",
                    worker_id,
                )
                stats["ignorés"] += 1
            else:
                new_entries.append(entry)
                save_shard_output(new_entries)
                log(
                    f"[SUCCÈS] Sortie ajoutée : {entry['album_name']} — {entry['artist_name']}",
                    worker_id,
                )
                stats["ajoutés"] += 1

        stats["traités"] += 1
        progress_counter += 1

        if progress_counter % 25 == 0:
            log(f"[PROGRESSION] {progress_counter}/{len(artists)} artistes traités.")

    for process in processes:
        process.join(timeout=30)

        if process.is_alive():
            log(f"[WARN] Le processus {process.pid} ne s'est pas terminé proprement, arrêt forcé.")
            process.terminate()

    elapsed = time.monotonic() - start_time

    log("")
    log("=" * 70)
    log(f"[FIN] Shard {SHARD_INDEX + 1}/{SHARD_TOTAL} — nouvelles sorties : {len(new_entries)}")
    log(
        "[FIN] Traités : "
        f"{stats['traités']} | Ajoutés : {stats['ajoutés']} | "
        f"Ignorés : {stats['ignorés']} | Erreurs : {stats['erreurs']}"
    )
    log(f"[FIN] Durée totale : {elapsed:.1f}s ({elapsed / 60:.1f} min)")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
