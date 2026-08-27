const STOPS = [
  { range: "0.1 – 0.5 m", color: "rgb(100,181,246)" },
  { range: "0.5 – 1.5 m", color: "rgb(33,150,243)" },
  { range: "1.5 – 3.0 m", color: "rgb(25,90,200)" },
  { range: "3.0 – 6.0 m", color: "rgb(13,40,130)" },
  { range: "> 6.0 m", color: "rgb(60,10,90)" },
];

export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Modeled Water Depth</div>
      <div className="legend-subtitle subtle">Threshold: ≥ 0.1 m</div>
      {STOPS.map((s) => (
        <div key={s.range} className="legend-row">
          <span className="legend-swatch" style={{ background: s.color }} />
          <span className="legend-label">{s.range}</span>
        </div>
      ))}
    </div>
  );
}
