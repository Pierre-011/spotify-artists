import json
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote


# ============================================================
# CONFIGURATION
# ============================================================

ARTISTS_FILE = Path("data/artistes.json")
RELEASES_FILE = Path("data/sorties.json")

SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/{}"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/139.0 Safari/537.36"
)


# ============================================================
# DATE
# ============================================================

def today():
    return datetime.now().strftime("%Y-%m-%d")


# ============================================================
# CHARGEMENT JSON
# ============================================================

def load_json(path, default):
    if not path.exists():
        return default

    try:
        text = path.read_text(encoding="utf-8").strip()

        if not text:
            return default

        return json.loads(text)

    except Exception as error:
        print(f"Erreur JSON {path}: {error}")
        return default


# ============================================================
# ARTISTES
# ============================================================

def parse_artists(data):
    if not data:
        return []

    if isinstance(data, dict):

        artists = data.get("artists")

        if isinstance(artists, dict):
            return list(artists.values())

        if isinstance(artists, list):
            return artists

    if isinstance(data, list):
        return data

    return []


# ============================================================
# SORTIES EXISTANTES
# ============================================================

def parse_releases(data):
    if not data:
        return []

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

    if isinstance(data, list):
        return data

    return []


# ============================================================
# TELECHARGEMENT PAGE SPOTIFY
# ============================================================

def fetch_spotify_artist(artist_id):

    url = SPOTIFY_ARTIST_URL.format(artist_id)

    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
        }
    )

    try:

        with urlopen(
            request,
            timeout=30
        ) as response:

            return response.read().decode(
                "utf-8",
                errors="ignore"
            )

    except Exception as error:

        print(
            f"Erreur Spotify {artist_id}: {error}"
        )

        return ""


# ============================================================
# EXTRACTION JSON SPOTIFY
# ============================================================

def extract_json(html):

    results = []

    patterns = [

        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',

        r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>'

    ]

    for pattern in patterns:

        matches = re.findall(
            pattern,
            html,
            re.DOTALL | re.IGNORECASE
        )

        for match in matches:

            try:

                results.append(
                    json.loads(match)
                )

            except Exception:
                pass

    return results


# ============================================================
# EXTRACTION DES SORTIES
# ============================================================

def find_release_objects(obj, found=None):

    if found is None:
        found = []

    if isinstance(obj, dict):

        # Objet Spotify de type album
        if obj.get("type") == "ALBUM":

            if obj.get("name"):
                found.append(obj)

        # Certains objets utilisent album_type
        elif (
            obj.get("album_type")
            and obj.get("name")
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
# NORMALISATION SORTIE
# ============================================================

def normalize_release(
    release,
    artist
):

    name = release.get("name")

    if not name:
        return None

    release_id = release.get("id")

    release_date = (
        release.get("release_date")
        or release.get("releaseDate")
        or ""
    )

    album_type = (
        release.get("album_type")
        or release.get("type")
        or "single"
    )

    images = release.get("images")

    image = ""

    if isinstance(images, list) and images:

        first = images[0]

        if isinstance(first, dict):
            image = first.get("url", "")

    spotify_url = ""

    external_urls = release.get(
        "external_urls",
        {}
    )

    if isinstance(external_urls, dict):

        spotify_url = external_urls.get(
            "spotify",
            ""
        )

    if not spotify_url and release_id:

        spotify_url = (
            "https://open.spotify.com/album/"
            + release_id
        )

    return {

        "id": release_id,

        "name": name,

        "artist_name":
            artist.get(
                "name",
                "Artiste inconnu"
            ),

        "artist_id":
            artist.get(
                "id",
                ""
            ),

        "album_name":
            name,

        "release_type":
            album_type,

        "release_date":
            release_date,

        "album_image":
            image,

        "url":
            spotify_url

    }


# ============================================================
# RECHERCHE D'UN ARTISTE
# ============================================================

def get_artist_releases(artist):

    artist_id = artist.get("id")

    if not artist_id:
        return []

    print(
        f"Recherche : "
        f"{artist.get('name', artist_id)}"
    )

    html = fetch_spotify_artist(
        artist_id
    )

    if not html:
        return []

    documents = extract_json(
        html
    )

    releases = []

    for document in documents:

        objects = find_release_objects(
            document
        )

        for release in objects:

            normalized = normalize_release(
                release,
                artist
            )

            if normalized:
                releases.append(
                    normalized
                )

    return releases


# ============================================================
# DEDOUBLONNAGE
# ============================================================

def release_key(release):

    if release.get("id"):
        return "id:" + str(
            release["id"]
        )

    return (
        str(
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
        ).lower()
        + "|"
        + str(
            release.get(
                "release_date",
                ""
            )
        )
    )


# ============================================================
# SAUVEGARDE
# ============================================================

def save_releases(releases):

    RELEASES_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    data = {
        "tracks": releases
    }

    RELEASES_FILE.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )


# ============================================================
# PROGRAMME PRINCIPAL
# ============================================================

def main():

    print(
        "======================================"
    )

    print(
        " MISE A JOUR DES SORTIES SPOTIFY"
    )

    print(
        " Date :",
        today()
    )

    print(
        "======================================"
    )

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

    existing_data = load_json(
        RELEASES_FILE,
        {"tracks": []}
    )

    existing = parse_releases(
        existing_data
    )

    # Dictionnaire pour éviter les doublons
    releases_by_key = {}

    for release in existing:

        key = release_key(
            release
        )

        releases_by_key[key] = release

    print(
        f"{len(artists)} artistes trouvés."
    )

    print(
        f"{len(existing)} sorties déjà enregistrées."
    )

    # Recherche
    for index, artist in enumerate(
        artists,
        start=1
    ):

        print(
            f"\n[{index}/{len(artists)}]"
        )

        releases = get_artist_releases(
            artist
        )

        print(
            f"{len(releases)} sortie(s) trouvée(s)"
        )

        for release in releases:

            key = release_key(
                release
            )

            releases_by_key[key] = release

        # Petite pause
        time.sleep(1)

    # Conversion
    all_releases = list(
        releases_by_key.values()
    )

    # Tri date décroissante
    all_releases.sort(
        key=lambda release:
            release.get(
                "release_date",
                ""
            ),
        reverse=True
    )

    save_releases(
        all_releases
    )

    print(
        "\n======================================"
    )

    print(
        f"{len(all_releases)} sorties enregistrées."
    )

    print(
        "Fichier : data/sorties.json"
    )

    print(
        "======================================"
    )


if __name__ == "__main__":
    main()