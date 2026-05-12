import { NextResponse } from "next/server";
import { z } from "zod";
import { createWorkflowRun, listWorkflowViews } from "../../../lib/server/workflow-store";

export const runtime = "nodejs";

const CreateWorkflowRequestSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  goal: z.string().trim().min(12).max(4_000),
  format: z.enum(["executive_report", "comparison", "risk_report"]).optional(),
});

export async function GET() {
  try {
    const workflows = await listWorkflowViews();
    return NextResponse.json({ workflows });
  } catch (error) {
    console.error("Unable to list workflows.", error);
    return NextResponse.json({ error: "Unable to list workflows. Check that the database schema is ready." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const payload = CreateWorkflowRequestSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({ error: "Invalid workflow request.", details: payload.error.flatten() }, { status: 400 });
  }

  try {
    const workflow = await createWorkflowRun({
      goal: payload.data.goal,
      ...(payload.data.title ? { title: payload.data.title } : {}),
      ...(payload.data.format ? { format: payload.data.format } : {}),
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    console.error("Unable to create workflow.", error);
    return NextResponse.json({ error: "Unable to create workflow. Run database migrations and check server logs." }, { status: 500 });
  }
}
