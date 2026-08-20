import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote
from html import unescape


# ============================================================
# CONFIGURATION
# ============================================================

ARTISTS_FILE = Path("data/artistes.json")
RELEASES_FILE = Path("data/sorties.json")

SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/{}"
SPOTIFY_SEARCH_URL = "https://open.spotify.com/search/{}"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/139.0 Safari/537.36"
)

REQUEST_TIMEOUT = 30

# On regarde plusieurs jours en arrière afin de ne pas rater
# une sortie apparue avec quelques heures/jours de retard.
DAYS_TO_SCAN = 7


# ============================================================
# DATE
# ============================================================

def today():
    return datetime.now().strftime("%Y-%m-%d")


def date_days_ago(days):
    return (
        datetime.now() - timedelta(days=days)
    ).strftime("%Y-%m-%d")


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
            f"[ERREUR JSON] {path}: {error}"
        )

        return default


# ============================================================
# ARTISTES
# ============================================================

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
            return list(
                artists.values()
            )

    return []


# ============================================================
# SORTIES
# ============================================================

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


# ============================================================
# HTTP
# ============================================================

def fetch_url(url):

    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
            ),
            "Accept-Language": (
                "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
            ),
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
    )

    try:

        with urlopen(
            request,
            timeout=REQUEST_TIMEOUT
        ) as response:

            return response.read().decode(
                "utf-8",
                errors="ignore"
            )

    except Exception as error:

        print(
            f"[HTTP] Impossible de récupérer "
            f"{url}: {error}"
        )

        return ""


# ============================================================
# EXTRACTION DES BLOCS JSON
# ============================================================

def extract_script_json(html):

    documents = []

    patterns = [

        # JSON-LD
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>'
        r'(.*?)'
        r'</script>',

        # NEXT DATA
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>'
        r'(.*?)'
        r'</script>',

        # Données Spotify parfois présentes dans des scripts
        r'<script[^>]*>(.*?)</script>',

    ]

    for pattern in patterns:

        matches = re.findall(
            pattern,
            html,
            re.DOTALL | re.IGNORECASE
        )

        for match in matches:

            text = unescape(match).strip()

            if not text:
                continue

            # Évite de tenter de parser des scripts JS
            # complètement inutiles.
            if not (
                "release_date" in text
                or "album_type" in text
                or '"type":"ALBUM"' in text
                or '"type": "ALBUM"' in text
                or '"album_type"' in text
            ):
                continue

            try:

                documents.append(
                    json.loads(text)
                )

            except Exception:
                pass

    return documents


# ============================================================
# EXTRACTION D'OBJETS SPOTIFY
# ============================================================

def find_release_objects(obj, found=None):

    if found is None:
        found = []

    if isinstance(obj, dict):

        obj_type = str(
            obj.get("type", "")
        ).upper()

        album_type = str(
            obj.get("album_type", "")
        ).lower()

        # Cas standard
        if (
            obj.get("name")
            and (
                obj_type == "ALBUM"
                or album_type in (
                    "album",
                    "single",
                    "compilation",
                    "ep"
                )
            )
        ):

            found.append(obj)

        for value in obj.values():

            find_release_objects(
                value,
                found
            )

    elif isinstance(obj, list):

        for value in obj:

            find_release_objects(
                value,
                found
            )

    return found


# ============================================================
# EXTRACTION DIRECTE DES OBJETS JSON DANS LE HTML
# ============================================================

def extract_release_candidates_from_html(html):

    candidates = []

    # Recherche de structures ressemblant aux objets Spotify.
    #
    # On ne dépend pas d'un seul nom de variable ou d'une
    # structure React précise.

    patterns = [

        r'\{[^{}]{0,5000}"release_date"\s*:\s*"'
        r'(\d{4}(?:-\d{2}(?:-\d{2})?)?)"[^{}]{0,5000}\}',

        r'\{[^{}]{0,5000}"releaseDate"\s*:\s*"'
        r'(\d{4}(?:-\d{2}(?:-\d{2})?)?)"[^{}]{0,5000}\}',

    ]

    for pattern in patterns:

        for match in re.finditer(
            pattern,
            html,
            re.DOTALL
        ):

            fragment = match.group(0)

            name_match = re.search(
                r'"name"\s*:\s*"([^"]+)"',
                fragment
            )

            id_match = re.search(
                r'"id"\s*:\s*"([A-Za-z0-9]+)"',
                fragment
            )

            date_match = re.search(
                r'"(?:release_date|releaseDate)"\s*:\s*"'
                r'([^"]+)"',
                fragment
            )

            if not name_match:
                continue

            candidate = {
                "name": name_match.group(1),
                "id": (
                    id_match.group(1)
                    if id_match
                    else ""
                ),
                "release_date": (
                    date_match.group(1)
                    if date_match
                    else ""
                ),
            }

            candidates.append(
                candidate
            )

    return candidates


