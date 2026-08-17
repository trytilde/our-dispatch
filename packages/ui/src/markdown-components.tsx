import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { Streamdown, type Components } from "streamdown";

export interface CodeBlockProps {
  children: string;
  language?: string;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
}

export interface CitationLinkProps {
  children: ReactNode;
  href: string;
  label?: string;
}

export function CodeBlock({
  children,
  language = "",
  showLineNumbers = false,
  wordWrap = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function copy(): void {
    void navigator.clipboard?.writeText(children);
    setCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2_000);
  }

  if (language === "diff" || language === "patch") {
    return <DiffBlock value={children} />;
  }

  return (
    <section className="ui-code-block" data-word-wrap={wordWrap || undefined}>
      <header className="ui-code-block-header">
        <span>{language || "Code"}</span>
        <button
          className="ui-code-block-copy"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={copy}
          type="button"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </header>
      <div className="ui-code-block-content">
        <code className="ui-default-code">
          {children
            .replace(/\n$/, "")
            .split("\n")
            .map((line, index) => (
              <span className="ui-default-code__line-content" key={`${index}-${line}`}>
                {showLineNumbers ? <i aria-hidden="true">{index + 1}</i> : null}
                <span>{line || " "}</span>
              </span>
            ))}
        </code>
      </div>
    </section>
  );
}

export function DiffBlock({ value }: { value: string }) {
  return (
    <section className="ui-code-block ui-code-block--diff">
      <header className="ui-code-block-header">
        <span>Diff</span>
      </header>
      <code className="ui-default-diff">
        {value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, index) => {
            const tone = line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : "plain";
            return (
              <span data-tone={tone} key={`${index}-${line}`}>
                <i aria-hidden="true">{index + 1}</i>
                <span>{line || " "}</span>
              </span>
            );
          })}
      </code>
    </section>
  );
}

export function InlinePath({ value }: { value: string }) {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const prefix = slash >= 0 ? value.slice(0, slash + 1) : "";
  const filename = slash >= 0 ? value.slice(slash + 1) : value;
  return (
    <code className="ui-markdown__inline-code" data-path="true">
      {prefix ? <span className="ui-markdown__inline-path-prefix">{prefix}</span> : null}
      <span className="ui-markdown__inline-path-filename">{filename}</span>
    </code>
  );
}

export function CitationLink({ children, href, label }: CitationLinkProps) {
  return (
    <a
      aria-label={label}
      className="ui-markdown__link ui-markdown__citation-btn md-citation-btn"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

const markdownComponents: Components = {
  a({ children, href = "" }) {
    const citation = /^\[?\d+\]?$/.test(plainText(children)) || href.startsWith("#citation-");
    return citation ? (
      <CitationLink href={href}>{children}</CitationLink>
    ) : (
      <a className="ui-markdown__link" href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote className="ui-markdown__blockquote">{children}</blockquote>;
  },
  code({ children, className }) {
    const value = plainText(children);
    const language = /language-([^ ]+)/.exec(className ?? "")?.[1] ?? "";
    if (className || value.includes("\n"))
      return <CodeBlock language={language}>{value}</CodeBlock>;
    if (looksLikePath(value)) return <InlinePath value={value} />;
    return <code className="ui-markdown__inline-code">{children}</code>;
  },
  del({ children }) {
    return <del className="ui-markdown__del">{children}</del>;
  },
  h1: ({ children }) => <h1 className="ui-markdown__heading">{children}</h1>,
  h2: ({ children }) => <h2 className="ui-markdown__heading">{children}</h2>,
  h3: ({ children }) => <h3 className="ui-markdown__heading">{children}</h3>,
  h4: ({ children }) => <h4 className="ui-markdown__heading">{children}</h4>,
  h5: ({ children }) => <h5 className="ui-markdown__heading">{children}</h5>,
  h6: ({ children }) => <h6 className="ui-markdown__heading">{children}</h6>,
  hr: () => <hr className="ui-markdown__hr" />,
  img({ alt = "", src }) {
    return src ? (
      <img alt={alt} className="ui-markdown__image" loading="lazy" src={src} />
    ) : (
      <span className="ui-markdown__broken-image">
        <span aria-hidden="true">▧</span>
        <span className="ui-markdown__broken-image-label">{alt || "Image unavailable"}</span>
      </span>
    );
  },
  input({ type, ...props }) {
    return (
      <input
        className={type === "checkbox" ? "ui-markdown__task-marker" : undefined}
        type={type}
        {...props}
      />
    );
  },
  li({ children, className }) {
    return <li className={`ui-markdown__list-item ${className ?? ""}`}>{children}</li>;
  },
  ol: ({ children }) => <ol className="ui-markdown__list">{children}</ol>,
  p: ({ children }) => <p className="ui-markdown__paragraph">{children}</p>,
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => <table className="ui-markdown__table">{children}</table>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  td: ({ children }) => (
    <td className="ui-markdown__td">
      <span className="ui-markdown__table-cell-content">{children}</span>
    </td>
  ),
  th: ({ children }) => (
    <th className="ui-markdown__th">
      <span className="ui-markdown__table-cell-content">{children}</span>
    </th>
  ),
  thead: ({ children }) => <thead className="ui-markdown__thead">{children}</thead>,
  tr: ({ children }) => <tr className="ui-markdown__tr">{children}</tr>,
  ul: ({ children }) => <ul className="ui-markdown__list">{children}</ul>,
};

export function MarkdownText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="markdown ui-markdown">
      <Streamdown components={markdownComponents} controls={false}>
        {text}
      </Streamdown>
    </div>
  );
}

function plainText(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) => (typeof child === "string" || typeof child === "number" ? `${child}` : ""))
    .join("");
}

function looksLikePath(value: string): boolean {
  return (
    /^(?:\.{0,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])/.test(value) ||
    (/[/\\]/.test(value) && /\.[A-Za-z0-9]{1,8}$/.test(value))
  );
}
