import json
import sys
from pathlib import Path
from typing import Any, Dict, List


ROOT_DIR = Path.cwd()
RELEASES_FILE = ROOT_DIR / "data" / "sorties.json"
SHARDS_DIR = ROOT_DIR / "data" / "shards"


def log(message: str) -> None:
    print(message, flush=True)


def load_releases() -> Dict[str, Any]:
    if not RELEASES_FILE.exists():
        log("[INFO] sorties.json absent, création à partir de zéro.")
        return {"tracks": []}

    with RELEASES_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict) or not isinstance(data.get("tracks"), list):
        log("[WARN] sorties.json invalide, réinitialisation.")
        return {"tracks": []}

    return data


def entry_already_exists(
    tracks: List[Dict[str, Any]],
    entry: Dict[str, Any],
) -> bool:
    """Même logique de déduplication que dans update_releases.py :
    par id d'album, ou par (artiste + titre + date) en secours."""
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


def load_shard_files() -> List[Path]:
    if not SHARDS_DIR.exists():
        log(f"[WARN] Dossier des shards introuvable : {SHARDS_DIR}")
        return []

    shard_files = sorted(SHARDS_DIR.glob("sorties_shard_*.json"))
    log(f"[INFO] {len(shard_files)} fichier(s) de shard trouvé(s).")

    return shard_files


def main() -> None:
    log("=" * 70)
    log("[DÉMARRAGE] Fusion des shards")
    log("=" * 70)

    releases_data = load_releases()
    tracks = releases_data["tracks"]

    log(f"[INFO] {len(tracks)} sortie(s) déjà enregistrée(s) dans sorties.json.")

    shard_files = load_shard_files()

    added_total = 0
    skipped_total = 0

    for shard_file in shard_files:
        try:
            with shard_file.open("r", encoding="utf-8") as file:
                shard_data = json.load(file)
        except (json.JSONDecodeError, OSError) as error:
            log(f"[ERREUR] Lecture impossible de {shard_file} : {error}")
            continue

        shard_tracks = shard_data.get("tracks", [])

        log(f"[INFO] {shard_file.name} : {len(shard_tracks)} sortie(s) candidate(s).")

        for entry in shard_tracks:
            if entry_already_exists(tracks, entry):
                log(f"[SKIP] Déjà présent : {entry.get('album_name', '?')}")
                skipped_total += 1
                continue

            tracks.append(entry)
            added_total += 1
            log(
                "[AJOUT] "
                f"{entry.get('album_name', '?')} — {entry.get('artist_name', '?')}"
            )

    RELEASES_FILE.parent.mkdir(parents=True, exist_ok=True)

    with RELEASES_FILE.open("w", encoding="utf-8") as file:
        json.dump({"tracks": tracks}, file, ensure_ascii=False, indent=2)
        file.write("\n")

    log("")
    log("=" * 70)
    log(f"[FIN] Sorties ajoutées : {added_total} | Doublons ignorés : {skipped_total}")
    log(f"[FIN] Total dans sorties.json : {len(tracks)}")
    log("=" * 70)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"[ERREUR FATALE] {error}")
        sys.exit(1)
