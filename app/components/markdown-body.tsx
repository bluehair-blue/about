import { Fragment, type ReactNode } from "react";

function safeHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function inlineNodes(value: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (depth > 4 || value === "") return [value];
  const token = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^)\s]+)(?:\s+"[^"\n]*")?\)|\*([^*\n]+)\*|_([^_\n]+)_)/u;
  const match = token.exec(value);
  if (!match) return [value];

  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  let formatted: ReactNode;
  if (match[2] || match[3]) {
    formatted = (
      <strong>
        {inlineNodes(match[2] ?? match[3], `${keyPrefix}-strong`, depth + 1)}
      </strong>
    );
  } else if (match[4]) {
    formatted = (
      <del>{inlineNodes(match[4], `${keyPrefix}-del`, depth + 1)}</del>
    );
  } else if (match[5]) {
    formatted = <code>{match[5]}</code>;
  } else if (match[6] && match[7] && safeHttps(match[7])) {
    formatted = (
      <a href={match[7]} target="_blank" rel="noopener noreferrer">
        {match[6]}
      </a>
    );
  } else if (match[8] || match[9]) {
    formatted = (
      <em>
        {inlineNodes(match[8] ?? match[9], `${keyPrefix}-em`, depth + 1)}
      </em>
    );
  } else {
    formatted = match[0];
  }

  return [
    before,
    <Fragment key={`${keyPrefix}-${match.index}`}>{formatted}</Fragment>,
    ...inlineNodes(after, `${keyPrefix}-after-${match.index}`, depth),
  ];
}

export function MarkdownBody({
  body,
  className,
  lang,
}: {
  body: string;
  className?: string;
  lang?: string;
}) {
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      const start = index;
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${start}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = [];
      const start = index;
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${start}`}>
          {quoted.map((item, itemIndex) => (
            <Fragment key={`${start}-${itemIndex}`}>
              {itemIndex > 0 ? <br /> : null}
              {inlineNodes(item, `quote-${start}-${itemIndex}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (/^(?:[-+*]|\d+\.)\s+/u.test(line)) {
      const ordered = /^\d+\.\s+/u.test(line);
      const items: string[] = [];
      const start = index;
      const pattern = ordered ? /^\d+\.\s+/u : /^[-+*]\s+/u;
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, ""));
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={`${start}-${itemIndex}`}>
          {inlineNodes(item, `list-${start}-${itemIndex}`)}
        </li>
      ));
      blocks.push(
        ordered
          ? <ol key={`list-${start}`}>{children}</ol>
          : <ul key={`list-${start}`}>{children}</ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    const start = index;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^>\s?/u.test(lines[index]) &&
      !/^(?:[-+*]|\d+\.)\s+/u.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`paragraph-${start}`}>
        {paragraph.map((item, itemIndex) => (
          <Fragment key={`${start}-${itemIndex}`}>
            {itemIndex > 0 ? <br /> : null}
            {inlineNodes(item, `paragraph-${start}-${itemIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={className} lang={lang}>{blocks}</div>;
}
