import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlbumArt } from "./albumArt";

const STREAM_URL = "https://a10.asurahosting.com:8650/radio.mp3";
// Fichier texte qui ne contient que l'adresse du flux : utile pour VLC / un lecteur externe,
// mais un navigateur ne sait pas le lire directement dans une balise <audio>.
const PLAYLIST_URL = "https://a10.asurahosting.com/public/dci_radio/playlist.m3u";
const NOWPLAYING_URL = "https://a10.asurahosting.com/api/nowplaying/dci_radio";
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 1;
const NOWPLAYING_REFRESH_MS = 15_000;
const FALLBACK_ART =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'>
       <defs>
         <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
           <stop offset='0' stop-color='%231a2466'/>
           <stop offset='1' stop-color='%235274ff'/>
         </linearGradient>
       </defs>
       <rect width='160' height='160' fill='url(%23g)'/>
       <text x='80' y='96' text-anchor='middle' font-family='Impact, Arial Black, sans-serif'
             font-size='64' fill='white' letter-spacing='-2'>DCI</text>
     </svg>`,
  );

type ShowState = "live" | "upcoming" | "past";
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = dimanche … 6 = samedi

const FRIDAY: Weekday = 5;
const EVERY_DAY_EXCEPT_FRIDAY: Weekday[] = [0, 1, 2, 3, 4, 6];

interface Show {
  start: string;
  end: string;
  title: string;
  host: string;
  description: string;
  tag: string;
  /** Jours de diffusion. Absent = tous les jours. */
  days?: Weekday[];
  /** Petit badge affiché à côté du titre (ex. « Spécial vendredi »). */
  badge?: string;
}

const HITS_NON_STOP: Omit<Show, "start" | "end"> = {
  title: "Hits Non-Stop",
  host: "Programmation DCI",
  description: "Des tubes enchaînés sans interruption. Zéro blabla, 100 % hits.",
  tag: "Musique",
};

const HITS_DE_NUIT: Omit<Show, "start" | "end"> = {
  title: "Hits de Nuit",
  host: "Programmation DCI",
  description: "La musique continue toute la nuit avec les meilleurs hits en continu, jusqu'au réveil.",
  tag: "Nuit",
};

interface ScheduledShow extends Show {
  state: ShowState;
  progress: number;
}

const SCHEDULE: Show[] = [
  {
    start: "06:00",
    end: "09:00",
    title: "Le Réveil des Hits",
    host: "Programmation DCI",
    description:
      "La matinale qui réveille en douceur : les plus gros hits du moment, l'actu en bref, la météo et la bonne humeur pour bien démarrer la journée.",
    tag: "Matinale",
    days: EVERY_DAY_EXCEPT_FRIDAY,
  },
  {
    start: "07:00",
    end: "10:00",
    title: "Les DIRTY TAPES",
    host: "Fred The B - DJ NOIZE DIRTY",
    description:
      "Le vendredi, le Réveil des Hits passe en mode DIRTY TAPES : les meilleurs hits mixés en direct, sans temps mort, pour lancer le week-end du bon pied.",
    tag: "Matinale",
    days: [FRIDAY],
    badge: "Spécial vendredi",
  },
  { start: "09:00", end: "12:00", ...HITS_NON_STOP, days: EVERY_DAY_EXCEPT_FRIDAY },
  { start: "10:00", end: "12:00", ...HITS_NON_STOP, days: [FRIDAY] },
  {
    start: "12:00",
    end: "13:00",
    title: "Le Top Midi",
    host: "Yanick",
    description: "Juste la meilleure musique sur l'heure de lunch.",
    tag: "Classement",
  },
  {
    start: "13:00",
    end: "16:00",
    title: "L'Après-Midi Hits",
    host: "Programmation DCI",
    description: "Les tubes du moment et les nouveautés qui feront les hits de demain, en continu.",
    tag: "Musique",
  },
  {
    start: "16:00",
    end: "19:00",
    title: "Drive Time",
    host: "Programmation DCI",
    description:
      "Le retour à la maison en musique : hits actuels et classiques des années 2000 pour accompagner la route.",
    tag: "Musique",
  },
  {
    start: "19:00",
    end: "20:00",
    title: "Yanick sur DCI Radio",
    host: "Yanick",
    description: "La meilleure musique des vingt dernières années.",
    tag: "Direct",
  },
  {
    start: "20:00",
    end: "00:00",
    title: "Night Hits",
    host: "Programmation DCI",
    description: "Une sélection variée de Hits avec quelques HITS québécois.",
    tag: "Soirée",
  },
  { start: "00:00", end: "06:00", ...HITS_DE_NUIT, days: EVERY_DAY_EXCEPT_FRIDAY },
  { start: "00:00", end: "07:00", ...HITS_DE_NUIT, days: [FRIDAY] },
];

/** Émissions du jour demandé, dans l'ordre de diffusion. */
function getDaySchedule(weekday: Weekday): Show[] {
  return SCHEDULE.filter((show) => !show.days || show.days.includes(weekday));
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function getShowWindow(show: Show, now: number, dayStart: number) {
  let start = toMinutes(show.start);
  let end = show.end === "00:00" ? 24 * 60 : toMinutes(show.end);
  if (end <= start) end += 24 * 60;

  // Les émissions après minuit appartiennent à la fin de la journée radio
  if (start < dayStart && now >= dayStart) {
    start += 24 * 60;
    end += 24 * 60;
  }

  return { start, end };
}

function buildSchedule(now: number, weekday: Weekday): ScheduledShow[] {
  const shows = getDaySchedule(weekday);
  // La journée radio commence avec la première émission de la grille du jour
  const dayStart = shows.length ? toMinutes(shows[0].start) : 0;

  return shows.map((show) => {
    const { start, end } = getShowWindow(show, now, dayStart);
    let state: ShowState = "upcoming";
    if (now >= start && now < end) state = "live";
    else if (now >= end) state = "past";

    const progress = state === "live" ? Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)) : 0;
    return { ...show, state, progress };
  });
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface Song {
  title: string;
  artist: string;
  art: string;
}

interface HistoryEntry extends Song {
  playedAt: number;
}

interface NowPlayingState {
  current: Song | null;
  elapsed: number;
  duration: number;
  next: Song | null;
  history: HistoryEntry[];
  listeners: number | null;
}

function sanitizeSong(input: unknown): Song | null {
  if (!input || typeof input !== "object") return null;
  const song = input as Record<string, unknown>;
  const title = typeof song.title === "string" ? song.title.trim() : "";
  const artist = typeof song.artist === "string" ? song.artist.trim() : "";
  const art = typeof song.art === "string" ? song.art : "";
  if (!title && !artist) return null;
  return { title: title || "Titre inconnu", artist: artist || "Artiste inconnu", art };
}

function isGenericArt(art: string) {
  if (!art) return true;
  return /generic_song|default_album_art/i.test(art);
}

/** Traduit l'erreur du lecteur HTML5 en message compréhensible. */
function describeMediaError(error: MediaError | null) {
  switch (error?.code) {
    case 2: // MEDIA_ERR_NETWORK
      return "La connexion au flux a été interrompue.";
    case 3: // MEDIA_ERR_DECODE
      return "Le flux audio n'a pas pu être décodé.";
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return "Le navigateur n'a pas pu ouvrir le flux (réseau ou sécurité).";
    default:
      return "Impossible de lire le flux pour l'instant.";
  }
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

function formatRelativeTime(playedAt: number, now: number) {
  const diff = Math.max(0, Math.round((now - playedAt * 1000) / 60000));
  if (diff <= 0) return "à l'instant";
  if (diff === 1) return "il y a 1 min";
  if (diff < 60) return `il y a ${diff} min`;
  const hours = Math.floor(diff / 60);
  return hours === 1 ? "il y a 1 h" : `il y a ${hours} h`;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 5 10 7-10 7V5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13M16 5.5v13" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
      {muted ? (
        <path d="m16 9 4 6m0-6-4 6" />
      ) : (
        <>
          <path d="M15 9.5a4 4 0 0 1 0 5" />
          <path d="M17 7a7 7 0 0 1 0 10" />
        </>
      )}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13m-5-5 5 5-5 5" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </svg>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="DCI Radio, LaRadioDesHits.com">
      <div className="brand-dci" data-text="DCI">
        DCI
      </div>
      <div className="brand-radio">RADIO</div>
      <div className="brand-domain">LARADIODESHITS.COM</div>
    </div>
  );
}

interface AlbumArtProps {
  art: string;
  title: string;
  artist?: string;
  spinning?: boolean;
}

function AlbumArt({ art, title, artist, spinning }: AlbumArtProps) {
  const serverArt = art && !isGenericArt(art) ? art : "";
  // Si le serveur n'a qu'une image générique, on cherche la vraie pochette sur iTunes
  const foundArt = useAlbumArt(serverArt ? undefined : artist, serverArt ? undefined : title);
  const candidate = serverArt || foundArt || "";

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const displayedArt = candidate && candidate !== failedSrc ? candidate : FALLBACK_ART;

  return (
    <div className={`album-art ${spinning ? "is-spinning" : ""}`}>
      <img
        key={displayedArt}
        className="album-art-img"
        src={displayedArt}
        alt={`Pochette : ${title}`}
        onError={() => setFailedSrc(candidate)}
      />
      <div className="album-art-vinyl" aria-hidden="true" />
      <div className="album-art-gloss" aria-hidden="true" />
    </div>
  );
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(() => new Date());

  // ---- Lecteur ----
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  // ---- Métadonnées en direct ----
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState>({
    current: null,
    elapsed: 0,
    duration: 0,
    next: null,
    history: [],
    listeners: null,
  });

  // Horloge pour le programme et pour les libellés « il y a X min »
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Récupération des infos « Now Playing » (API AzuraCast)
  useEffect(() => {
    let aborted = false;

    const fetchNowPlaying = async () => {
      try {
        const response = await fetch(NOWPLAYING_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (aborted) return;

        const currentSong = sanitizeSong(data?.now_playing?.song);
        const nextSong = sanitizeSong(data?.playing_next?.song);
        const elapsed = typeof data?.now_playing?.elapsed === "number" ? data.now_playing.elapsed : 0;
        const duration = typeof data?.now_playing?.duration === "number" ? data.now_playing.duration : 0;
        const listeners =
          typeof data?.listeners?.current === "number" ? data.listeners.current : null;

        const historyRaw = Array.isArray(data?.song_history) ? data.song_history : [];
        const history: HistoryEntry[] = historyRaw
          .slice(0, 6)
          .map((entry: Record<string, unknown>) => {
            const song = sanitizeSong(entry?.song);
            const playedAt =
              typeof entry?.played_at === "number" ? entry.played_at : Math.floor(Date.now() / 1000);
            return song ? { ...song, playedAt } : null;
          })
          .filter((item: HistoryEntry | null): item is HistoryEntry => item !== null);

        setNowPlaying({ current: currentSong, elapsed, duration, next: nextSong, history, listeners });
      } catch (error) {
        if (!aborted) console.warn("Nowplaying indisponible :", error);
      }
    };

    fetchNowPlaying();
    const timer = window.setInterval(fetchNowPlaying, NOWPLAYING_REFRESH_MS);
    return () => {
      aborted = true;
      window.clearInterval(timer);
    };
  }, []);

  // Progression locale de la piste entre deux rafraîchissements de l'API
  useEffect(() => {
    if (!nowPlaying.duration) return;
    const timer = window.setInterval(() => {
      setNowPlaying((state) => {
        if (!state.duration) return state;
        if (state.elapsed >= state.duration) return state;
        return { ...state, elapsed: state.elapsed + 1 };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [nowPlaying.duration]);

  // Synchronisation du volume HTML5
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // ---- Logique de lecture du direct ----
  // `wantPlayRef` = l'utilisateur veut écouter (sert à ignorer les événements parasites
  // quand on coupe volontairement la connexion).
  const wantPlayRef = useRef(false);
  const retryRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /** Coupe la connexion : un direct ne doit jamais rester « en pause » avec un vieux tampon. */
  const detachStream = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const failPlayback = useCallback(
    (message: string) => {
      wantPlayRef.current = false;
      clearWatchdog();
      detachStream();
      setIsPlaying(false);
      setIsBuffering(false);
      setPlayError(message);
    },
    [clearWatchdog, detachStream],
  );

  /** Ouvre (ou rouvre) la connexion et lance la lecture. */
  const connect = useCallback(
    (cacheBust: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = cacheBust ? `${STREAM_URL}?t=${Date.now()}` : STREAM_URL;
      audio.load();
      const attempt = audio.play();
      if (attempt) {
        attempt.catch((error: unknown) => {
          const name = error instanceof DOMException ? error.name : "";
          // AbortError : interrompu par une pause / un rechargement volontaire
          if (name === "AbortError") return;
          if (name === "NotAllowedError") {
            failPlayback("Lecture bloquée par le navigateur. Cliquez sur Lecture.");
          }
          // Les autres cas arrivent par l'événement « error » de la balise audio
        });
      }
    },
    [failPlayback],
  );

  const startStream = useCallback(() => {
    wantPlayRef.current = true;
    retryRef.current = 0;
    setPlayError(null);
    setIsBuffering(true);
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      failPlayback("Le flux met trop de temps à répondre.");
    }, CONNECT_TIMEOUT_MS);
    // Appel synchrone dans le clic : indispensable pour que Safari / iOS autorisent le son
    connect(false);
  }, [clearWatchdog, connect, failPlayback]);

  const stopStream = useCallback(() => {
    wantPlayRef.current = false;
    clearWatchdog();
    detachStream();
    setIsPlaying(false);
    setIsBuffering(false);
  }, [clearWatchdog, detachStream]);

  // Événements du lecteur HTML5
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlaying = () => {
      clearWatchdog();
      retryRef.current = 0;
      setIsPlaying(true);
      setIsBuffering(false);
      setPlayError(null);
    };
    const handlePause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
      // Pause externe (touches média, casque débranché…) : on coupe aussi la connexion
      if (wantPlayRef.current && audio.readyState >= 2) {
        wantPlayRef.current = false;
        clearWatchdog();
        detachStream();
      }
    };
    const handleWaiting = () => {
      if (wantPlayRef.current) setIsBuffering(true);
    };
    // Erreur réseau ou fin inattendue du direct : une reconnexion automatique, sinon message clair
    const handleFailure = () => {
      if (!wantPlayRef.current || !audio.getAttribute("src")) return;
      if (retryRef.current < MAX_RETRIES) {
        retryRef.current += 1;
        setIsPlaying(false);
        setIsBuffering(true);
        connect(true);
        return;
      }
      failPlayback(describeMediaError(audio.error));
    };

    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("error", handleFailure);
    audio.addEventListener("ended", handleFailure);
    return () => {
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("error", handleFailure);
      audio.removeEventListener("ended", handleFailure);
      clearWatchdog();
    };
  }, [clearWatchdog, connect, detachStream, failPlayback]);

  // Un clic pendant « Connexion… » annule ; sinon on (re)démarre une connexion toute fraîche
  const togglePlayback = useCallback(() => {
    if (isPlaying || isBuffering) stopStream();
    else startStream();
  }, [isPlaying, isBuffering, startStream, stopStream]);

  // Titre / artiste / pochette sur l'écran de verrouillage et dans les contrôles du système
  const mediaTitle = nowPlaying.current?.title;
  const mediaArtist = nowPlaying.current?.artist;
  const lookedUpArt = useAlbumArt(mediaArtist, mediaTitle);
  const serverMediaArt = nowPlaying.current?.art;
  const mediaArt = serverMediaArt && !isGenericArt(serverMediaArt) ? serverMediaArt : lookedUpArt;
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") {
      return;
    }
    const hasArt = !!mediaArt;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: mediaTitle ?? "DCI Radio",
      artist: mediaArtist ?? "Seulement les meilleurs hits",
      album: "DCI Radio – LaRadioDesHits.com",
      artwork: hasArt ? [{ src: mediaArt as string, sizes: "512x512" }] : [],
    });
  }, [mediaTitle, mediaArtist, mediaArt]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler("play", startStream);
    session.setActionHandler("pause", stopStream);
    session.setActionHandler("stop", stopStream);
    return () => {
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
      session.setActionHandler("stop", null);
    };
  }, [startStream, stopStream]);

  const toggleMute = useCallback(() => {
    setIsMuted((previous) => !previous);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const weekday = now.getDay() as Weekday;
  const schedule = useMemo(() => buildSchedule(nowMinutes, weekday), [nowMinutes, weekday]);
  const liveShow = schedule.find((show) => show.state === "live");
  const nextShow = schedule.find((show) => show.state === "upcoming");

  const dateLabel = capitalize(
    new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(now),
  );
  const timeLabel = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(now);

  const scrollToPlayer = () => {
    document.getElementById("player")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const progressPercent = nowPlaying.duration
    ? Math.min(100, (nowPlaying.elapsed / nowPlaying.duration) * 100)
    : 0;

  const currentTitle = nowPlaying.current?.title ?? "Chargement en cours";
  const currentArtist = nowPlaying.current?.artist ?? "DCI Radio";
  const currentArt = nowPlaying.current?.art ?? "";

  const playerStatus = playError
    ? playError
    : isBuffering
      ? "Connexion au direct…"
      : isPlaying
        ? "En direct maintenant"
        : "Prêt à écouter";

  return (
    <div className="radio-page">
      <audio ref={audioRef} preload="none" />

      <header className="topbar">
        <a className="topbar-logo" href="#top" aria-label="DCI Radio, accueil">
          <span className="topbar-logo-mark">DCI</span>
          <span className="topbar-logo-name">RADIO</span>
        </a>
        <div className="topbar-right">
          <span className="topbar-status">
            <i /> À l'antenne
          </span>
          <a className="topbar-link topbar-link-muted" href="#programme">
            Programme
          </a>
          <button className="topbar-link" onClick={scrollToPlayer} type="button">
            Écouter
          </button>
        </div>
      </header>

      <main id="top" className="hero">
        <section className="hero-copy" aria-labelledby="hero-title">
          <div className="eyebrow">
            <span className="eyebrow-line" /> La radio des hits
          </div>
          <h1 id="hero-title">
            Seulement les
            <br />
            <em>meilleurs hits.</em>
          </h1>
          <p className="hero-description">
            DCI Radio c'est la radio des meilleurs HITS au Québec, les chansons que vous aimez, en DIRECT.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={togglePlayback} type="button">
              <span className="button-icon">{isPlaying ? <PauseIcon /> : <PlayIcon />}</span>
              {isPlaying ? "Mettre en pause" : isBuffering ? "Connexion…" : "Écouter en direct"}
            </button>
            <a className="text-link" href="#programme">
              Les émissions du jour{" "}
              <span className="text-link-arrow">
                <ArrowIcon />
              </span>
            </a>
          </div>
        </section>

        <section className="brand-stage" aria-label="Identité DCI Radio">
          <div className="stage-orbit stage-orbit-one" />
          <div className="stage-orbit stage-orbit-two" />
          <div className="stage-grid" />
          <div className="stage-spark spark-one" />
          <div className="stage-spark spark-two" />
          <BrandMark />
          <div className="stage-footer">
            <span className="stage-footer-line" />
            <span>Le son qui vous ressemble</span>
            <span className="stage-footer-line" />
          </div>
        </section>
      </main>

      <section className="player-card" id="player" aria-label="Lecteur DCI Radio">
        <div className="player-main">
          <AlbumArt art={currentArt} title={currentTitle} artist={nowPlaying.current?.artist} spinning={isPlaying} />

          <div className="player-info">
            <div className="player-meta">
              <span className="live-indicator">
                <i /> {isPlaying ? "En direct" : "Live"}
              </span>
              <span className="player-station">DCI Radio</span>
              {nowPlaying.listeners !== null && (
                <span className="player-listeners">{nowPlaying.listeners} à l'écoute</span>
              )}
            </div>

            <p className="player-track-title" title={currentTitle}>
              {currentTitle}
            </p>
            <p className="player-track-artist" title={currentArtist}>
              {currentArtist}
            </p>

            <div className="player-progress" aria-hidden={!nowPlaying.duration}>
              <div className="player-progress-bar">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="player-progress-times">
                <span>{formatTime(nowPlaying.elapsed)}</span>
                <span>{nowPlaying.duration ? formatTime(nowPlaying.duration) : "LIVE"}</span>
              </div>
            </div>

            <div className="player-controls">
              <button
                className={`player-play ${isBuffering ? "is-buffering" : ""}`}
                onClick={togglePlayback}
                type="button"
                aria-label={isPlaying ? "Mettre en pause" : isBuffering ? "Annuler la connexion" : "Lancer la lecture"}
              >
                {isBuffering ? (
                  <span className="player-spinner" aria-hidden="true" />
                ) : isPlaying ? (
                  <PauseIcon />
                ) : (
                  <PlayIcon />
                )}
              </button>

              <div className="player-status">
                <span className="player-status-label">{playerStatus}</span>
                {liveShow && (
                  <span className="player-status-show">
                    En émission : <strong>{liveShow.title}</strong>
                  </span>
                )}
              </div>

              <div className="player-volume">
                <button
                  className="volume-button"
                  onClick={toggleMute}
                  type="button"
                  aria-label={isMuted ? "Activer le son" : "Couper le son"}
                >
                  <VolumeIcon muted={isMuted || volume === 0} />
                </button>
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    if (value > 0 && isMuted) setIsMuted(false);
                  }}
                />
              </div>
            </div>

            <p className={`player-fallback ${playError ? "is-error" : ""}`}>
              <span>{playError ? "Le son ne démarre pas ?" : "Un souci de lecture ?"}</span>
              {playError && (
                <button type="button" className="player-fallback-retry" onClick={startStream}>
                  Réessayer
                </button>
              )}
              <a href={STREAM_URL} target="_blank" rel="noopener noreferrer">
                Ouvrir le flux
              </a>
              <a href={PLAYLIST_URL}>Playlist .m3u (VLC…)</a>
            </p>
          </div>
        </div>

        <aside className="player-side">
          {nowPlaying.next && (
            <div className="player-next">
              <span className="player-side-title">À suivre</span>
              <div className="player-next-row">
                <AlbumArt art={nowPlaying.next.art} title={nowPlaying.next.title} artist={nowPlaying.next.artist} />
                <div className="player-next-text">
                  <p className="player-next-track">{nowPlaying.next.title}</p>
                  <p className="player-next-artist">{nowPlaying.next.artist}</p>
                </div>
              </div>
            </div>
          )}

          {nowPlaying.history.length > 0 && (
            <div className="player-history">
              <span className="player-side-title">Déjà joué</span>
              <ul>
                {nowPlaying.history.slice(0, 4).map((entry) => (
                  <li key={`${entry.playedAt}-${entry.title}`}>
                    <AlbumArt art={entry.art} title={entry.title} artist={entry.artist} />
                    <div className="player-history-text">
                      <p className="player-history-track">{entry.title}</p>
                      <p className="player-history-artist">{entry.artist}</p>
                    </div>
                    <span className="player-history-time">{formatRelativeTime(entry.playedAt, now.getTime())}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </section>

      <section className="schedule" id="programme" aria-labelledby="schedule-title">
        <div className="schedule-header">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> Programme
            </div>
            <h2 id="schedule-title">
              Les émissions <em>de la journée</em>
            </h2>
          </div>
          <div className="schedule-date">
            <span className="schedule-day">{dateLabel}</span>
            <span className="schedule-clock">Il est {timeLabel}</span>
          </div>
        </div>

        <ol className="schedule-list">
          {schedule.map((show) => (
            <li key={`${show.start}-${show.title}`} className={`show show-${show.state}`}>
              <div className="show-time">
                <span>{show.start}</span>
                <span className="show-time-sep" />
                <span>{show.end}</span>
              </div>

              <div className="show-body">
                <div className="show-topline">
                  <h3>{show.title}</h3>
                  {show.state === "live" && (
                    <span className="show-badge show-badge-live">
                      <i /> En ce moment
                    </span>
                  )}
                  {show === nextShow && <span className="show-badge">À suivre</span>}
                  {show.badge && <span className="show-badge show-badge-day">{show.badge}</span>}
                  <span className="show-tag">{show.tag}</span>
                </div>
                <p className="show-host">
                  <MicIcon /> {show.host}
                </p>
                <p className="show-description">{show.description}</p>
                {show.state === "live" && (
                  <div className="show-progress" aria-hidden="true">
                    <span style={{ width: `${show.progress}%` }} />
                  </div>
                )}
              </div>

              <div className="show-action-cell">
                {show.state === "live" && (
                  <button className="show-action" onClick={scrollToPlayer} type="button">
                    <PlayIcon /> Écouter
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <div className="footer-row">
          <span>DCI RADIO</span>
          <span>Seulement les meilleurs hits</span>
          <span>LaRadioDesHits.com</span>
        </div>
        <p className="footer-copyright">
          © {now.getFullYear()} DCI Radio – LaRadioDesHits.com. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
