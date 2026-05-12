import { NextResponse } from "next/server";
import { z } from "zod";
import { previewWorkflowPlan } from "../../../../lib/server/workflow-store";

export const runtime = "nodejs";

const PreviewWorkflowRequestSchema = z.object({
  goal: z.string().trim().min(12).max(4_000),
});

export async function POST(request: Request) {
  const payload = PreviewWorkflowRequestSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid preview request.", details: payload.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({ plan: previewWorkflowPlan(payload.data.goal) });
}

