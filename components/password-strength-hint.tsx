import type { StrengthResult } from "@/lib/password-strength";

const LEVEL_STYLE: Record<StrengthResult["level"], { color: string; note: string }> = {
  weak: { color: "#b02a37", note: "极易被脚本试出，建议更换" },
  medium: { color: "#8a6a24", note: "尚可，但建议加强" },
  strong: { color: "#2e7d32", note: "较稳妥" },
  "very-strong": { color: "#14532d", note: "极稳妥" },
};

export function PasswordStrengthHint({ strength }: { strength: StrengthResult }) {
  if (strength.score === 0) {
    return (
      <p className="hint">
        建议 12 位以上，含大小写、数字与符号；门派不设找回，口令务必牢记。
      </p>
    );
  }
  const s = LEVEL_STYLE[strength.level];
  return (
    <div style={{ marginTop: 6, fontSize: 12 }}>
      <div
        style={{
          height: 4,
          background: "var(--line)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(8, Math.min(100, (strength.score / 7) * 100))}%`,
            background: s.color,
            height: "100%",
            transition: "width 0.15s",
          }}
        />
      </div>
      <p style={{ marginTop: 4, color: s.color }}>
        口令风险等级：{strength.label} —— {s.note}
      </p>
    </div>
  );
}
