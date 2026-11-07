"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

const Ctx = createContext<{ repositoryId: string | null; setRepositoryId: (id: string | null) => void }>({ repositoryId: null, setRepositoryId: () => {} });

export function RepoFilterProvider({ children }: { children: ReactNode }) {
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  return <Ctx.Provider value={{ repositoryId, setRepositoryId }}>{children}</Ctx.Provider>;
}
export const useRepoFilter = () => useContext(Ctx);
