'use client';

import { Midi } from '@tonejs/midi';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as Tone from 'tone';

import {
  deleteTrack,
  hashFile,
  loadSettings,
  loadTracks,
  saveSettings,
  saveTracks,
  type StoredTrack,
} from './library';
import { createSessionAnchor } from './session-anchor';

export type PlaylistItem = StoredTrack;

export type PlayMode = 'repeat-all' | 'repeat-one' | 'sequential' | 'shuffle';

export const PLAY_MODES: PlayMode[] = [
  'sequential',
  'repeat-all',
  'repeat-one',
  'shuffle',
];

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  'repeat-all': 'Repeat all',
  'repeat-one': 'Repeat one',
  sequential: 'Play in order',
  shuffle: 'Shuffle',
};

export type PlaybackState = 'paused' | 'playing' | 'stopped';

export interface ImportProgress {
  done: number;
  total: number;
}

// Pure hue at full saturation, components in 0..1.
const hueToRgb = (hue: number) => {
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
};

// Widest colour space the browser can render, detected once on the client:
// HDR (HLG, signal 1.0 = peak brightness) → Display P3 → sRGB.
let colorSpace: 'display-p3' | 'rec2100-hlg' | 'srgb' | undefined;
const detectColorSpace = () => {
  if (colorSpace) return colorSpace;
  const supports = (value: string) =>
    typeof CSS !== 'undefined' && CSS.supports('color', value);
  colorSpace = supports('color(rec2100-hlg 1 0 0)')
    ? 'rec2100-hlg'
    : supports('color(display-p3 1 0 0)')
      ? 'display-p3'
      : 'srgb';
  return colorSpace;
};

export const trackColor = (trackIndex: number) => {
  const hue = (trackIndex * 30) % 360;
  const space = detectColorSpace();
  if (space === 'srgb') return `hsl(${hue}, 100%, 50%)`;
  const [r, g, b] = hueToRgb(hue);
  return `color(${space} ${r} ${g} ${b})`;
};

const midiToHz = (midiNumber: number) => 440 * 2 ** ((midiNumber - 69) / 12);

// ~60 FPS
const FRAME_INTERVAL_MS = 15;
const POSITION_INTERVAL_MS = 250;
// Pressing "previous" after this many seconds restarts the current track.
const RESTART_THRESHOLD_S = 3;
// Let the last notes ring out before advancing.
const END_TAIL_S = 0.5;
const SEEK_STEP_S = 10;

interface KeyEvent {
  end: number;
  midiNumber: number;
  start: number;
  trackIndex: number;
}

interface Controls {
  next: () => void;
  pause: () => void;
  play: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  stop: () => void;
}

const hasMediaSession = () =>
  typeof navigator !== 'undefined' && 'mediaSession' in navigator;

const displayName = (fileName: string) => fileName.replace(/\.midi?$/i, '');

