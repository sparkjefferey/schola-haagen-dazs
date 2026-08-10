import { GreekKey, LaurelWreath } from "./decor";

export function Medallion({ size = 96 }: { size?: number }) {
  return (
    <span className="emblem" style={{ width: size, height: size }}>
      <span
        className="emblem-inner"
        style={{ width: size - 8, height: size - 8, position: "relative" }}
      >
        <svg width="1" height="1" viewBox="0 0 1 1" style={{ position: "absolute" }} aria-hidden />
        <LaurelWreath size={(size - 8) * 0.72} className="inner" />
        <svg
          width={(size - 8) * 0.36}
          height={(size - 8) * 0.36}
          viewBox="0 0 40 40"
          style={{ position: "absolute", color: "var(--maroon)", opacity: 0.85 }}
          aria-hidden
        >
          {(() => {
            const pts: string[] = [];
            for (let i = 0; i < 10; i++) {
              const ang = (Math.PI / 5) * i - Math.PI / 2;
              const rad = i % 2 === 0 ? 19 : 8;
              pts.push(`${(20 + rad * Math.cos(ang)).toFixed(2)},${(20 + rad * Math.sin(ang)).toFixed(2)}`);
            }
            return <polygon points={pts.join(" ")} fill="currentColor" />;
          })()}
        </svg>
      </span>
    </span>
  );
}

export function MeanderBand({
  color = "#b4933f",
  className = "band-rule",
}: {
  color?: string;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden>
      <GreekKey color={color} />
      <GreekKey color={color} flip />
    </div>
  );
}