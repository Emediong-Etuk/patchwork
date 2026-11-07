"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, Bot, Check, ChevronsUpDown, FolderGit2, LayoutDashboard, LifeBuoy, LogOut, Menu as MenuIcon, Plus, Settings, Siren, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/src/client/api";
import { useActivity, useRepositories, useSystemStatus } from "@/src/client/hooks";
import { RepoFilterProvider, useRepoFilter } from "@/src/client/repo-filter";
import { useWorkspace, WorkspaceProvider } from "@/src/client/workspace-context";
import { cn } from "@/src/utils/cn";
import { timeAgo } from "@/src/utils/format";
import { Logo } from "./logo";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { StatusDot } from "@/components/ui/misc";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function SwitchPill() {
  const { data } = useSystemStatus();
  if (!data) return <span className="hidden h-7 w-28 animate-soft-pulse rounded-md bg-surface-3 md:block" />;
  const live = data.switch.mode === "live";
  const ok = data.switch.connected;
  return (
    <Link href="/settings" className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted hover:text-fg md:flex" title={data.switch.detail}>
      <StatusDot tone={ok ? (live ? "success" : "warning") : "danger"} pulse={!ok} />
      {live ? (ok ? "Switch connected" : "Switch disconnected") : "Switch simulator"}
    </Link>
  );
}

function WorkspaceSelector() {
  const { me, workspaceId, setWorkspaceId } = useWorkspace();
  const current = me?.workspaces.find((w) => w.id === workspaceId);
  return (
    <Menu label="Select workspace" align="left" trigger={() => <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-surface-3"><span className="max-w-[140px] truncate">{current?.name ?? "Workspace"}</span> <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" /></span>}>
      {(close) => (
        <>
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-fg-subtle">Workspaces</p>
          {me?.workspaces.map((w) => (
            <MenuItem key={w.id} active={w.id === workspaceId} onSelect={() => (setWorkspaceId(w.id), close())}>
              {w.id === workspaceId ? <Check /> : <span className="w-4" />} {w.name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function RepositorySelector() {
  const { data: repos } = useRepositories();
  const { repositoryId, setRepositoryId } = useRepoFilter();
  const current = repos?.find((r) => r.id === repositoryId);
  return (
    <Menu label="Filter by repository" align="left" trigger={() => <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-3 sm:flex"><FolderGit2 className="size-3.5" />{current?.fullName ?? "All repositories"} <ChevronsUpDown className="size-3.5 text-fg-subtle" /></span>}>
      {(close) => (
        <>
          <MenuItem active={!repositoryId} onSelect={() => (setRepositoryId(null), close())}>
            {!repositoryId ? <Check /> : <span className="w-4" />} All repositories
          </MenuItem>
          {repos?.map((r) => (
            <MenuItem key={r.id} active={r.id === repositoryId} onSelect={() => (setRepositoryId(r.id), close())}>
              {r.id === repositoryId ? <Check /> : <span className="w-4" />} <span className="truncate">{r.fullName}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

const NOTIFY = ["APPROVAL_REQUESTED", "INCIDENT_BLOCKED", "INCIDENT_FAILED", "NEEDS_INFORMATION", "INCIDENT_RESOLVED", "PULL_REQUEST_CREATED"];

function Notifications() {
  const router = useRouter();
  const { data } = useActivity(15, NOTIFY);
  const [seenAt, setSeenAt] = useState(() => {
    try {
      return Number(localStorage.getItem("patchwork.notifications.seen") ?? 0);
    } catch {
      return 0;
    }
  });
  const unread = (data ?? []).filter((e) => new Date(e.createdAt).getTime() > seenAt).length;
  return (
    <Menu
      label="Notifications"
      className="w-80"
      trigger={() => (
        <span className="relative rounded-md p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg" onClick={() => {
          const now = Date.now();
          setSeenAt(now);
          try { localStorage.setItem("patchwork.notifications.seen", String(now)); } catch { /* ignore */ }
        }}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-white">{unread}</span>}
        </span>
      )}
    >
      {(close) => (
        <div className="max-h-96 overflow-y-auto scrollbar-thin">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-fg-subtle">Notifications</p>
          {!data?.length && <p className="px-2 py-4 text-center text-xs text-fg-subtle">Approval requests and blocked incidents will appear here.</p>}
          {data?.map((e) => (
            <button key={e.id} type="button" onClick={() => (e.incidentId && router.push(`/incidents/${e.incidentId}`), close())} className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-3">
              <p className="text-xs text-fg">{e.incident ? `INC-${e.incident.number} · ` : ""}{e.description}</p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">{timeAgo(e.createdAt)}</p>
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

function UserMenu() {
  const { me } = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const initials = me?.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() ?? "··";
  return (
    <Menu label="Account" trigger={() => <span className="flex size-7 items-center justify-center rounded-full border border-border bg-surface-3 text-[11px] font-semibold">{initials}</span>}>
      {() => (
        <>
          <div className="border-b border-border px-2 pb-2 pt-1">
            <p className="text-sm font-medium">{me?.user.name}</p>
            <p className="text-xs text-fg-subtle">{me?.user.email}</p>
            <p className="mt-1 text-[11px] text-fg-subtle">GitHub: {me?.github ? `@${me.github.login}` : "not connected"}</p>
          </div>
          <MenuItem onSelect={() => router.push("/settings")}>
            <Settings /> Settings
          </MenuItem>
          <MenuItem
            onSelect={async () => {
              await api("/api/auth/logout", { method: "POST" });
              qc.clear();
              router.replace("/login");
            }}
          >
            <LogOut /> Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {NAV.map((n) => {
        const active = path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href) && !(n.href === "/incidents" && path === "/incidents/new"));
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg", active && "bg-surface-3 text-fg")}>
            <n.icon className="size-4" /> {n.label}
          </Link>
        );
      })}
      <div className="mt-4 px-2.5">
        <Button asChild variant="primary" size="sm" className="w-full">
          <Link href="/incidents/new" onClick={onNavigate}>
            <Plus /> Report a Bug
          </Link>
        </Button>
      </div>
      <a href="https://github.com/emediong-etuk/patchwork#readme" className="mt-6 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-fg-subtle hover:text-fg">
        <LifeBuoy className="size-3.5" /> Documentation
      </a>
    </nav>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur">
        <button type="button" className="rounded p-1.5 text-fg-muted hover:bg-surface-3 lg:hidden" onClick={() => setMobile(true)} aria-label="Open navigation">
          <MenuIcon className="size-4" />
        </button>
        <Link href="/dashboard" className="mr-1 sm:mr-2">
          <Logo />
        </Link>
        <span className="text-border-strong max-sm:hidden">/</span>
        <WorkspaceSelector />
        <RepositorySelector />
        <div className="ml-auto flex items-center gap-2">
          <SwitchPill />
          <Notifications />
          <UserMenu />
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-52 shrink-0 border-r border-border lg:block">
          <Sidebar />
        </aside>
        {mobile && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobile(false)} />
            <aside className="absolute inset-y-0 left-0 w-60 border-r border-border bg-surface">
              <div className="flex h-12 items-center justify-between border-b border-border px-3">
                <Logo />
                <button type="button" onClick={() => setMobile(false)} aria-label="Close navigation" className="rounded p-1 text-fg-muted hover:bg-surface-3">
                  <X className="size-4" />
                </button>
              </div>
              <Sidebar onNavigate={() => setMobile(false)} />
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <RepoFilterProvider>
        <Shell>{children}</Shell>
      </RepoFilterProvider>
    </WorkspaceProvider>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-5">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
