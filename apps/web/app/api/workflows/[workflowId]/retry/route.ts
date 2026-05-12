import { NextResponse } from "next/server";
import { retryWorkflowRun } from "../../../../../lib/server/workflow-store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await context.params;
  try {
    const workflow = await retryWorkflowRun(workflowId);
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found or cannot be retried." }, { status: 404 });
    }

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error("Unable to retry workflow.", error);
    return NextResponse.json({ error: "Unable to retry workflow. Run database migrations and check server logs." }, { status: 500 });
  }
}
