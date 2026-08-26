import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import {
  gradingCriteriaQueryOptions,
  scoringCategoriesQueryOptions,
} from "@/features/scoring/scoring-api";
import { ScoringGradingPage } from "@/features/scoring/scoring-grading-page";

export const Route = createFileRoute("/_app/scoring/grading")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(gradingCriteriaQueryOptions()),
      context.queryClient.ensureQueryData(scoringCategoriesQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: ScoringGradingPage,
});
