const STOPS = [
  { depth: "0 m", color: "rgb(173,216,230)" },
  { depth: "0.5 m", color: "rgb(100,181,246)" },
  { depth: "1.5 m", color: "rgb(33,150,243)" },
  { depth: "3 m", color: "rgb(25,90,200)" },
  { depth: "6 m", color: "rgb(13,40,130)" },
  { depth: "10 m+", color: "rgb(60,10,90)" },
];

export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Water depth</div>
      {STOPS.map((s) => (
        <div key={s.depth} className="legend-row">
          <span className="legend-swatch" style={{ background: s.color }} />
          {s.depth}
        </div>
      ))}
    </div>
  );
}
