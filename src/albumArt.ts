import { useEffect, useState } from "react";

/**
 * Recherche de pochettes d'album via l'API publique iTunes (gratuite, sans clé, CORS ouvert).
 * Le serveur de la radio ne renvoie qu'une image générique : on retrouve donc la vraie
 * pochette à partir de l'artiste et du titre.
 */

const ITUNES_SEARCH = "https://itunes.apple.com/search";
const STORAGE_KEY = "dci-album-art-v1";
const MAX_STORED = 300;
const ART_SIZE = 600;

/** null = recherché mais introuvable */
type CacheValue = string | null;

const memoryCache = new Map<string, CacheValue>();
const pending = new Map<string, Promise<CacheValue>>();

// Restaure le cache des visites précédentes
try {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (raw) {
    const entries = JSON.parse(raw) as [string, CacheValue][];
    entries.forEach(([key, value]) => memoryCache.set(key, value));
  }
} catch {
  /* cache illisible : ignoré */
}

function persist() {
  try {
    const entries = [...memoryCache.entries()].slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* stockage plein ou désactivé : ignoré */
  }
}

/** Retire les mentions de version, de BPM, de featuring, etc. */
export function cleanTitle(title: string) {
  return title
    .replace(/\s*[([][^)\]]*(?:prod|edit|mix|remaster|clean|explicit|version|radio|extended|intro|outro|dirty|instrumental)[^)\]]*[)\]]/gi, "")
    .replace(/\s*[([](?:feat|ft|featuring)\.?[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:feat|ft|featuring)\.?\s.*$/i, "")
    .replace(/\s+\d{2,3}\s*$/, "") // BPM en fin de titre (« … 121 »)
    .replace(/\s*[([]\s*[)\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Artiste principal : avant « feat. », « & », « x », « , »… */
export function mainArtist(artist: string) {
  return artist
    .split(/\s+(?:feat|ft|featuring)\.?\s|\s+&\s|\s+x\s|\s+vs\.?\s|,|\s+et\s/i)[0]
    .trim();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ItunesResult {
  artistName?: string;
  trackName?: string;
  artworkUrl100?: string;
}

async function searchItunes(term: string): Promise<ItunesResult[]> {
  const url = `${ITUNES_SEARCH}?media=music&entity=song&limit=10&term=${encodeURIComponent(term)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`iTunes HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/** Choisit le résultat le plus crédible : l'artiste doit correspondre. */
function pickBest(results: ItunesResult[], artist: string, title: string) {
  const wantedArtist = normalize(mainArtist(artist));
  const wantedTitle = normalize(title);
  let best: { score: number; art: string } | null = null;

  for (const result of results) {
    if (!result.artworkUrl100) continue;
    const resultArtist = normalize(result.artistName ?? "");
    const resultTitle = normalize(cleanTitle(result.trackName ?? ""));

    const artistMatch =
      !!wantedArtist && (resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist));
    if (!artistMatch) continue;

    let score = 1;
    if (resultTitle === wantedTitle) score += 3;
    else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 2;

    if (!best || score > best.score) best = { score, art: result.artworkUrl100 };
  }

  return best ? best.art.replace(/\/\d+x\d+bb\./, `/${ART_SIZE}x${ART_SIZE}bb.`) : null;
}

async function lookup(artist: string, title: string): Promise<CacheValue> {
  const cleanedTitle = cleanTitle(title);
  const primary = mainArtist(artist);
  const attempts = [`${artist} ${cleanedTitle}`, `${primary} ${cleanedTitle}`];

  for (const term of [...new Set(attempts)]) {
    const results = await searchItunes(term);
    const art = pickBest(results, artist, cleanedTitle);
    if (art) return art;
  }
  return null;
}

/** Renvoie l'URL de la pochette (ou null), avec cache mémoire + localStorage. */
export function findAlbumArt(artist: string, title: string): Promise<CacheValue> {
  const key = `${normalize(artist)}|${normalize(title)}`;
  if (memoryCache.has(key)) return Promise.resolve(memoryCache.get(key) ?? null);

  const existing = pending.get(key);
  if (existing) return existing;

  const request = lookup(artist, title)
    .then((art) => {
      memoryCache.set(key, art);
      persist();
      return art;
    })
    .catch(() => null) // erreur réseau : on ne met pas en cache, on réessaiera plus tard
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

/** Hook React : pochette trouvée pour un morceau, ou null pendant la recherche / si introuvable. */
export function useAlbumArt(artist?: string, title?: string) {
  const [art, setArt] = useState<string | null>(null);

  useEffect(() => {
    setArt(null);
    if (!artist || !title) return;
    let cancelled = false;
    findAlbumArt(artist, title).then((found) => {
      if (!cancelled) setArt(found);
    });
    return () => {
      cancelled = true;
    };
  }, [artist, title]);

  return art;
}
