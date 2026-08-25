// Minimal, consistent-stroke inline icon set -- avoids pulling in an icon
// library dependency for ~8 glyphs used across the nav and headers.
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const IconHome = (p) => (
  <svg {...base} {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9" />
  </svg>
);

export const IconWaves = (p) => (
  <svg {...base} {...p}>
    <path d="M3 16c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0" />
    <path d="M3 10c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0" />
    <path d="M12 3.5c-2 1.6-2.8 3.2-2.8 4.6 0 1.6 1.2 2.4 2.8 2.4s2.8-.8 2.8-2.4c0-1.4-.8-3-2.8-4.6Z" />
  </svg>
);

export const IconBolt = (p) => (
  <svg {...base} {...p}>
    <path d="M13 3 5 13.5h5.5L11 21l8-11h-5.5L13 3Z" strokeLinejoin="round" />
  </svg>
);

export const IconAtom = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" />
  </svg>
);

export const IconGauge = (p) => (
  <svg {...base} {...p}>
    <path d="M4.5 17a7.5 7.5 0 1 1 15 0" />
    <path d="M12 17 15.5 10" />
    <path d="M2.5 17h19" />
  </svg>
);

export const IconSatellite = (p) => (
  <svg {...base} {...p}>
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" transform="rotate(45 12 12)" />
    <path d="M8.2 8.2 5.5 5.5M15.8 15.8l2.7 2.7M15.8 8.2l2.7-2.7M4 20l3.5-3.5" />
    <path d="M13.5 10.5 20 4" strokeWidth="1.4" />
  </svg>
);

export const IconChevron = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconArrowRight = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