# ============================================================
# NORMALISATION
# ============================================================

def normalize_release(
    release,
    artist
):

    if not isinstance(release, dict):
        return None

    name = release.get("name")

    if not name:
        return None

    release_id = (
        release.get("id")
        or release.get("uri", "").split(":")[-1]
    )

    release_date = (
        release.get("release_date")
        or release.get("releaseDate")
        or ""
    )

    album_type = (
        release.get("album_type")
        or release.get("albumType")
        or release.get("type")
        or "single"
    )

    album_type = str(
        album_type
    ).lower()

    if album_type == "album":
        release_type = "album"

    elif album_type in (
        "ep",
        "compilation"
    ):
        release_type = album_type

    else:
        release_type = "single"

    image = ""

    images = release.get("images")

    if isinstance(images, list):

        for item in images:

            if isinstance(item, dict):

                image = item.get(
                    "url",
                    ""
                )

                if image:
                    break

    # Autres structures possibles
    if not image:

        image = (
            release.get("image_url")
            or release.get("image")
            or ""
        )

    spotify_url = ""

    external_urls = release.get(
        "external_urls"
    )

    if isinstance(
        external_urls,
        dict
    ):

        spotify_url = external_urls.get(
            "spotify",
            ""
        )

    if not spotify_url and release_id:

        spotify_url = (
            "https://open.spotify.com/album/"
            + str(release_id)
        )

    return {

        "id": str(
            release_id
        ) if release_id else "",

        "name": str(name),

        "artist_name": artist.get(
            "name",
            "Artiste inconnu"
        ),

        "artist_id": artist.get(
            "id",
            ""
        ),

        "album_name": str(name),

        "release_type": release_type,

        "release_date": str(
            release_date
        ),

        "album_image": image,

        "url": spotify_url
    }


# ============================================================
# FILTRE DATE
# ============================================================

def is_recent_release(release):

    release_date = str(
        release.get(
            "release_date",
            ""
        )
    )

    if not release_date:
        return False

    minimum_date = date_days_ago(
        DAYS_TO_SCAN
    )

    return release_date >= minimum_date


# ============================================================
# DEDOUBLONNAGE
# ============================================================

def release_key(release):

    release_id = release.get("id")

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
# RECHERCHE SUR PAGE ARTISTE
# ============================================================

def get_artist_releases_from_artist_page(
    artist
):

    artist_id = artist.get("id")

    if not artist_id:
        return []

    url = SPOTIFY_ARTIST_URL.format(
        artist_id
    )

    print(
        f"    Source 1 : page artiste"
    )

    html = fetch_url(url)

    if not html:
        return []

    documents = extract_script_json(
        html
    )

    releases = []

    for document in documents:

        objects = find_release_objects(
            document
        )

        for obj in objects:

            normalized = normalize_release(
                obj,
                artist
            )

            if normalized:
                releases.append(
                    normalized
                )

    # Deuxième méthode d'extraction
    # directement dans le HTML
    raw_candidates = (
        extract_release_candidates_from_html(
            html
        )
    )

    for candidate in raw_candidates:

        normalized = normalize_release(
            candidate,
            artist
        )

        if normalized:
            releases.append(
                normalized
            )

    return deduplicate_releases(
        releases
    )


# ============================================================
# RECHERCHE SPOTIFY PUBLIQUE
# ============================================================

def get_artist_releases_from_search(
    artist
):

    artist_name = artist.get("name")

    if not artist_name:
        return []

    query = quote(
        f"{artist_name}"
    )

    url = SPOTIFY_SEARCH_URL.format(
        query
    )

    print(
        f"    Source 2 : recherche publique"
    )

    html = fetch_url(url)

    if not html:
        return []

    documents = extract_script_json(
        html
    )

    releases = []

    for document in documents:

        objects = find_release_objects(
            document
        )

        for obj in objects:

            normalized = normalize_release(
                obj,
                artist
            )

            if normalized:
                releases.append(
                    normalized
                )

    return deduplicate_releases(
        releases
    )


# ============================================================
# DEDOUBLONNAGE LOCAL
# ============================================================

def deduplicate_releases(
    releases
):

    result = {}
    
    for release in releases:

        key = release_key(
            release
        )

        # On ignore les objets sans date
        # lorsqu'il s'agit d'un candidat
        # manifestement incomplet.
        if not release.get(
            "release_date"
        ):
            continue

        result[key] = release

    return list(
        result.values()
    )


