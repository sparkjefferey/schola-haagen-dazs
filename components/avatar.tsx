import { avatarTone, initials } from "@/lib/format";

export function Avatar({
  name,
  id,
  size = 40,
}: {
  name: string;
  id: number;
  size?: number;
}) {
  const [bg, fg] = avatarTone(id);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(150deg, ${bg}, ${bg}CC)`,
        color: fg,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}