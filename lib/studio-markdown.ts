export type StudioMarkdownIssueCode =
  | "body_control_character"
  | "body_raw_html"
  | "body_inline_image"
  | "body_discord_syntax"
  | "body_unsupported_markdown"
  | "body_unsafe_link"
  | "body_invalid_link";

export type StudioMarkdownIssue = {
  code: StudioMarkdownIssueCode;
  message: string;
  start: number;
  end: number;
};

function issue(
  code: StudioMarkdownIssueCode,
  message: string,
  match: RegExpExecArray,
): StudioMarkdownIssue {
  return {
    code,
    message,
    start: match.index,
    end: match.index + match[0].length,
  };
}

export function validateStudioMarkdown(body: string): StudioMarkdownIssue | null {
  const checks: Array<{
    pattern: RegExp;
    code: StudioMarkdownIssueCode;
    message: string;
  }> = [
    {
      pattern: /\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u,
      code: "body_control_character",
      message: "제어 문자는 사용할 수 없습니다.",
    },
    {
      pattern: /<\/?[A-Za-z][^>]*>/u,
      code: "body_raw_html",
      message: "HTML 태그는 사용할 수 없습니다.",
    },
    {
      pattern: /!\[[^\]\n]*\]\([^\n)]*\)/u,
      code: "body_inline_image",
      message: "본문 안의 이미지 문법은 사용할 수 없습니다.",
    },
    {
      pattern: /<(?:@!?|@&|#|t:|a?:)[^>\n]+>|@(everyone|here)\b/iu,
      code: "body_discord_syntax",
      message: "Discord mention·채널·emoji 문법은 사용할 수 없습니다.",
    },
    {
      pattern: /^#{1,6}\s/mu,
      code: "body_unsupported_markdown",
      message: "제목 Markdown은 지원하지 않습니다.",
    },
    {
      pattern: /\|\|/u,
      code: "body_unsupported_markdown",
      message: "Discord spoiler 문법은 지원하지 않습니다.",
    },
  ];

  for (const check of checks) {
    const match = check.pattern.exec(body);
    if (match) return issue(check.code, check.message, match);
  }

  const markdownLinks = /\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/gu;
  for (const match of body.matchAll(markdownLinks)) {
    try {
      const url = new URL(match[1]);
      if (url.protocol !== "https:" || url.username || url.password) {
        return issue(
          "body_unsafe_link",
          "링크는 인증 정보가 없는 https 주소만 사용할 수 있습니다.",
          match,
        );
      }
    } catch {
      return issue(
        "body_invalid_link",
        "Markdown 링크 주소를 확인해 주세요.",
        match,
      );
    }
  }

  const protocol = /\b([A-Za-z][A-Za-z0-9+.-]*):\/\//gu;
  for (const match of body.matchAll(protocol)) {
    if (match[1].toLowerCase() !== "https") {
      return issue(
        "body_unsafe_link",
        "본문 주소는 https만 사용할 수 있습니다.",
        match,
      );
    }
  }

  return null;
}
