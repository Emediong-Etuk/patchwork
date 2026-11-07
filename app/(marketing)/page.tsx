import Link from "next/link";
import { ArrowRight, Bug, Check, FileSearch, GitPullRequest, Github, ShieldCheck, Users, Wrench, Compass, Search, FlaskConical, BookOpen, Trophy } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

const flow = [
  { icon: Bug, label: "Report", text: "A developer describes the bug." },
  { icon: Search, label: "Investigate", text: "The Investigator reads the code and reproduces the failure." },
  { icon: Wrench, label: "Fix", text: "The Fixer makes the smallest safe change on its own branch." },
  { icon: FlaskConical, label: "Test", text: "QA runs the real tests, and sends failures back." },
  { icon: Check, label: "Approve", text: "You review the evidence and decide." },
];

const reasons = [
  { icon: Users, title: "Specialized agents", text: "Triage, Investigator, Fixer and QA each have one job, their own instructions, their own tools and a structured report to deliver." },
  { icon: Compass, title: "Shared collaboration through Switch", text: "Every handoff is a message in the incident's Switch room. Agents wake when Switch delivers work to them, and people can join the same room from Slack, Discord or Mattermost." },
  { icon: FileSearch, title: "Evidence-backed decisions", text: "Each conclusion carries evidence that PATCHWORK re-checks itself: code references against the repository, test claims against the recorded output." },
  { icon: ShieldCheck, title: "Human-controlled code changes", text: "Agents work on an isolated branch and run only allowlisted commands. Nothing is merged or deployed: approving a fix opens a pull request, merging stays your call." },
];

function AgentDiagram() {
  const agents = [
    { name: "Triage", cls: "border-warning/40 text-warning", pos: "left-1/2 top-0 -translate-x-1/2" },
    { name: "Investigator", cls: "border-info/40 text-info", pos: "right-0 top-1/2 -translate-y-1/2" },
    { name: "Fixer", cls: "border-accent/40 text-accent", pos: "left-1/2 bottom-0 -translate-x-1/2" },
    { name: "QA", cls: "border-success/40 text-success", pos: "left-0 top-1/2 -translate-y-1/2" },
  ];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]" role="img" aria-label="Four agents connected around one incident through a Switch room">
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <circle cx="50" cy="50" r="33" fill="none" className="stroke-border-strong" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        {[[50, 12], [88, 50], [50, 88], [12, 50]].map(([x, y]) => (
          <line key={`${x}${y}`} x1="50" y1="50" x2={x} y2={y} className="stroke-border-strong" strokeWidth="0.35" />
        ))}
      </svg>
      <div className="absolute left-1/2 top-1/2 w-36 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-surface p-3 text-center shadow-xl">
        <p className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">Switch room</p>
        <p className="mt-1 text-xs font-medium">INC-42 · HTTP 500 on /register</p>
      </div>
      {agents.map((a) => (
        <div key={a.name} className={`absolute ${a.pos} rounded-md border bg-surface px-2.5 py-1.5 text-xs font-medium ${a.cls}`}>
          {a.name}
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="flex items-center gap-1">
            <a href="#how" className="hidden rounded px-2.5 py-1.5 text-sm text-fg-muted hover:text-fg sm:block">How it works</a>
            <a href="#why" className="hidden rounded px-2.5 py-1.5 text-sm text-fg-muted hover:text-fg sm:block">Why PATCHWORK</a>
            <Button asChild variant="primary" size="sm">
              <Link href="/dashboard">Open Workspace</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1.15fr_1fr] md:py-28">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted">
              <span className="size-1.5 rounded-full bg-accent" /> A team that fixes things together
            </p>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">Your engineering team, working as one.</h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-muted">
              From the first bug report to the final verified fix, specialized AI agents collaborate to investigate, repair, and test your software. All in one shared workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="primary" size="lg">
                <Link href="/dashboard">
                  Open Workspace <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#how">See How It Works</a>
              </Button>
            </div>
          </div>
          <AgentDiagram />
        </section>

        <section id="how" className="border-t border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">One incident, one Switch room, four agents and one human. Each step hands off to the next through the room, and every step is visible as it happens.</p>
            <ol className="mt-10 grid gap-3 md:grid-cols-5">
              {flow.map((s, i) => (
                <li key={s.label} className="relative rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-fg-subtle">0{i + 1}</span>
                    <s.icon className="size-4 text-accent" aria-hidden />
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-fg-muted">{s.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-fg-subtle">If QA fails a fix, its evidence goes back to the Fixer, up to three automatic attempts before a human is asked to step in.</p>
          </div>
        </section>

        <section id="why" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="text-2xl font-semibold tracking-tight">Why PATCHWORK</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {reasons.map((r) => (
                <div key={r.title} className="rounded-lg border border-border bg-surface p-5">
                  <r.icon className="size-5 text-accent" aria-hidden />
                  <h3 className="mt-3 text-sm font-semibold">{r.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{r.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-12 rounded-lg border border-border bg-surface p-6 md:flex md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold">PATCHWORK turns isolated AI coding assistants into a coordinated engineering team.</p>
                <p className="mt-1 text-sm text-fg-muted">Try it on the bundled demo repository: a sign-up endpoint that returns HTTP 500.</p>
              </div>
              <Button asChild variant="primary" className="mt-4 md:mt-0">
                <Link href="/incidents/new">
                  <GitPullRequest /> Report a Bug
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-fg-subtle md:flex-row md:items-center md:justify-between">
          <Logo />
          <div className="flex flex-wrap items-center gap-4">
            <a className="inline-flex items-center gap-1.5 hover:text-fg" href="https://github.com/emediong-etuk/patchwork">
              <Github className="size-3.5" /> GitHub
            </a>
            <a className="inline-flex items-center gap-1.5 hover:text-fg" href="https://github.com/emediong-etuk/patchwork#readme">
              <BookOpen className="size-3.5" /> Documentation
            </a>
            <a className="inline-flex items-center gap-1.5 hover:text-fg" href="https://www.wemakedevs.org/hackathons/switch">
              <Trophy className="size-3.5" /> Built for the Flip the Switch hackathon
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
