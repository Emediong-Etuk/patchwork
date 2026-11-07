"use client";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export type Me = {
  user: { id: string; email: string; name: string; avatar: string | null };
  github: { login: string } | null;
  workspaces: { id: string; name: string; _count: { incidents: number; repositories: number } }[];
};

type Ctx = { me: Me | undefined; workspaceId: string | null; setWorkspaceId: (id: string) => void; loading: boolean };
const WorkspaceCtx = createContext<Ctx>({ me: undefined, workspaceId: null, setWorkspaceId: () => {}, loading: true });

const KEY = "patchwork.workspace";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const [workspaceId, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!me) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* storage unavailable */
    }
    const valid = me.workspaces.find((w) => w.id === stored)?.id ?? me.workspaces[0]?.id ?? null;
    setId(valid);
  }, [me]);
  const value = useMemo<Ctx>(
    () => ({
      me,
      workspaceId,
      loading: isLoading || (!!me && !workspaceId && me.workspaces.length > 0),
      setWorkspaceId: (id) => {
        setId(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* ignore */
        }
      },
    }),
    [me, workspaceId, isLoading],
  );
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceCtx);
