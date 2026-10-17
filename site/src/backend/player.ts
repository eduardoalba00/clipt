/** Plays the open take within its trim, like the AVPlayer in preview.rs:
 * stops at the trim end, and starts over from the trim start. */
import type { Clip } from "./clip";
import { emit } from "./events";

let clip: Clip | null = null;
let trim = { start: 0, end: 0 };
let time = 0;
let playing = false;
let frame = 0;
let last = 0;

function report() {
  emit("playback", { time, playing });
}

function tick(now: number) {
  if (!playing || !clip) return;
  const video = clip.video;
  if (video) time = video.currentTime;
  else time += (now - last) / 1000;
  last = now;
  if (time >= trim.end) {
    time = trim.end;
    pause();
    return;
  }
  report();
  frame = requestAnimationFrame(tick);
}

export function pause() {
  playing = false;
  cancelAnimationFrame(frame);
  clip?.video?.pause();
  report();
}

export const player = {
  open(next: Clip, start: number, end: number) {
    pause();
    clip = next;
    trim = { start, end };
    player.seek(start);
  },

  close() {
    pause();
    clip = null;
  },

  setTrim(start: number, end: number) {
    trim = { start, end };
  },

  /** Seconds into the take. */
  now: () => time,

  playing: () => playing,

  seek(t: number) {
    time = Math.min(Math.max(t, 0), clip?.duration ?? 0);
    if (clip?.video) clip.video.currentTime = time;
    report();
  },

  play() {
    if (!clip || playing) return;
    if (time < trim.start || time >= trim.end - 1 / 60) player.seek(trim.start);
    playing = true;
    last = performance.now();
    void clip.video?.play().catch(() => pause());
    frame = requestAnimationFrame(tick);
    report();
  },

  pause,

  toggle() {
    if (playing) pause();
    else player.play();
  },
};
