import { researchEvaluationDataset } from "../../packages/evals/src";
import type { ResearchEvaluationCase } from "../../packages/evals/src";

function requireCase(caseId: string): ResearchEvaluationCase {
  const testCase = researchEvaluationDataset.find((item) => item.id === caseId);
  if (!testCase) {
    throw new Error(`Evaluation fixture is missing: ${caseId}`);
  }
  return testCase;
}

export const normalCase = requireCase("normal-001");
export const insufficientCase = requireCase("insufficient-001");
export const injectionCase = requireCase("injection-001");
export const contradictionCase = requireCase("contradiction-001");