# ============================================================
# RECHERCHE ARTISTE
# ============================================================

def get_artist_releases(
    artist
):

    artist_name = artist.get(
        "name",
        artist.get("id", "inconnu")
    )

    print(
        f"\nRecherche : {artist_name}"
    )

    releases = []

    # --------------------------------------------------------
    # SOURCE 1
    # --------------------------------------------------------

    try:

        releases.extend(
            get_artist_releases_from_artist_page(
                artist
            )
        )

    except Exception as error:

        print(
            f"    Erreur source 1 : {error}"
        )

    # --------------------------------------------------------
    # SOURCE 2
    # --------------------------------------------------------

    # Si la première méthode ne trouve rien,
    # on tente la recherche publique.
    if not releases:

        try:

            releases.extend(
                get_artist_releases_from_search(
                    artist
                )
            )

        except Exception as error:

            print(
                f"    Erreur source 2 : {error}"
            )

    releases = deduplicate_releases(
        releases
    )

    recent = [
        release
        for release in releases
        if is_recent_release(release)
    ]

    print(
        f"    {len(recent)} sortie(s) récente(s)"
    )

    for release in recent:

        print(
            "    -> "
            f"{release['release_date']} | "
            f"{release['release_type']} | "
            f"{release['name']}"
        )

    return recent


# ============================================================
# SAUVEGARDE SÉCURISÉE
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
# PROGRAMME PRINCIPAL
# ============================================================

def main():

    print(
        "=========================================="
    )

    print(
        " MISE À JOUR DES SORTIES SPOTIFY"
    )

    print(
        f" Date : {today()}"
    )

    print(
        f" Fenêtre de recherche : {DAYS_TO_SCAN} jours"
    )

    print(
        "=========================================="
    )

    # --------------------------------------------------------
    # ARTISTES
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # SORTIES EXISTANTES
    # --------------------------------------------------------

    existing_data = load_json(
        RELEASES_FILE,
        {"tracks": []}
    )

    existing = parse_releases(
        existing_data
    )

    print(
        f"{len(artists)} artistes trouvés."
    )

    print(
        f"{len(existing)} sorties déjà enregistrées."
    )

    # --------------------------------------------------------
    # DICTIONNAIRE
    # --------------------------------------------------------

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

    # --------------------------------------------------------
    # RECHERCHE
    # --------------------------------------------------------

    successful_artists = 0
    failed_artists = 0
    new_releases = 0

    for index, artist in enumerate(
        artists,
        start=1
    ):

        print(
            f"\n[{index}/{len(artists)}]"
        )

        artist_releases = []

        try:

            artist_releases = (
                get_artist_releases(
                    artist
                )
            )

        except Exception as error:

            print(
                f"    ERREUR : {error}"
            )

            failed_artists += 1

            # Très important :
            # on conserve les anciennes données.
            continue

        successful_artists += 1

        for release in artist_releases:

            key = release_key(
                release
            )

            if key not in releases_by_key:

                new_releases += 1

                print(
                    "    NOUVELLE SORTIE : "
                    f"{release['name']}"
                )

            else:

                # Mise à jour des informations
                # éventuellement manquantes.
                old = releases_by_key[key]

                for field in (
                    "album_image",
                    "url",
                    "release_date",
                    "release_type",
                    "album_name"
                ):

                    if (
                        not old.get(field)
                        and release.get(field)
                    ):

                        old[field] = release[field]

            releases_by_key[key] = release

        # Pause entre les artistes
        time.sleep(1)

    # --------------------------------------------------------
    # SÉCURITÉ
    # --------------------------------------------------------

    if successful_artists == 0:

        print(
            "\nAucun artiste n'a pu être récupéré."
        )

        print(
            "Le fichier existant est conservé."
        )

        return

    # --------------------------------------------------------
    # TRI
    # --------------------------------------------------------

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
            ).lower()
        ),
        reverse=True
    )

    # --------------------------------------------------------
    # SAUVEGARDE
    # --------------------------------------------------------

    save_releases(
        all_releases
    )

    # --------------------------------------------------------
    # RAPPORT
    # --------------------------------------------------------

    print(
        "\n=========================================="
    )

    print(
        f"Sorties totales : {len(all_releases)}"
    )

    print(
        f"Nouvelles sorties : {new_releases}"
    )

    print(
        f"Artistes OK : {successful_artists}"
    )

    print(
        f"Artistes en erreur : {failed_artists}"
    )

    print(
        f"Fichier : {RELEASES_FILE}"
    )

    print(
        "=========================================="
    )


# ============================================================
# EXECUTION
# ============================================================

if __name__ == "__main__":
    main()
