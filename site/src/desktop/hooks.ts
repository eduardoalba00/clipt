import { useEffect, useState } from "react";

/** Re-renders when the browser window resizes. */
export function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const resize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return size;
}

/** Seconds since `since` (performance.now() ms), ticking every frame while `on`. */
export function useClock(on: boolean) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on]);
  return now;
}
