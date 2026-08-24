import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def base_path() -> Path:
    """
    Retourne le dossier de base du projet.
    Le script est dans scripts/update_releases.py, on remonte de deux niveaux.
    """
    current = Path(__file__).resolve()
    return current.parent.parent  # .../


def load_artists(path: str = "data/artistes.json") -> List[Dict[str, Any]]:
    base = base_path()
    full_path = base / path

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        artists = []
        for key, value in data.items():
            if isinstance(value, dict) and "url" in value:
                artists.append(value)
        return artists

    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict) and "url" in x]

    raise ValueError("Format artistes.json non supporté.")


def get_last_release_from_spotify(artist_url: str) -> Optional[Dict[str, Any]]:
    """
    Scrape la page artiste Spotify et retourne :
    {
        "title": "Titre du projet",
        "artists": ["Artiste 1", "Artiste 2", ...],
        "album_url": "https://open.spotify.com/intl-fr/album/...",
        "album_id": "..."
    }
    ou None si non trouvé.
    """
    resp = requests.get(artist_url, headers=SPOTIFY_HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    last_release_section = None

    # Chercher "Dernière sortie"
    for tag in soup.find_all(string=re.compile(r"Dernière\s+sortie", re.I)):
        parent = tag.find_parent()
        if parent:
            last_release_section = parent
            break

    # Fallback : section "Albums" / "Singles"
    if not last_release_section:
        for h2 in soup.find_all("h2"):
            text = h2.get_text(strip=True).lower()
            if "album" in text or "single" in text or "singles" in text:
                last_release_section = h2.find_parent()
                if last_release_section:
                    break

    if not last_release_section:
        last_release_section = soup.body

    # Titre du projet
    title_tag = last_release_section.find(["a", "h2", "h3", "div"], string=re.compile(r"\S"))
    if not title_tag:
        return None

    title = title_tag.get_text(strip=True)
    if not title:
        return None

    # Artistes du projet
    artists = []
    for a in last_release_section.find_all("a", href=True):
        href = a["href"]
        if "/artist/" in href:
            name = a.get_text(strip=True)
            if name and name not in artists:
                artists.append(name)

    if not artists:
        artists = ["Inconnu"]

    # URL et ID de l’album
    album_url = ""
    album_id = ""
    for a in last_release_section.find_all("a", href=True):
        href = a["href"]
        if "/album/" in href:
            album_url = href if href.startswith("http") else f"https://open.spotify.com{href}"
            m = re.search(r"/album/([A-Za-z0-9]+)", href)
            if m:
                album_id = m.group(1)
            break

    return {
        "title": title,
        "artists": artists,
        "album_url": album_url,
        "album_id": album_id,
    }


def get_release_date_from_soundcharts(
    title: str,
    artists: List[str],
    page,
) -> Optional[str]:
    """
    Ouvre https://soundcharts.com/en/isrc-finder avec Playwright,
    remplit le champ avec 'title + artistes',
    récupère la date de sortie affichée dans les résultats.

    Retourne la date sous forme de string 'YYYY-MM-DD' ou None.
    """
    query = f"{title} {' & '.join(artists)}"

    page.goto("https://soundcharts.com/en/isrc-finder", wait_until="networkidle")

    # 1. Champ de recherche
    # On attend qu’un input correspondant soit visible
    search_input = page.locator(
        "input[placeholder*='ISRC'], input[placeholder*='title'], input[type='text']"
    ).first
    search_input.wait_for(state="visible", timeout=10000)
    search_input.fill(query)

    # 2. Bouton de recherche
    search_button = None
    selectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button.search-button",
        "button[class*='search']",
        "form button",
    ]
    for sel in selectors:
        els = page.locator(sel).all()
        if els:
            search_button = els[0]
            break

    if search_button is None:
        search_button = page.locator("button").first

    search_button.click()

    # 3. Attendre que la page se stabilise un peu
    page.wait_for_load_state("networkidle", timeout=15000)

    page_text = page.content()

    # 4. Chercher une date dans le HTML
    patterns = [
        r"\b(\d{4}-\d{2}-\d{2})\b",  # 2026-08-24
        r"\b(\d{2}/\d{2}/\d{4})\b",  # 24/08/2026
        r"\b(\d{2}-\d{2}-\d{4})\b",  # 24-08-2026
    ]

    found_date = None
    for pat in patterns:
        m = re.search(pat, page_text)
        if m:
            raw = m.group(1)
            try:
                if "-" in raw and len(raw) == 10 and raw.count("-") == 2:
                    parts = raw.split("-")
                    if len(parts[0]) == 4:  # 2026-08-24
                        d = datetime.strptime(raw, "%Y-%m-%d")
                    else:  # 24-08-2026
                        d = datetime.strptime(raw, "%d-%m-%Y")
                elif "/" in raw:
                    d = datetime.strptime(raw, "%d/%m/%Y")
                else:
                    continue
                found_date = d.strftime("%Y-%m-%d")
                break
            except ValueError:
                continue

    return found_date


def load_sorties(path: str = "data/sorties.json") -> Dict[str, List[Dict[str, Any]]]:
    base = base_path()
    full_path = base / path

    if not full_path.exists():
        return {"tracks": []}

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "tracks" in data and isinstance(data["tracks"], list):
        return data

    return {"tracks": []}


def save_sorties(data: Dict[str, List[Dict[str, Any]]], path: str = "data/sorties.json"):
    base = base_path()
    full_path = base / path

    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def build_track_entry(
    artist_info: Dict[str, Any],
    release_info: Dict[str, Any],
    release_date: str,
) -> Dict[str, Any]:
    artist_name = artist_info.get("name", "Inconnu")
    artist_id = artist_info.get("id", "")

    album_name = release_info["title"]
    album_id = release_info.get("album_id", "")
    album_url = release_info.get("album_url", "")

    return {
        "id": album_id,
        "name": f"{album_name}",
        "artist_name": artist_name,
        "artist_id": artist_id,
        "album_name": album_name,
        "release_type": "album",
        "release_date": release_date,
        "album_image": "",
        "url": album_url,
    }


def main():
    today = date.today().strftime("%Y-%m-%d")
    print(f"Date aujourd'hui : {today}")

    artists_data = load_artists()
    sorties_data = load_sorties()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            for artist in artists_data:
                name = artist.get("name", "Inconnu")
                url = artist["url"]
                print(f"\nTraitement artiste : {name} ({url})")

                release = get_last_release_from_spotify(url)
                if not release:
                    print("  -> Aucune dernière sortie trouvée, skip.")
                    continue

                title = release["title"]
                artists_list = release["artists"]
                print(f"  -> Projet: {title}")
                print(f"  -> Artistes: {artists_list}")

                release_date = get_release_date_from_soundcharts(title, artists_list, page)
                if not release_date:
                    print("  -> Aucune date trouvée sur SoundCharts, skip.")
                    continue

                print(f"  -> Date SoundCharts: {release_date}")

                if release_date == today:
                    track_entry = build_track_entry(artist, release, release_date)
                    sorties_data["tracks"].append(track_entry)
                    save_sorties(sorties_data)
                    print("  -> AJOUTÉ à sorties.json (sortie aujourd'hui).")
                else:
                    print("  -> Pas une sortie du jour, ignoré.")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
