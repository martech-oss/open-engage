import { createFileRoute } from "@tanstack/react-router";

import { routeStatusComponents } from "@/components/route-status";
import { contactOptionsQueryOptions } from "@/features/contacts/contact-api";
import {
  scoringCategoriesQueryOptions,
  scoringRulesQueryOptions,
} from "@/features/scoring/scoring-api";
import { ScoringRulesPage } from "@/features/scoring/scoring-rules-page";

export const Route = createFileRoute("/_app/scoring/rules")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(scoringRulesQueryOptions()),
      context.queryClient.ensureQueryData(scoringCategoriesQueryOptions()),
      context.queryClient.ensureQueryData(contactOptionsQueryOptions()),
    ]);
    return undefined;
  },
  ...routeStatusComponents,
  component: ScoringRulesPage,
});
