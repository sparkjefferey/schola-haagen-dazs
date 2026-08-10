export function renderMarkdown(text: string): React.ReactNode[] {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (trimmed.startsWith("## ")) {
      return (
        <h3 key={i} className="md-h">
          {trimmed.replace(/^## /, "")}
        </h3>
      );
    }
    const lines = block.split("\n");
    const isQuote = lines.every((l) => l.trim().startsWith(">"));
    if (isQuote) {
      return (
        <blockquote key={i} className="md-quote">
          {lines.map((l, j) => (
            <p key={j}>{l.trim().replace(/^>\s?/, "")}</p>
          ))}
        </blockquote>
      );
    }
    const list = lines.filter((l) => /^[-*]\s/.test(l.trim()));
    if (list.length === lines.length && list.length > 1) {
      return (
        <ul key={i} className="md-list">
          {list.map((l, j) => (
            <li key={j}>{renderInline(l.trim().replace(/^[-*]\s/, ""))}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i}>
        {lines.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {renderInline(l)}
          </span>
        ))}
      </p>
    );
  });
}

function renderInline(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return <code key={i}>{p.slice(1, -1)}</code>;
    }
    return <span key={i}>{p}</span>;
  });
}