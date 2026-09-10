import { useEffect, useRef, useState, type CSSProperties } from "react";

const STREAM_URL = "http://78.129.237.51:9687/stream";

function PlayIcon({ isPlaying }: { isPlaying: boolean }) {
  if (isPlaying) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5v13M16 5.5v13" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 5 10 7-10 7V5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10v4h3l4 3V7l-4 3H4Z" />
      {muted ? <path d="m16 9 4 6m0-6-4 6" /> : <path d="M15 9.5a4 4 0 0 1 0 5" />}
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

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="DCI Radio, LaRadioDesHits.com">
      <div className="brand-dci">DCI</div>
      <div className="brand-radio">RADIO</div>
      <div className="brand-domain">LARADIODESHITS.COM</div>
    </div>
  );
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.82);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState("Prêt à écouter");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = volume;
    const handlePlaying = () => {
      setIsPlaying(true);
      setStatus("En direct maintenant");
    };
    const handlePause = () => {
      setIsPlaying(false);
      setStatus("En pause");
    };
    const handleWaiting = () => setStatus("Connexion au direct...");
    const handleError = () => {
      setIsPlaying(false);
      setStatus("Le flux est momentanément indisponible");
    };

    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("error", handleError);
    };
  }, [volume]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    setStatus("Connexion au direct...");
    try {
      await audio.play();
    } catch {
      setStatus("Appuyez pour lancer la radio");
    }
  };

  const updateVolume = (value: number) => {
    const audio = audioRef.current;
    setVolume(value);
    setIsMuted(value === 0);
    if (audio) audio.volume = value;
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMuted) {
      const restoredVolume = volume || 0.82;
      audio.volume = restoredVolume;
      setVolume(restoredVolume);
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  };

  return (
    <div className="radio-page">
      <audio ref={audioRef} src={STREAM_URL} preload="none" />

      <header className="topbar">
        <a className="topbar-logo" href="#top" aria-label="DCI Radio, accueil">
          <span className="topbar-logo-mark">DCI</span>
          <span className="topbar-logo-name">RADIO</span>
        </a>
        <div className="topbar-right">
          <span className="topbar-status"><i /> À l'antenne</span>
          <a className="topbar-link" href="#player">Écouter</a>
        </div>
      </header>

      <main id="top" className="hero">
        <section className="hero-copy" aria-labelledby="hero-title">
          <div className="eyebrow"><span className="eyebrow-line" /> La radio des hits</div>
          <h1 id="hero-title">Seulement les<br /><em>meilleurs hits.</em></h1>
          <p className="hero-description">
            DCI Radio, la bande-son qui ne baisse jamais le volume. Les titres que vous aimez, en direct.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={togglePlayback} type="button">
              <span className="button-icon"><PlayIcon isPlaying={isPlaying} /></span>
              {isPlaying ? "Mettre en pause" : "Écouter en direct"}
            </button>
            <a className="text-link" href="#player">
              Le player <span className="text-link-arrow"><ArrowIcon /></span>
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

      <section className="player-wrap" id="player" aria-label="Lecteur DCI Radio">
        <div className="player-heading">
          <span className="live-indicator"><i /> Live</span>
          <span className="player-heading-text">DCI Radio <b>/</b> LaRadioDesHits.com</span>
        </div>
        <div className="player-controls">
          <button className="play-button" onClick={togglePlayback} type="button" aria-label={isPlaying ? "Mettre en pause" : "Écouter la radio"}>
            <PlayIcon isPlaying={isPlaying} />
          </button>
          <div className="track-info">
            <div className="track-topline">
              <span className="track-title">DCI Radio</span>
              <span className="track-status">{status}</span>
            </div>
            <div className={`equalizer ${isPlaying ? "is-active" : ""}`} aria-hidden="true">
              {Array.from({ length: 30 }, (_, index) => (
                <span key={index} style={{ "--bar-delay": `${index * 0.045}s` } as CSSProperties} />
              ))}
            </div>
          </div>
          <div className="volume-control">
            <button className="volume-button" onClick={toggleMute} type="button" aria-label={isMuted ? "Activer le son" : "Couper le son"}>
              <VolumeIcon muted={isMuted} />
            </button>
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="player-source">Flux live <span>{STREAM_URL}</span></div>
      </section>

      <footer className="footer">
        <span>DCI RADIO</span>
        <span>Seulement les meilleurs hits</span>
        <span>LaRadioDesHits.com</span>
      </footer>
    </div>
  );
}
