import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const createIncidentSchema = z.object({
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1, "Choose a repository"),
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(160),
  description: z.string().trim().min(20, "Describe the bug in at least 20 characters").max(10_000),
  errorMessage: optionalText(4_000),
  stackTrace: optionalText(20_000),
  reproductionSteps: optionalText(6_000),
  autoStart: z.boolean().default(true),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const humanMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  target: z.enum(["TRIAGE", "INVESTIGATOR", "FIXER", "QA"]).default("TRIAGE"),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(4_000) });
export const approveSchema = z.object({ createPullRequest: z.boolean().default(true), note: z.string().max(2000).optional() });
export const retrySchema = z.object({ guidance: z.string().trim().max(4_000).optional() });
