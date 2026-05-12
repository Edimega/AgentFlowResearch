import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);
const Locale = z.enum(["en-US", "es-CO"]).default("en-US");

export const toolSchemas = {
  searchSources: z.object({
    query: NonEmptyString.max(400),
    maxResults: z.number().int().min(1).max(10),
    locale: Locale,
    allowedDomains: z.array(NonEmptyString).max(20).optional(),
    includePrivateIndexes: z.literal(false).optional(),
  }),
  fetchSource: z.object({
    sourceId: NonEmptyString.max(120),
    url: z.string().url().refine((url) => /^https?:\/\//i.test(url), "Only HTTP(S) URLs are allowed."),
  }),
  evaluateSource: z.object({
    sourceId: NonEmptyString.max(120),
    content: NonEmptyString.max(40_000),
    credibility: z.enum(["primary", "secondary", "low", "malicious"]),
  }),
  generateReport: z.object({
    caseId: NonEmptyString.max(120),
    findings: z.array(
      z.object({
        claim: NonEmptyString.max(2_000),
        sourceIds: z.array(NonEmptyString.max(120)).min(1).max(8),
      }),
    ).min(1),
    locale: Locale,
  }),
} as const;

export type ToolSchemas = typeof toolSchemas;
