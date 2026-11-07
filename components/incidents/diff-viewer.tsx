import { Fragment, type ReactNode } from "react";
import { cn } from "@/src/utils/cn";

const KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|of|in|new|class|extends|import|export|from|default|async|await|try|catch|throw|typeof|null|undefined|true|false|this|require|module|def|self|None|True|False|pass|elif|func|package|struct|interface|type)\b/g;

/** Tiny tokenizer: strings, comments, numbers, keywords. Good enough to read diffs. */
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b)/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  const pushPlain = (s: string) => {
    let l = 0;
    let k: RegExpExecArray | null;
    KEYWORDS.lastIndex = 0;
    while ((k = KEYWORDS.exec(s))) {
      if (k.index > l) out.push(s.slice(l, k.index));
      out.push(<span key={`k${i++}`} className="text-accent">{k[0]}</span>);
      l = k.index + k[0].length;
    }
    if (l < s.length) out.push(s.slice(l));
  };
  while ((m = re.exec(code))) {
    if (m.index > last) pushPlain(code.slice(last, m.index));
    const t = m[0];
    const cls = t.startsWith("//") || t.startsWith("#") ? "text-fg-subtle italic" : /^\d/.test(t) ? "text-warning" : "text-success";
    out.push(<span key={`t${i++}`} className={cls}>{t}</span>);
    last = m.index + t.length;
  }
  if (last < code.length) pushPlain(code.slice(last));
  return out;
}

type Line = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; oldNo?: number; newNo?: number };

export function parseDiff(diff: string): Line[] {
  const lines: Line[] = [];
  let o = 0;
  let n = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git") || raw.startsWith("index ") || raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("new file") || raw.startsWith("deleted file")) {
      lines.push({ kind: "meta", text: raw });
      continue;
    }
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) lines.push({ kind: "add", text: raw.slice(1), newNo: n++ });
    else if (raw.startsWith("-")) lines.push({ kind: "del", text: raw.slice(1), oldNo: o++ });
    else if (raw.startsWith("\\")) lines.push({ kind: "meta", text: raw });
    else if (raw.length || o || n) lines.push({ kind: "ctx", text: raw.slice(1), oldNo: o++, newNo: n++ });
  }
  return lines.filter((l, i, a) => !(i === a.length - 1 && l.kind === "ctx" && !l.text));
}

export function DiffViewer({ diff, className }: { diff: string; className?: string }) {
  const lines = parseDiff(diff).filter((l) => l.kind !== "meta");
  return (
    <div className={cn("overflow-x-auto font-mono text-[12px] leading-5 scrollbar-thin", className)}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) =>
            l.kind === "hunk" ? (
              <tr key={i} className="bg-info-soft/50 text-info">
                <td colSpan={3} className="px-3 py-0.5 text-[11px]">{l.text}</td>
              </tr>
            ) : (
              <tr key={i} className={cn(l.kind === "add" && "bg-[var(--diff-add)]", l.kind === "del" && "bg-[var(--diff-del)]")}>
                <td className="w-10 select-none border-r border-border/50 px-2 text-right text-fg-subtle">{l.oldNo ?? ""}</td>
                <td className="w-10 select-none border-r border-border/50 px-2 text-right text-fg-subtle">{l.newNo ?? ""}</td>
                <td className="whitespace-pre px-3 text-fg">
                  <span className={cn("mr-2 select-none", l.kind === "add" ? "text-success" : l.kind === "del" ? "text-danger" : "text-transparent")}>{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                  <Fragment>{highlight(l.text)}</Fragment>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
