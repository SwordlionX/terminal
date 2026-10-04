import { Fragment, type ReactNode } from 'react';

/** Inline **bold**, *italic* and `code` as React elements; never as HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined) out.push(<strong key={match.index}>{match[1]}</strong>);
    else if (match[2] !== undefined) out.push(<em key={match.index}>{match[2]}</em>);
    else out.push(<span key={match.index}>{match[3]}</span>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Light Markdown for assistant replies: headings, lists, separators and inline emphasis. */
export function AssistantText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="assistant-text-list" style={{ listStyle: 'decimal' }}>
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="assistant-text-list" style={{ listStyle: 'disc' }}>
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/),
      numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line))
      blocks.push(<hr key={blocks.length} className="assistant-text-rule" />);
    else if (/^\s*#{1,6}\s+/.test(line))
      blocks.push(
        <p key={blocks.length} className="assistant-text-heading">
          {inline(line.replace(/^\s*#{1,6}\s+/, ''))}
        </p>,
      );
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return (
    <div className="assistant-text">
      {blocks.map((block, i) => (
        <Fragment key={i}>{block}</Fragment>
      ))}
    </div>
  );
}
