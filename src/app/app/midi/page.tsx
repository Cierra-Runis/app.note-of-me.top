'use client';

import { Midi } from '@tonejs/midi';
import {
    MegaphoneIcon,
    MegaphoneOffIcon,
    MicVocalIcon,
    PlayIcon,
    UploadIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as Tone from 'tone';
import { useFilePicker } from 'use-file-picker';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Spinner } from '@/components/ui/spinner';

const PIANO_KEYS = Array.from({ length: 88 }, (_, i) => i + 21);

const trackColor = (trackIndex: number) =>
  `hsl(${(trackIndex * 30) % 360}, 100%, 70%)`;

const midiToHz = (midiNumber: number) => 440 * 2 ** ((midiNumber - 69) / 12);

// ~60 FPS
const FRAME_INTERVAL_MS = 15;

interface KeyEvent {
  end: number;
  midiNumber: number;
  start: number;
  trackIndex: number;
}

export default function MidiPlayer() {
  const [midi, setMidi] = useState<Midi>();
  const synthRef = useRef<null | Tone.PolySynth>(null);
  const muteRefs = useRef<boolean[]>([]);
  const soloRefs = useRef<boolean[]>([]);
  const keyElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef(0);
  const [muteStates, setMuteStates] = useState<boolean[]>([]);
  const [soloStates, setSoloStates] = useState<boolean[]>([]);

  const { loading: isPicking, openFilePicker } = useFilePicker({
    multiple: false,
    onFilesSuccessfullySelected: ({ filesContent }) => {
      const file = filesContent[0];
      try {
        const midiData = new Midi(file.content);
        setMidi(midiData);
        reset(midiData);
      } catch {
        toast('Invalid MIDI file, please reselect.');
      }
    },
    readAs: 'ArrayBuffer',
  });

  const shouldPlay = (trackIndex: number) => {
    const hasSolo = soloRefs.current.some(Boolean);
    if (hasSolo && !soloRefs.current[trackIndex]) return false;
    return !muteRefs.current[trackIndex];
  };

  const stopPlayback = () => {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    cancelAnimationFrame(rafRef.current);
    keyElementsRef.current.forEach((element) => {
      element.style.backgroundColor = '';
    });
  };

  const reset = (midiData: Midi) => {
    stopPlayback();
    synthRef.current?.dispose();
    synthRef.current = new Tone.PolySynth({
      maxPolyphony: 128,
    }).toDestination();
    muteRefs.current = midiData.tracks.map(() => false);
    soloRefs.current = midiData.tracks.map(() => false);
    setMuteStates(midiData.tracks.map(() => false));
    setSoloStates(midiData.tracks.map(() => false));
    keyElementsRef.current.clear();
  };

  const toggleMute = (index: number) => {
    muteRefs.current[index] = !muteRefs.current[index];
    setMuteStates([...muteRefs.current]);
  };

  const toggleSolo = (index: number) => {
    soloRefs.current[index] = !soloRefs.current[index];
    setSoloStates([...soloRefs.current]);
  };

  const startPlayback = async () => {
    const synth = synthRef.current;
    if (!midi || !synth) return;

    await Tone.start();
    stopPlayback();

    const transport = Tone.getTransport();
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

    let cursor = 0;
    let lastFrame = 0;
    const litUntil = new Map<HTMLDivElement, number>();

    const frame = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(frame);
      if (timestamp - lastFrame < FRAME_INTERVAL_MS) return;
      lastFrame = timestamp;

      const now = transport.getSecondsAtTime(Tone.immediate());

      while (cursor < events.length && events[cursor].start <= now) {
        const event = events[cursor++];
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

      litUntil.forEach((end, element) => {
        if (end <= now) {
          element.style.backgroundColor = '';
          litUntil.delete(element);
        }
      });

      if (cursor >= events.length && litUntil.size === 0) {
        cancelAnimationFrame(rafRef.current);
      }
    };

    transport.start();
    rafRef.current = requestAnimationFrame(frame);
  };

  useEffect(() => {
    const keyElements = keyElementsRef.current;
    return () => {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      cancelAnimationFrame(rafRef.current);
      synthRef.current?.dispose();
      synthRef.current = null;
      keyElements.clear();
    };
  }, []);

  return (
    <section
      className={`
        flex h-full flex-col items-center justify-center gap-4 py-8
        md:py-10
      `}
    >
      <div
        className={`
          fixed bottom-10 z-20 flex gap-2 rounded-2xl p-2 backdrop-blur
        `}
      >
        <Button onClick={openFilePicker} size='icon' variant='ghost'>
          {isPicking && <Spinner />}
          <UploadIcon />
        </Button>
        <Button
          disabled={!midi}
          onClick={startPlayback}
          size='icon'
          variant='ghost'
        >
          <PlayIcon />
        </Button>
      </div>

      <div className='flex flex-col'>
        {midi &&
          midi.tracks.map((track, i) => (
            <div key={i}>
              <div className='flex items-center gap-3'>
                <span style={{ color: trackColor(i) }}>
                  {track.name || `Unnamed Track`}
                </span>
              </div>
              <div className='flex items-center gap-4'>
                <div
                  className={`
                    flex gap-0.5
                    lg:gap-1
                  `}
                >
                  {PIANO_KEYS.map((midiNumber) => {
                    const keyId = `${i}-${midiNumber}`;
                    return (
                      <div
                        className={`
                          h-4 w-0.5 rounded-md bg-muted
                          sm:h-6 sm:w-1
                          md:h-8 md:w-1.25
                          lg:w-1.5
                        `}
                        key={keyId}
                        ref={(el) => {
                          if (el) {
                            keyElementsRef.current.set(keyId, el);
                          }
                        }}
                      />
                    );
                  })}
                </div>
                <ButtonGroup>
                  <Button
                    onClick={() => toggleMute(i)}
                    size='icon'
                    variant='ghost'
                  >
                    {muteStates[i] ? <MegaphoneOffIcon /> : <MegaphoneIcon />}
                  </Button>

                  <Button
                    onClick={() => toggleSolo(i)}
                    size='icon'
                    variant={soloStates[i] ? 'secondary' : 'ghost'}
                  >
                    <MicVocalIcon />
                  </Button>
                </ButtonGroup>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
