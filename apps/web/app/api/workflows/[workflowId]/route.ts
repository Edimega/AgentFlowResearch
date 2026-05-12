import { NextResponse } from "next/server";
import { getWorkflowView } from "../../../../lib/server/workflow-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await context.params;
  try {
    const workflow = await getWorkflowView(workflowId);
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
    }

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error("Unable to load workflow.", error);
    return NextResponse.json({ error: "Unable to load workflow. Check that the database schema is ready." }, { status: 500 });
  }
}
