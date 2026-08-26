import { useEffect, useRef, useState } from "react";

export default function Timeline({ frames, index, onChange }) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!playing) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      onChange((prev) => {
        const next = prev + 1;
        if (next >= frames.length) {
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [playing, frames.length, onChange]);

  if (!frames.length) return null;
  const frame = frames[index];

  return (
    <div className="timeline">
      <button onClick={() => setPlaying((p) => !p)} className="play-btn">
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={frames.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          onChange(() => Number(e.target.value));
        }}
      />
      <div className="timeline-label">
        t = {frame.t_minutes} min &nbsp;|&nbsp; flooded {frame.flooded_area_km2} km² &nbsp;|&nbsp; max depth {frame.max_depth_m} m
      </div>
    </div>
  );
}
