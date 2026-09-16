'use client';

import {
    ArrowRightToLineIcon,
    AudioLinesIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ListMusicIcon,
    MegaphoneIcon,
    MegaphoneOffIcon,
    MicVocalIcon,
    PauseIcon,
    PlayIcon,
    Repeat1Icon,
    RepeatIcon,
    ShuffleIcon,
    SkipBackIcon,
    SkipForwardIcon,
    UploadIcon,
    XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import {
    PLAY_MODE_LABELS,
    type PlayMode,
    trackColor,
    useMidiPlayer,
} from './use-midi-player';

const PIANO_KEYS = Array.from({ length: 88 }, (_, i) => i + 21);

const BAR_COLLAPSED_KEY = 'midi-player:bar-collapsed';

const PLAY_MODE_ICONS: Record<PlayMode, React.ReactNode> = {
  'repeat-all': <RepeatIcon />,
  'repeat-one': <Repeat1Icon />,
  sequential: <ArrowRightToLineIcon />,
  shuffle: <ShuffleIcon />,
};

// Firefox restores the script-changed `disabled` state of form controls across
// reloads, which breaks hydration; use aria-disabled + styling instead. The
// handlers already no-op when there is nothing to act on.
const inertProps = (inert: boolean) =>
  inert
    ? {
        'aria-disabled': true as const,
        className: 'pointer-events-none opacity-50',
        tabIndex: -1,
      }
    : { className: undefined };

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

export default function MidiPlayer() {
  const player = useMidiPlayer();
  const {
    currentIndex,
    currentItem,
    duration,
    importing,
    muteStates,
    playMode,
    playbackState,
    playlist,
    position,
    ready,
    soloStates,
  } = player;

  const fileInputRef = useRef<HTMLInputElement>(null);
  // While the thumb is being dragged, show the drag value instead of the
  // live position so the slider doesn't fight the position timer.
  const [dragValue, setDragValue] = useState<number>();
  // Collapsed state is a per-viewer convenience kept in localStorage; read it
  // after mount so the server and client render the same initial markup.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(BAR_COLLAPSED_KEY) === '1');
    } catch {
      // Storage unavailable; stay expanded.
    }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(BAR_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable; the choice just won't persist.
    }
  };

  const hasTrack = Boolean(currentItem);
  const isPlaying = playbackState === 'playing';
  const isBusy = !ready || importing !== null;
  const sliderValue = dragValue ?? Math.min(position, duration);

  const openFilePicker = () => {
    if (!isBusy) fileInputRef.current?.click();
  };

  const uploadButtonContent = importing ? (
    <>
      <Spinner />
      <span className='text-xs tabular-nums'>
        {importing.done}/{importing.total}
      </span>
    </>
  ) : (
    <UploadIcon />
  );

  return (
    <section
      className={cn(
        `
          flex h-full flex-col items-center justify-center gap-4 py-8
          md:py-10
        `,
        collapsed ? 'pb-24 md:pb-24' : 'pb-40 md:pb-40',
      )}
    >
      <input
        className='hidden'
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so picking the same files again still fires onChange.
          event.target.value = '';
          void player.addFiles(files);
        }}
        ref={fileInputRef}
        type='file'
      />

      {collapsed && (
        <div
          className={`
            fixed bottom-10 z-20 flex items-center gap-1 rounded-full border
            bg-background/80 p-1 backdrop-blur
          `}
        >
          <Button
            {...inertProps(!hasTrack)}
            onClick={player.toggle}
            size='icon-sm'
            variant='ghost'
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            aria-label='Show player controls'
            onClick={toggleCollapsed}
            size='icon-sm'
            title='Show player controls'
            variant='ghost'
          >
            <ChevronUpIcon />
          </Button>
        </div>
      )}

      <div
        className={cn(
          `
            fixed bottom-10 z-20 flex w-[calc(100%-2rem)] max-w-md flex-col
            gap-2 rounded-2xl border bg-background/80 p-3 backdrop-blur
          `,
          collapsed && 'hidden',
        )}
      >
        <div className='flex items-center gap-2 text-xs'>
          <span className='truncate'>
            {currentItem?.name ?? (ready ? 'No track selected' : 'Loading…')}
          </span>
          <span className='ml-auto shrink-0 tabular-nums text-muted-foreground'>
            {formatTime(sliderValue)} / {formatTime(duration)}
          </span>
          <Button
            aria-label='Hide player controls'
            className='-my-1 -mr-1 shrink-0'
            onClick={toggleCollapsed}
            size='icon-xs'
            title='Hide player controls'
            variant='ghost'
          >
            <ChevronDownIcon />
          </Button>
        </div>
        <Slider
          disabled={!hasTrack}
          max={duration || 1}
          onValueChange={([value]) => setDragValue(value)}
          onValueCommit={([value]) => {
            setDragValue(undefined);
            player.seek(value);
          }}
          step={0.1}
          value={[sliderValue]}
        />
        <div className='flex justify-center'>
          <ButtonGroup>
            <Button
              {...inertProps(isBusy)}
              className={cn(
                importing && 'w-auto px-2',
                inertProps(isBusy).className,
              )}
              onClick={openFilePicker}
              size='icon'
              variant='ghost'
            >
              {uploadButtonContent}
            </Button>
            <Button
              aria-label={PLAY_MODE_LABELS[playMode]}
              onClick={player.cyclePlayMode}
              size='icon'
              title={PLAY_MODE_LABELS[playMode]}
              variant='ghost'
            >
              {PLAY_MODE_ICONS[playMode]}
            </Button>
            <Button
              {...inertProps(!hasTrack)}
              onClick={player.previous}
              size='icon'
              variant='ghost'
            >
              <SkipBackIcon />
            </Button>
            <Button
              {...inertProps(!hasTrack)}
              onClick={player.toggle}
              size='icon'
              variant='ghost'
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button
              {...inertProps(!hasTrack)}
              onClick={player.next}
              size='icon'
              variant='ghost'
            >
              <SkipForwardIcon />
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button size='icon' variant='ghost'>
                  <ListMusicIcon />
                </Button>
              </SheetTrigger>
              <SheetContent className='flex flex-col' side='right'>
                <SheetHeader>
                  <SheetTitle>Playlist</SheetTitle>
                  <SheetDescription>
                    {playlist.length} track{playlist.length === 1 ? '' : 's'}
                  </SheetDescription>
                </SheetHeader>
                <ul className='flex flex-1 flex-col gap-1 overflow-y-auto px-4'>
                  {playlist.map((item, i) => {
                    const isCurrent = i === currentIndex;
                    return (
                      <li
                        className={cn(
                          'flex items-center gap-2 rounded-md text-sm',
                          isCurrent && 'bg-accent text-accent-foreground',
                        )}
                        key={item.id}
                      >
                        <button
                          className={`
                            flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5
                            text-left
                          `}
                          onClick={() => player.playIndex(i)}
                          type='button'
                        >
                          <span
                            className={`
                              w-5 shrink-0 text-center text-xs tabular-nums
                              text-muted-foreground
                            `}
                          >
                            {isCurrent && isPlaying ? (
                              <AudioLinesIcon className='mx-auto size-3.5' />
                            ) : (
                              i + 1
                            )}
                          </span>
                          <span className='truncate'>{item.name}</span>
                          <span
                            className={`
                              ml-auto shrink-0 text-xs tabular-nums
                              text-muted-foreground
                            `}
                          >
                            {formatTime(item.duration)}
                          </span>
                        </button>
                        <Button
                          className='size-7 shrink-0'
                          onClick={() => player.removeItem(item.id)}
                          size='icon'
                          variant='ghost'
                        >
                          <XIcon />
                        </Button>
                      </li>
                    );
                  })}
                  {playlist.length === 0 && (
                    <li className='py-8 text-center text-sm text-muted-foreground'>
                      {ready ? 'No MIDI files yet.' : 'Loading…'}
                    </li>
                  )}
                </ul>
                <SheetFooter>
                  <Button
                    {...inertProps(isBusy)}
                    onClick={openFilePicker}
                    variant='outline'
                  >
                    {uploadButtonContent}
                    Add files
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </ButtonGroup>
        </div>
      </div>

      <div className='flex flex-col'>
        {currentItem?.trackNames.map((trackName, i) => (
          <div key={i}>
            <div className='flex items-center gap-3'>
              <span style={{ color: trackColor(i) }}>
                {trackName || `Unnamed Track`}
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
                      ref={(el) => (el ? player.registerKey(keyId, el) : undefined)}
                    />
                  );
                })}
              </div>
              <ButtonGroup>
                <Button
                  onClick={() => player.toggleMute(i)}
                  size='icon'
                  variant='ghost'
                >
                  {muteStates[i] ? <MegaphoneOffIcon /> : <MegaphoneIcon />}
                </Button>

                <Button
                  onClick={() => player.toggleSolo(i)}
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
