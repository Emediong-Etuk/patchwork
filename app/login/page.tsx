"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, ApiError } from "@/src/client/api";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";

const schema = z.object({ name: z.string().trim().min(2, "Enter your name"), email: z.string().trim().email("Enter a valid email"), accessCode: z.string().min(1, "Enter the access code") });
type Form = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: v });
      router.replace(next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed");
    }
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" autoComplete="name" className="mt-1" aria-invalid={!!formState.errors.name} {...register("name")} />
        <FieldError message={formState.errors.name?.message} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" className="mt-1" aria-invalid={!!formState.errors.email} {...register("email")} />
        <FieldError message={formState.errors.email?.message} />
      </div>
      <div>
        <Label htmlFor="accessCode">Access code</Label>
        <Input id="accessCode" type="password" className="mt-1" aria-invalid={!!formState.errors.accessCode} {...register("accessCode")} />
        <FieldError message={formState.errors.accessCode?.message} />
        <p className="mt-1.5 text-[11px] text-fg-subtle">Set by PATCHWORK_ACCESS_CODE on the server.</p>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <Button type="submit" variant="primary" className="w-full" loading={formState.isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-base font-semibold">Sign in to your workspace</h1>
          <p className="mb-5 mt-1 text-xs text-fg-subtle">Demo access: your name and email identify you on approvals and messages.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
