// Browsers only surface the Media Session (OS media overlay, hardware media
// keys, lock screen) while an HTMLMediaElement is playing; Web Audio alone
// doesn't count. Firefox goes further: it ignores MediaStream sources, media
// shorter than 3 s and anything quieter than -72 dBFS. So we loop a generated
// WAV containing a 10 Hz tone at -46 dBFS: far below the audible range and
// unreproducible by speakers, yet "audible" to the browser's detector.

const SAMPLE_RATE = 8000;
const DURATION_S = 8;
const FREQUENCY_HZ = 10;
const AMPLITUDE = 0.005;

const writeAscii = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
};

const buildWav = () => {
  const frames = SAMPLE_RATE * DURATION_S;
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * FREQUENCY_HZ * i) / SAMPLE_RATE);
    view.setInt16(44 + i * 2, Math.round(sample * AMPLITUDE * 0x7fff), true);
  }
  return buffer;
};

export const createSessionAnchor = () => {
  const url = URL.createObjectURL(new Blob([buildWav()], { type: 'audio/wav' }));
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = 'auto';
  return {
    audio,
    dispose: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    },
  };
};
