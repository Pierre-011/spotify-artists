import json
import re
import sys
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
    Retourne la racine du dépôt.
    Dans GitHub Actions, le repo est cloné dans $GITHUB_WORKSPACE.
    Le script est exécuté depuis la racine du repo (working directory par défaut).
    """
    return Path.cwd()


def flush_print(*args, **kwargs):
    """
    Print avec flush immédiat pour un affichage en temps réel dans les logs.
    """
    print(*args, **kwargs)
    sys.stdout.flush()


def load_artists(path: str = "data/artistes.json") -> List[Dict[str, Any]]:
    base = base_path()
    full_path = base / path

    flush_print(f"[INFO] Working directory : {Path.cwd()}")
    flush_print(f"[INFO] Chemin de base du projet : {base}")
    flush_print(f"[INFO] Chargement des artistes depuis : {full_path}")
    flush_print(f"[INFO] full_path.absolute() = {full_path.absolute()}")

    if not full_path.exists():
        flush_print(f"[ERREUR] Le fichier {full_path} n'existe pas !")
        # Liste les fichiers dans data/ pour déboguer
        data_dir = base / "data"
        if data_dir.exists():
            flush_print(f"[DEBUG] Contenu de data/ :")
            for p in data_dir.iterdir():
                flush_print(f"  - {p.name}")
        else:
            flush_print(f"[DEBUG] Le dossier data/ n'existe pas à la racine.")
        raise FileNotFoundError(f"Le fichier {full_path} n'existe pas")

    with open(full_path, "r", encoding="utf-8") as f:
        raw_text = f.read()

    flush_print("[INFO] Contenu brut de artistes.json (premiers 500 caractères) :")
    flush_print(raw_text[:500])
    flush_print("...")

    try:
        data = json.loads(raw_text)
    except Exception as e:
        flush_print(f"[ERREUR] JSON invalide : {e}")
        raise

    flush_print(f"[INFO] Type de la structure JSON : {type(data)}")

    if isinstance(data, dict):
        flush_print(f"[INFO] JSON est un dict avec {len(data)} clés")
        artists = []
        for key, value in data.items():
            flush_print(f"[DEBUG] Clé artiste : {key} -> type(value)={type(value)}")
            if isinstance(value, dict):
                if "url" in value:
                    artists.append(value)
                    flush_print(f"[DEBUG]   => Ajouté (url trouvée)")
                else:
                    flush_print(f"[DEBUG]   => Ignoré (pas de clé 'url')")
            else:
                flush_print(f"[DEBUG]   => Ignoré (value n'est pas un dict)")

        flush_print(f"[INFO] {len(artists)} artistes trouvés dans artistes.json (cas dict)")
        if artists:
            return artists

    if isinstance(data, list):
        flush_print(f"[INFO] JSON est une liste avec {len(data)} éléments")
        artists = []
        for i, item in enumerate(data):
            flush_print(f"[DEBUG] Élément {i} : type={type(item)}")
            if isinstance(item, dict) and "url" in item:
                artists.append(item)
                flush_print(f"[DEBUG]   => Ajouté (url trouvée)")
            else:
                flush_print(f"[DEBUG]   => Ignoré")

        flush_print(f"[INFO] {len(artists)} artistes trouvés dans artistes.json (cas liste)")
        if artists:
            return artists

    flush_print("[ERREUR] Aucun artiste trouvé dans artistes.json")
    flush_print(f"[DEBUG] Structure complète (dump JSON, 1000 premiers caractères) :")
    flush_print(json.dumps(data, ensure_ascii=False, indent=2)[:1000])

    raise ValueError("Format artistes.json non supporté ou aucun artiste valide trouvé.")


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
    flush_print(f"[SPOTIFY] Récupération de la page : {artist_url}")

    try:
        resp = requests.get(artist_url, headers=SPOTIFY_HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        flush_print(f"[ERREUR] Impossible de récupérer la page Spotify : {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    last_release_section = None

    # Chercher "Dernière sortie"
    for tag in soup.find_all(string=re.compile(r"Dernière\s+sortie", re.I)):
        parent = tag.find_parent()
        if parent:
            last_release_section = parent
            flush_print("[SPOTIFY] Section 'Dernière sortie' trouvée")
            break

    # Fallback : section "Albums" / "Singles"
    if not last_release_section:
        flush_print("[SPOTIFY] Section 'Dernière sortie' non trouvée, tentative fallback Albums/Singles")
        for h2 in soup.find_all("h2"):
            text = h2.get_text(strip=True).lower()
            if "album" in text or "single" in text or "singles" in text:
                last_release_section = h2.find_parent()
                if last_release_section:
                    flush_print("[SPOTIFY] Section Albums/Singles trouvée comme fallback")
                    break

    if not last_release_section:
        flush_print("[SPOTIFY] Aucune section pertinente trouvée, utilisation du body")
        last_release_section = soup.body

    # Titre du projet
    title_tag = last_release_section.find(["a", "h2", "h3", "div"], string=re.compile(r"\S"))
    if not title_tag:
        flush_print("[SPOTIFY] Aucun titre de projet trouvé")
        return None

    title = title_tag.get_text(strip=True)
    if not title:
        flush_print("[SPOTIFY] Titre du projet vide")
        return None

    flush_print(f"[SPOTIFY] Titre du projet : {title}")

    # Artistes du projet
    artists = []
    for a in last_release_section.find_all("a", href=True):
        href = a["href"]
        if "/artist/" in href:
            name = a.get_text(strip=True)
            if name and name not in artists:
                artists.append(name)

    if not artists:
        flush_print("[SPOTIFY] Aucun artiste trouvé sur le projet, utilisation de 'Inconnu'")
        artists = ["Inconnu"]
    else:
        flush_print(f"[SPOTIFY] Artistes du projet : {artists}")

    # URL et ID de l'album
    album_url = ""
    album_id = ""
    for a in last_release_section.find_all("a", href=True):
        href = a["href"]
        if "/album/" in href:
            album_url = href if href.startswith("http") else f"https://open.spotify.com{href}"
            m = re.search(r"/album/([A-Za-z0-9]+)", href)
            if m:
                album_id = m.group(1)
            flush_print(f"[SPOTIFY] Album trouvé : id={album_id}, url={album_url}")
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
    flush_print(f"[SOUNDCHARTS] Recherche : {query}")

    try:
        page.goto("https://soundcharts.com/en/isrc-finder", wait_until="networkidle")
        flush_print("[SOUNDCHARTS] Page ISRC Finder chargée")
    except Exception as e:
        flush_print(f"[ERREUR] Impossible de charger SoundCharts : {e}")
        return None

    # 1. Champ de recherche
    search_input = page.locator(
        "input[placeholder*='ISRC'], input[placeholder*='title'], input[type='text']"
    ).first

    try:
        search_input.wait_for(state="visible", timeout=10000)
        search_input.fill(query)
        flush_print("[SOUNDCHARTS] Champ de recherche rempli")
    except Exception as e:
        flush_print(f"[ERREUR] Impossible de remplir le champ de recherche : {e}")
        return None

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

    try:
        search_button.click()
        flush_print("[SOUNDCHARTS] Bouton de recherche cliqué")
    except Exception as e:
        flush_print(f"[ERREUR] Impossible de cliquer sur le bouton de recherche : {e}")
        return None

    # 3. Attendre que la page se stabilise un peu
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
        flush_print("[SOUNDCHARTS] Résultats chargés")
    except Exception:
        flush_print("[SOUNDCHARTS] Timeout networkidle, on continue avec le contenu actuel")

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
                flush_print(f"[SOUNDCHARTS] Date trouvée : {found_date}")
                break
            except ValueError:
                continue

    if not found_date:
        flush_print("[SOUNDCHARTS] Aucune date trouvée dans les résultats")

    return found_date


def load_sorties(path: str = "data/sorties.json") -> Dict[str, List[Dict[str, Any]]]:
    base = base_path()
    full_path = base / path

    flush_print(f"[INFO] Chargement de sorties.json depuis : {full_path}")
    flush_print(f"[INFO] full_path.absolute() = {full_path.absolute()}")

    if not full_path.exists():
        flush_print("[INFO] sorties.json n'existe pas encore, création d'une structure vide")
        return {"tracks": []}

    with open(full_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict) and "tracks" in data and isinstance(data["tracks"], list):
        flush_print(f"[INFO] {len(data['tracks'])} entrées existantes dans sorties.json")
        return data

    flush_print("[INFO] sorties.json existe mais structure invalide, réinitialisation")
    return {"tracks": []}


def save_sorties(data: Dict[str, List[Dict[str, Any]]], path: str = "data/sorties.json"):
    base = base_path()
    full_path = base / path

    flush_print(f"[INFO] Écriture de sorties.json : {full_path}")
    flush_print(f"[INFO] Nombre total d'entrées après sauvegarde : {len(data['tracks'])}")

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

    flush_print(f"[NOUVELLE SORTIE] Construction entrée :")
    flush_print(f"  - artiste : {artist_name} ({artist_id})")
    flush_print(f"  - album : {album_name} ({album_id})")
    flush_print(f"  - url album : {album_url}")
    flush_print(f"  - date de sortie : {release_date}")

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
    flush_print("=" * 60)
    flush_print(f"[DÉMARRAGE] Script de mise à jour des sorties")
    flush_print(f"[DÉMARRAGE] Date aujourd'hui : {today}")
    flush_print("=" * 60)

    artists_data = load_artists()
    sorties_data = load_sorties()

    flush_print("[INFO] Initialisation de Playwright avec Chromium headless")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            flush_print(f"[INFO] Début du traitement de {len(artists_data)} artistes")

            for i, artist in enumerate(artists_data, start=1):
                name = artist.get("name", "Inconnu")
                url = artist["url"]
                flush_print("\n" + "=" * 60)
                flush_print(f"[ARTISTE {i}/{len(artists_data)}] {name}")
                flush_print(f"[ARTISTE {i}/{len(artists_data)}] URL : {url}")
                flush_print("=" * 60)

                release = get_last_release_from_spotify(url)
                if not release:
                    flush_print(f"[ARTISTE {i}/{len(artists_data)}] Aucune dernière sortie trouvée, skip.")
                    continue

                title = release["title"]
                artists_list = release["artists"]
                flush_print(f"[ARTISTE {i}/{len(artists_data)}] Projet : {title}")
                flush_print(f"[ARTISTE {i}/{len(artists_data)}] Artistes du projet : {artists_list}")

                release_date = get_release_date_from_soundcharts(title, artists_list, page)
                if not release_date:
                    flush_print(f"[ARTISTE {i}/{len(artists_data)}] Aucune date trouvée sur SoundCharts, skip.")
                    continue

                flush_print(f"[ARTISTE {i}/{len(artists_data)}] Date SoundCharts : {release_date}")

                if release_date == today:
                    flush_print(f"[ARTISTE {i}/{len(artists_data)}] SORTIE DU JOUR DÉTECTÉE !")
                    track_entry = build_track_entry(artist, release, release_date)
                    sorties_data["tracks"].append(track_entry)
                    save_sorties(sorties_data)
                    flush_print(f"[ARTISTE {i}/{len(artists_data)}] AJOUTÉ à sorties.json (sortie aujourd'hui).")
                else:
                    flush_print(f"[ARTISTE {i}/{len(artists_data)}] Pas une sortie du jour, ignoré.")

            flush_print("\n" + "=" * 60)
            flush_print("[FIN] Traitement de tous les artistes terminé")
            flush_print("=" * 60)

        finally:
            browser.close()
            flush_print("[FIN] Navigateur Chromium fermé")


if __name__ == "__main__":
    main()
