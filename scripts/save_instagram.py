#!/usr/bin/env python3

import json
import os
from datetime import datetime, timezone
from pathlib import Path

path = Path("data/artistes.json")

artist_id = (os.environ.get("ARTIST_ID") or "").strip()
status = (os.environ.get("INSTAGRAM_STATUS") or "").strip()
instagram_url = (os.environ.get("INSTAGRAM_URL") or "").strip() or None
instagram_username = (
    os.environ.get("INSTAGRAM_USERNAME") or ""
).strip() or None

if not artist_id:
    raise SystemExit("Identifiant Spotify manquant.")

if status not in {"found", "not_found"}:
    raise SystemExit("Statut Instagram invalide.")

if status == "found":
    if not instagram_url or not instagram_username:
        raise SystemExit("URL ou nom de compte Instagram manquant.")

    if not instagram_url.startswith("https://www.instagram.com/"):
        raise SystemExit("URL Instagram invalide.")
else:
    instagram_url = None
    instagram_username = None

with path.open("r", encoding="utf-8") as file:
    data = json.load(file)

if isinstance(data, dict) and isinstance(data.get("artists"), dict):
    artists = data["artists"].values()
elif isinstance(data, dict) and isinstance(data.get("artists"), list):
    artists = data["artists"]
elif isinstance(data, list):
    artists = data
else:
    raise SystemExit("Structure de data/artistes.json inconnue.")

target = None

for artist in artists:
    if not isinstance(artist, dict):
        continue

    uri = str(artist.get("uri") or "")
    current_id = str(
        artist.get("id")
        or (uri.split(":")[-1] if uri else "")
    )

    if current_id == artist_id:
        target = artist
        break

if target is None:
    raise SystemExit(f"Artiste introuvable : {artist_id}")

target["instagram_url"] = instagram_url
target["instagram_username"] = instagram_username
target["instagram_status"] = status
target["instagram_updated_at"] = datetime.now(
    timezone.utc
).isoformat(timespec="seconds")

with path.open("w", encoding="utf-8", newline="\n") as file:
    json.dump(data, file, ensure_ascii=False, indent=2)
    file.write("\n")

print(f"Profil Instagram mis à jour : {target.get('name', artist_id)}")
