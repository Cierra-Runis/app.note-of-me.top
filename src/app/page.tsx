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

// 88 个钢琴键 MIDI 音符编号 (A0 到 C8)
const PIANO_KEYS = Array.from({ length: 88 }, (_, i) => i + 21);

export default function MidiPlayer() {
  const [midi, setMidi] = useState<Midi>();
  const synthRefs = useRef<Tone.PolySynth[]>([]);
  const muteRefs = useRef<boolean[]>([]);
  const soloRefs = useRef<boolean[]>([]);
  const keyElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
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
        toast(
          '不合法的 MIDI 文件，请选择正确的文件',
          // {
          // color: 'danger',
          // description: '不合法的 MIDI 文件，请选择正确的文件',
          // title: '错误',
          // }
        );
      }
    },
    readAs: 'ArrayBuffer',
  });

  const reset = (midiData: Midi) => {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    synthRefs.current = midiData.tracks.map(() => {
      return new Tone.PolySynth(Tone.Synth).toDestination();
    });
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

  const activateKey = (trackIndex: number, noteName: string) => {
    const key = `${trackIndex}-${noteName}`;
    const element = keyElementsRef.current.get(key);
    if (element) {
      element.style.backgroundColor = `hsl(${
        (trackIndex * 30) % 360
      }, 100%, 70%)`;
      element.style.boxShadow = `0 0 8px hsl(${
        (trackIndex * 30) % 360
      }, 100%, 70%)`;
    }
  };

  const deactivateKey = (trackIndex: number, noteName: string) => {
    const key = `${trackIndex}-${noteName}`;
    const element = keyElementsRef.current.get(key);
    if (element) {
      element.style.backgroundColor = '';
      element.style.boxShadow = '';
    }
  };

  const startPlayback = async () => {
    await Tone.start();

    Tone.getTransport().stop();
    Tone.getTransport().cancel();

    midi?.tracks.forEach((track, i) => {
      const synth = synthRefs.current[i];
      track.notes.forEach((note) => {
        Tone.getTransport().schedule((time) => {
          const hasSolo = soloRefs.current.some(Boolean);
          const isSolo = soloRefs.current[i];
          if (hasSolo && !isSolo) return;

          const isMuted = muteRefs.current[i];
          if (isMuted) return;

          synth.triggerAttackRelease(
            note.name,
            note.duration,
            time,
            note.velocity,
          );

          Tone.getDraw().schedule(() => {
            activateKey(i, note.name);
            setTimeout(() => {
              deactivateKey(i, note.name);
            }, note.duration * 1000);
          }, time);
        }, note.time);
      });
    });

    Tone.getTransport().start();
  };

  // 组件卸载时清理资源
  useEffect(() => {
    const keyElements = keyElementsRef.current;
    return () => {
      // 停止并取消所有调度
      Tone.getTransport().stop();
      Tone.getTransport().cancel();

      // 释放所有合成器
      synthRefs.current.forEach((synth) => {
        synth.dispose();
      });

      // 清空引用
      synthRefs.current = [];
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
          // startContent={}
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
                <span
                  style={{
                    color: `hsl(${(i * 30) % 360}, 100%, 70%)`,
                  }}
                >
                  {track.name || `未命名轨道`}
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
                    const note = Tone.Frequency(midiNumber, 'midi').toNote();
                    const keyId = `${i}-${note}`;
                    return (
                      <div
                        className={`
                          h-4 w-0.5 rounded-md bg-muted transition-all
                          duration-0
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
                    // startContent={}
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