export function useMidiPlayer() {
  const synthRef = useRef<null | Tone.PolySynth>(null);
  const anchorRef = useRef<null | ReturnType<typeof createSessionAnchor>>(
    null,
  );
  const muteRefs = useRef<boolean[]>([]);
  const soloRefs = useRef<boolean[]>([]);
  const keyElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const litUntilRef = useRef<Map<HTMLDivElement, number>>(new Map());
  const eventsRef = useRef<KeyEvent[]>([]);
  const cursorRef = useRef(0);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const positionTimerRef = useRef(0);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  // The transport position at audio-context time `anchorTimeRef` while
  // playing. Reading the transport itself lags behind seeks/starts by its
  // lookAhead, which desynchronised the visualisation; this doesn't.
  const anchorPositionRef = useRef(0);
  const anchorTimeRef = useRef(0);
  const playModeRef = useRef<PlayMode>('sequential');
  // Tracks visited in shuffle mode, so "previous" can walk back.
  const historyRef = useRef<number[]>([]);
  const playlistRef = useRef<PlaylistItem[]>([]);
  const currentIndexRef = useRef(-1);
  // Id of the track whose notes are currently scheduled on the transport.
  const loadedIdRef = useRef<null | string>(null);
  const playbackStateRef = useRef<PlaybackState>('stopped');
  const controlsRef = useRef<Controls | null>(null);

  const [ready, setReady] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndexState] = useState(-1);
  const [playbackState, setPlaybackStateState] =
    useState<PlaybackState>('stopped');
  const [playMode, setPlayModeState] = useState<PlayMode>('sequential');
  const [position, setPositionState] = useState(0);
  const [duration, setDurationState] = useState(0);
  const [muteStates, setMuteStates] = useState<boolean[]>([]);
  const [soloStates, setSoloStates] = useState<boolean[]>([]);
  const [importing, setImporting] = useState<ImportProgress | null>(null);

  const setCurrentIndex = (index: number) => {
    currentIndexRef.current = index;
    setCurrentIndexState(index);
  };

  const setPlaybackState = (state: PlaybackState) => {
    playbackStateRef.current = state;
    setPlaybackStateState(state);
    if (hasMediaSession()) {
      navigator.mediaSession.playbackState =
        state === 'stopped' ? 'none' : state;
    }
  };

  const setPosition = (seconds: number) => {
    positionRef.current = seconds;
    setPositionState(seconds);
  };

  const setDuration = (seconds: number) => {
    durationRef.current = seconds;
    setDurationState(seconds);
  };

  const setPlayMode = (mode: PlayMode) => {
    playModeRef.current = mode;
    setPlayModeState(mode);
  };

  const currentTrackName = (trackIndex: number) =>
    playlistRef.current[currentIndexRef.current]?.trackNames[trackIndex] ||
    `Track ${trackIndex + 1}`;

  // A random index other than the current one (when there is a choice).
  const pickShuffleIndex = () => {
    const length = playlistRef.current.length;
    if (length <= 1) return 0;
    const current = currentIndexRef.current;
    const offset = 1 + Math.floor(Math.random() * (length - 1));
    return (current + offset) % length;
  };

  const resetTrackStates = (trackCount: number) => {
    muteRefs.current = Array.from({ length: trackCount }, () => false);
    soloRefs.current = Array.from({ length: trackCount }, () => false);
    setMuteStates(muteRefs.current);
    setSoloStates(soloRefs.current);
  };

  const clampPosition = (seconds: number) =>
    Math.max(0, Math.min(seconds, durationRef.current));

  // Transport position at the given audio-context time while playing.
  const positionAt = (contextTime: number) =>
    anchorPositionRef.current + (contextTime - anchorTimeRef.current);

  const setAnchor = (seconds: number) => {
    anchorPositionRef.current = seconds;
    anchorTimeRef.current = Tone.now();
  };

  const syncPositionState = () => {
    if (!hasMediaSession()) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: durationRef.current,
        playbackRate: 1,
        position: clampPosition(positionRef.current),
      });
    } catch {
      // Some browsers reject position states they consider invalid.
    }
  };

  const shouldPlay = (trackIndex: number) => {
    const hasSolo = soloRefs.current.some(Boolean);
    if (hasSolo && !soloRefs.current[trackIndex]) return false;
    return !muteRefs.current[trackIndex];
  };

  const clearLitKeys = () => {
    litUntilRef.current.forEach((_, element) => {
      element.style.backgroundColor = '';
    });
    litUntilRef.current.clear();
  };

  const stopFrameLoop = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  const stopPositionTimer = () => {
    window.clearInterval(positionTimerRef.current);
    positionTimerRef.current = 0;
  };

  const startPositionTimer = () => {
    stopPositionTimer();
    positionTimerRef.current = window.setInterval(() => {
      setPosition(clampPosition(positionAt(Tone.immediate())));
    }, POSITION_INTERVAL_MS);
  };

  const frame = (timestamp: number) => {
    rafRef.current = requestAnimationFrame(frame);
    if (timestamp - lastFrameRef.current < FRAME_INTERVAL_MS) return;
    lastFrameRef.current = timestamp;

    const now = positionAt(Tone.immediate());
    const events = eventsRef.current;
    const litUntil = litUntilRef.current;

    // Iterate with a local index: the React Compiler mishandles `ref.current++`
    // used as an array index.
    let cursor = cursorRef.current;
    while (cursor < events.length && events[cursor].start <= now) {
      const event = events[cursor];
      cursor += 1;
      if (event.end <= now || !shouldPlay(event.trackIndex)) continue;
      const element = keyElementsRef.current.get(
        `${event.trackIndex}-${event.midiNumber}`,
      );
      if (!element) continue;
      if (!litUntil.has(element)) {
        element.style.backgroundColor = trackColor(event.trackIndex);
      }
      litUntil.set(element, Math.max(litUntil.get(element) ?? 0, event.end));
    }
    cursorRef.current = cursor;

    litUntil.forEach((end, element) => {
      if (end <= now) {
        element.style.backgroundColor = '';
        litUntil.delete(element);
      }
    });
  };

  const startFrameLoop = () => {
    stopFrameLoop();
    lastFrameRef.current = 0;
    rafRef.current = requestAnimationFrame(frame);
  };

  // Reset the visualisation so the next frame re-derives lit keys from `now`.
  const resetVisuals = () => {
    clearLitKeys();
    cursorRef.current = 0;
  };

  // `keepAnchor` leaves the session-anchor audio playing across a track
  // switch, so the resume doesn't depend on a fresh user gesture.
  const halt = ({ keepAnchor = false } = {}) => {
    Tone.getTransport().stop();
    if (!keepAnchor) anchorRef.current?.audio.pause();
    synthRef.current?.releaseAll();
    stopFrameLoop();
    stopPositionTimer();
    resetVisuals();
    setPosition(0);
    setPlaybackState('stopped');
    syncPositionState();
  };

  const stop = () => halt();

  const seek = (seconds: number) => {
    const target = clampPosition(seconds);
    if (playbackStateRef.current === 'playing') {
      Tone.getTransport().seconds = target;
      setAnchor(target);
    }
    synthRef.current?.releaseAll();
    resetVisuals();
    setPosition(target);
    syncPositionState();
  };

  const seekBy = (seconds: number) => seek(positionRef.current + seconds);

  const handleTrackEnd = () => {
    if (playModeRef.current === 'repeat-one') seek(0);
    else advance({ automatic: true });
  };

  // Make `index` the current track without touching the audio graph; notes are
  // scheduled lazily by `play`, so restoring from storage needs no user gesture.
  const selectTrack = (index: number) => {
    const item = playlistRef.current[index];
    halt({ keepAnchor: Boolean(item) });
    if (!item) {
      Tone.getTransport().cancel();
      synthRef.current?.dispose();
      synthRef.current = null;
      loadedIdRef.current = null;
      eventsRef.current = [];
      resetTrackStates(0);
      setDuration(0);
      setCurrentIndex(-1);
      return;
    }
    resetTrackStates(item.trackNames.length);
    setDuration(item.duration);
    setCurrentIndex(index);
    syncPositionState();
  };

  const loadTrack = (index: number) => {
    selectTrack(index);
    const item = playlistRef.current[index];
    if (!item) return;

    const transport = Tone.getTransport();
    transport.cancel();
    synthRef.current?.dispose();
    const synth = new Tone.PolySynth({ maxPolyphony: 128 }).toDestination();
    synthRef.current = synth;

    const midi = new Midi(item.data);
    const events: KeyEvent[] = [];
    midi.tracks.forEach((track, trackIndex) => {
      track.notes.forEach((note) => {
        const hz = midiToHz(note.midi);
        transport.schedule((time) => {
          if (!shouldPlay(trackIndex)) return;
          synth.triggerAttackRelease(hz, note.duration, time, note.velocity);
        }, note.time);

        const visibleDuration = Math.max(
          note.duration * 0.8,
          note.duration - 0.1,
        );
        events.push({
          end: note.time + visibleDuration,
          midiNumber: note.midi,
          start: note.time,
          trackIndex,
        });
      });
    });
    events.sort((a, b) => a.start - b.start);
    eventsRef.current = events;
    cursorRef.current = 0;

    // `schedule` (not `scheduleOnce`) so the callback survives seeking back to
    // 0 in single-track loop mode. Defer the work out of the transport tick.
    transport.schedule(() => {
      window.setTimeout(handleTrackEnd, 0);
    }, midi.duration + END_TAIL_S);

    loadedIdRef.current = item.id;
  };

  const play = async () => {
    if (playbackStateRef.current === 'playing') return;
    if (currentIndexRef.current < 0) {
      if (playlistRef.current.length === 0) return;
      selectTrack(0);
    }
    const item = playlistRef.current[currentIndexRef.current];
    if (loadedIdRef.current !== item.id) loadTrack(currentIndexRef.current);

    // iOS only honours resume()/play() issued synchronously inside the user
    // gesture, so kick both off before the first await.
    anchorRef.current ??= createSessionAnchor();
    const contextStarted = Tone.start();
    const anchorStarted = anchorRef.current.audio.play();
    try {
      await Promise.all([contextStarted, anchorStarted]);
    } catch {
      toast.error(
        'Playback was blocked by the browser, please press play again.',
      );
      return;
    }

    const startPosition = positionRef.current;
    Tone.getTransport().start(undefined, startPosition);
    setAnchor(startPosition);
    setPlaybackState('playing');
    startFrameLoop();
    startPositionTimer();
    syncPositionState();
  };

  const pause = () => {
    if (playbackStateRef.current !== 'playing') return;
    Tone.getTransport().pause();
    anchorRef.current?.audio.pause();
    synthRef.current?.releaseAll();
    stopFrameLoop();
    stopPositionTimer();
    setPosition(clampPosition(positionAt(Tone.now())));
    setPlaybackState('paused');
    syncPositionState();
  };

  const toggle = () => {
    if (playbackStateRef.current === 'playing') pause();
    else void play();
  };

  const playIndex = (index: number) => {
    const current = currentIndexRef.current;
    if (current >= 0 && current !== index) historyRef.current.push(current);
    loadTrack(index);
    void play();
  };

  // Move to the following track according to the play mode. `automatic` is
  // set when a track ended by itself (as opposed to the user pressing next).
  const advance = ({ automatic = false } = {}) => {
    const length = playlistRef.current.length;
    if (length === 0) return;
    const mode = playModeRef.current;
    const nextIndex = currentIndexRef.current + 1;

    if (mode === 'shuffle') {
      playIndex(pickShuffleIndex());
    } else if (nextIndex < length) {
      playIndex(nextIndex);
    } else if (mode === 'repeat-all' || (mode === 'repeat-one' && !automatic)) {
      playIndex(0);
    } else {
      stop();
      toast.info('Reached the end of the playlist.');
    }
  };

  const next = () => advance();

  const previous = () => {
    const length = playlistRef.current.length;
    if (length === 0) return;
    if (positionRef.current > RESTART_THRESHOLD_S) {
      seek(0);
      return;
    }
    const mode = playModeRef.current;
    if (mode === 'shuffle') {
      const last = historyRef.current.pop();
      if (last !== undefined && last < length) {
        loadTrack(last);
        void play();
      } else {
        playIndex(pickShuffleIndex());
      }
      return;
    }
    const prevIndex = currentIndexRef.current - 1;
    if (prevIndex >= 0) playIndex(prevIndex);
    else if (mode === 'sequential') seek(0);
    else playIndex(length - 1);
  };

  const cyclePlayMode = () => {
    const index = PLAY_MODES.indexOf(playModeRef.current);
    const mode = PLAY_MODES[(index + 1) % PLAY_MODES.length];
    setPlayMode(mode);
    if (mode === 'shuffle') historyRef.current = [];
    toast.info(PLAY_MODE_LABELS[mode]);
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setImporting({ done: 0, total: files.length });

    const known = new Set(playlistRef.current.map((item) => item.id));
    const added: PlaylistItem[] = [];
    const base = Date.now();
    let duplicates = 0;
    let invalid = 0;
    let failed = 0;
    let firstFailure: null | string = null;

    // One file at a time so the UI keeps up and progress is visible.
    for (const [i, file] of files.entries()) {
      let data: ArrayBuffer;
      let id: string;
      try {
        data = await file.arrayBuffer();
        id = await hashFile(data);
      } catch (error) {
        // Reading/hashing failed: a browser or environment problem, not a bad
        // file. Surface the reason instead of blaming the file.
        failed += 1;
        firstFailure ??= error instanceof Error ? error.message : String(error);
        setImporting({ done: i + 1, total: files.length });
        continue;
      }

      if (known.has(id)) {
        duplicates += 1;
      } else {
        try {
          const midi = new Midi(data);
          known.add(id);
          added.push({
            addedAt: base + added.length,
            data,
            duration: midi.duration,
            id,
            name: displayName(file.name),
            trackNames: midi.tracks.map((track) => track.name),
          });
        } catch {
          invalid += 1;
        }
      }
      setImporting({ done: i + 1, total: files.length });
    }

    if (failed > 0) {
      toast.error(
        `Could not read ${failed} file${failed === 1 ? '' : 's'}: ${firstFailure}`,
      );
    }

    playlistRef.current = [...playlistRef.current, ...added];
    setPlaylist(playlistRef.current);
    setImporting(null);
    // Select the first track when nothing was selected, but don't auto-play:
    // the import finishes outside the user gesture, so autoplay policies
    // (Safari especially) would block it anyway.
    if (currentIndexRef.current < 0 && added.length > 0) selectTrack(0);

    const problems = [
      duplicates && `${duplicates} duplicate${duplicates === 1 ? '' : 's'}`,
      invalid && `${invalid} invalid file${invalid === 1 ? '' : 's'}`,
    ].filter(Boolean);
    const skipped = problems.length ? ` (skipped ${problems.join(', ')})` : '';
    if (added.length === 0) {
      toast.warning(`Nothing added${skipped}.`);
    } else if (added.length === 1) {
      toast.success(`Added "${added[0].name}"${skipped}.`);
    } else {
      toast.success(`Added ${added.length} tracks${skipped}.`);
    }

    try {
      await saveTracks(added);
    } catch {
      toast.error(
        'Could not save to the library, tracks will be lost on reload.',
      );
    }
  };

  const removeItem = (id: string) => {
    const list = playlistRef.current;
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) return;

    const nextList = list.filter((item) => item.id !== id);
    playlistRef.current = nextList;
    setPlaylist(nextList);
    historyRef.current = [];
    toast.info(`Removed "${list[index].name}".`);
    void deleteTrack(id).catch(() => {
      toast.error('Could not remove the track from the library.');
    });

    const current = currentIndexRef.current;
    if (index === current) {
      const wasPlaying = playbackStateRef.current === 'playing';
      selectTrack(Math.min(index, nextList.length - 1));
      if (wasPlaying && nextList.length > 0) void play();
    } else if (index < current) {
      setCurrentIndex(current - 1);
    }
  };

  const toggleMute = (index: number) => {
    const muted = !muteRefs.current[index];
    muteRefs.current[index] = muted;
    setMuteStates([...muteRefs.current]);
    toast.info(`${muted ? 'Muted' : 'Unmuted'} "${currentTrackName(index)}".`);
  };

  const toggleSolo = (index: number) => {
    const solo = !soloRefs.current[index];
    soloRefs.current[index] = solo;
    setSoloStates([...soloRefs.current]);
    toast.info(
      solo
        ? `Soloing "${currentTrackName(index)}".`
        : `Solo off for "${currentTrackName(index)}".`,
    );
  };

  const registerKey = (keyId: string, element: HTMLDivElement) => {
    keyElementsRef.current.set(keyId, element);
    return () => {
      keyElementsRef.current.delete(keyId);
    };
  };

  useEffect(() => {
    controlsRef.current = { next, pause, play, previous, seek, seekBy, stop };
  });

  const currentItem = playlist[currentIndex];

  // Restore the library and the last selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tracks = await loadTracks();
        if (cancelled) return;
        const settings = loadSettings();
        playlistRef.current = tracks;
        setPlaylist(tracks);
        const mode = PLAY_MODES.includes(settings.playMode)
          ? settings.playMode
          : 'sequential';
        playModeRef.current = mode;
        setPlayModeState(mode);
        if (tracks.length > 0) {
          toast.info(
            `Restored ${tracks.length} track${tracks.length === 1 ? '' : 's'} from your library.`,
          );
        }

        const savedIndex = tracks.findIndex(
          (track) => track.id === settings.currentId,
        );
        const index = savedIndex >= 0 ? savedIndex : tracks.length > 0 ? 0 : -1;
        const item = tracks[index];
        if (item) {
          const trackCount = item.trackNames.length;
          muteRefs.current = Array.from({ length: trackCount }, () => false);
          soloRefs.current = Array.from({ length: trackCount }, () => false);
          setMuteStates(muteRefs.current);
          setSoloStates(soloRefs.current);
          durationRef.current = item.duration;
          setDurationState(item.duration);
          currentIndexRef.current = index;
          setCurrentIndexState(index);
        }
      } catch {
        toast.error('Could not load the saved library.');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveSettings({ currentId: currentItem?.id ?? null, playMode });
  }, [ready, currentItem, playMode]);

  useEffect(() => {
    if (!hasMediaSession()) return;
    navigator.mediaSession.metadata = currentItem
      ? new MediaMetadata({
          album: 'アプリ of 我',
          artist: 'MIDI Player',
          title: currentItem.name,
        })
      : null;
  }, [currentItem]);

  useEffect(() => {
    if (!hasMediaSession()) return;
    const mediaSession = navigator.mediaSession;
    const controls = () => controlsRef.current;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => controls()?.play()],
      ['pause', () => controls()?.pause()],
      ['stop', () => controls()?.stop()],
      ['previoustrack', () => controls()?.previous()],
      ['nexttrack', () => controls()?.next()],
      [
        'seekto',
        ({ seekTime }) => {
          if (seekTime != null) controls()?.seek(seekTime);
        },
      ],
      [
        'seekbackward',
        ({ seekOffset }) => controls()?.seekBy(-(seekOffset ?? SEEK_STEP_S)),
      ],
      [
        'seekforward',
        ({ seekOffset }) => controls()?.seekBy(seekOffset ?? SEEK_STEP_S),
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Action not supported by this browser.
        }
      }
    };
  }, []);

  useEffect(() => {
    const keyElements = keyElementsRef.current;
    const litUntil = litUntilRef.current;
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(positionTimerRef.current);
      synthRef.current?.dispose();
      synthRef.current = null;
      anchorRef.current?.dispose();
      anchorRef.current = null;
      keyElements.clear();
      litUntil.clear();
      if (hasMediaSession()) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    };
  }, []);

  return {
    addFiles,
    currentIndex,
    currentItem,
    cyclePlayMode,
    duration,
    importing,
    playMode,
    muteStates,
    next,
    pause,
    play,
    playIndex,
    playbackState,
    playlist,
    position,
    previous,
    ready,
    registerKey,
    removeItem,
    seek,
    setPlayMode,
    soloStates,
    stop,
    toggle,
    toggleMute,
    toggleSolo,
  };
}
