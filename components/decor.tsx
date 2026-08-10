const ink = "currentColor";

export function GreekKey({
  color = "currentColor",
  className = "",
  flip = false,
}: {
  color?: string;
  className?: string;
  flip?: boolean;
}) {
  return (
    <svg
      className={className}
      width="240"
      height="16"
      viewBox="0 0 240 16"
      aria-hidden
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <path
          key={i}
          d={`M${i * 48 + 4} 15 V3 H9 V11 H17 V3 H25 V11 H33 V3 H41 V15`}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
        />
      ))}
    </svg>
  );
}

export function LaurelWreath({
  size = 96,
  color = ink,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M48 88 C34 80 20 66 22 46 C23 36 27 26 33 18" />
      <path d="M48 88 C62 80 76 66 74 46 C73 36 69 26 63 18" />
      <path d="M33 18 C36 22 40 24 44 25" />
      <path d="M63 18 C60 22 56 24 52 25" />
      {[
        "M29 60 C26 55 26 50 29 46",
        "M26 50 C25 45 26 39 30 36",
        "M33 42 C31 37 32 32 35 29",
        "M67 60 C70 55 70 50 67 46",
        "M70 50 C71 45 70 39 66 36",
        "M63 42 C65 37 64 32 61 29",
        "M29 74 C25 70 24 65 26 61",
        "M67 74 C71 70 72 65 70 61",
      ].map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path d="M48 25 C48 21 52 20 54 17 C56 14 53 11 52 10 C50 9 49 11 48 13 C47 11 46 9 44 10 C43 11 40 14 42 17 C44 20 48 21 48 25 Z" fill={color} stroke="none" opacity="0.85" />
    </svg>
  );
}

export function IonicColumn({
  height = 130,
  color = ink,
  className = "",
  flopped = false,
}: {
  height?: number;
  color?: string;
  className?: string;
  flopped?: boolean;
}) {
  const w = 64;
  const le = height * 0.55;
  const capTop = height - le - height * 0.12;
  return (
    <svg
      className={className}
      width={w}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      fill="none"
      stroke={color}
      aria-hidden
      style={{ transform: flopped ? "scaleX(-1)" : undefined }}
    >
      <rect x={24} y={height - le} width={18} height={le - 8} />
      {[30, 35, 40].map((x) => (
        <line key={x} x1={x} y1={height - le + 4} x2={x} y2={height - 6} strokeWidth="0.7" />
      ))}
      <rect x={20} y={height - le - 4} width={26} height={4} />
      <rect x={16} y={height - 4} width={34} height={2.5} />
      <rect x={13} y={height - 1.5} width={40} height={1.5} />
      <line x1={33} y1={capTop} x2={33} y2={height - le - 2} strokeWidth="1" />
      <path d={`M21 ${capTop} c-3 ${capTop * 0.4} 1 ${capTop * 0.5 + 4} 10 ${capTop * 0.55} m21 ${-capTop * 0.55} c-3 ${-capTop * 0.4} 1 ${-(capTop * 0.5 + 4)} 10 ${-capTop * 0.55}`} />
      <rect x={14} y={capTop - 4} width={38} height={4.5} />
      <rect x={8} y={capTop - 9} width={50} height={4} />
      <ellipse cx={12} cy={capTop - 6.5} rx={3} ry={1.5} fill={color} />
      <ellipse cx={54} cy={capTop - 6.5} rx={3} ry={1.5} fill={color} />
    </svg>
  );
}

export function Amphora({
  size = 90,
  color = ink,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M25 6 h14 v5 a10 10 0 0 1 0 20 c7 8 5 16 2 20 h-18 c-3 -4 -5 -12 2 -20 a10 10 0 0 1 0 -20 z" />
      <path d="M23 12 c-7 1 -8 5 -4 6" />
      <path d="M41 12 c7 1 8 5 4 6" />
      <path d="M25 26 c-3 -8 3 -8 0 0 M32 22 v8 M39 26 c3 -8 -3 -8 0 0" strokeWidth="1" />
    </svg>
  );
}

export function Lyre({
  size = 72,
  color = ink,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 72 72"
      fill="none"
      stroke={color}
      strokeWidth="2"
      aria-hidden
    >
      <path d="M14 22 v34 h8 v-34" />
      <path d="M22 14 c-2 28 -6 38 -22 40" />
      <path d="M22 14 c2 28 6 38 22 40" />
      <path d="M60 40 v6 c-4 4 -6 8 -6 12" />
      <path d="M61 46 c-6 -2 -12 2 -14 10" />
      <line x1="13" y1="54" x2="37" y2="54" />
      <line x1="13" y1="50" x2="37" y2="50" strokeWidth="0.8" />
      <line x1="13" y1="46" x2="36" y2="46" strokeWidth="0.8" />
      <line x1="14" y1="42" x2="34" y2="42" strokeWidth="0.8" />
      <path d="M14 6 c0 5 0 8 0 8" strokeWidth="2.6" />
    </svg>
  );
}

export function Scroll({
  size = 84,
  color = ink,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 84 84"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M14 12 h56 v60 h-56 z" />
      <path d="M14 12 c-4 6 -4 10 0 14 M14 72 c-4 -6 -4 -10 0 -14" />
      <path d="M70 12 c4 6 4 10 0 14 M70 72 c4 -6 4 -10 0 -14" />
      <path d="M24 24 h36 M24 34 h28 M24 44 h36 M24 54 h22" opacity="0.7" />
    </svg>
  );
}

export function BouleBust({
  size = 96,
  color = ink,
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="48" cy="36" r="17" />
      <path d="M24 88 c4 -16 10 -22 18 -22 h12 c8 0 14 6 18 22" />
      <path d="M31 34 c4 -8 30 -8 34 0 M35 24 c4 -5 22 -5 26 0" opacity="0.7" />
    </svg>
  );
}