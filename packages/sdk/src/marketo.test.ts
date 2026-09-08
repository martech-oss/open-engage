import { expectTypeOf, it } from "vitest";

import type {
  AutomationAudience,
  AutomationDefinition,
  AutomationDependency,
  AutomationEnrollmentDetail,
  AutomationExecutionSnapshot,
  AutomationRun,
  AutomationRunDetail,
  AutomationSchedule,
  OpenEngageClient,
  ProjectCloneJob,
  ProjectMember,
  ProjectMemberTransition,
  ProjectProgramDefinition,
  VariableDefinition,
  VariableRef,
  VariableSnapshot,
} from "./index";

it("exports program, variable, clone and automation types matching the public client", () => {
  type Projects = OpenEngageClient["projects"];
  type Automations = OpenEngageClient["automations"];
  expectTypeOf<
    Parameters<Projects["programSave"]>[0]["definition"]
  >().toEqualTypeOf<ProjectProgramDefinition>();
  expectTypeOf<
    Awaited<ReturnType<Projects["memberMutate"]>>["member"]
  >().toEqualTypeOf<ProjectMember>();
  expectTypeOf<
    Awaited<ReturnType<Projects["memberHistory"]>>[number]
  >().toEqualTypeOf<ProjectMemberTransition>();
  expectTypeOf<
    Awaited<ReturnType<Projects["variablesSave"]>>
  >().toEqualTypeOf<VariableDefinition>();
  expectTypeOf<
    Awaited<ReturnType<Projects["variablesList"]>>["effective"]
  >().toEqualTypeOf<VariableSnapshot>();
  expectTypeOf<
    Awaited<ReturnType<Projects["variablesUses"]>>[number]["references"][number]
  >().toEqualTypeOf<VariableRef>();
  expectTypeOf<Awaited<ReturnType<Projects["cloneGet"]>>>().toEqualTypeOf<ProjectCloneJob>();
  expectTypeOf<Awaited<ReturnType<Automations["startRun"]>>>().toEqualTypeOf<AutomationRun>();
  expectTypeOf<
    Awaited<ReturnType<Automations["runDetail"]>>
  >().toEqualTypeOf<AutomationRunDetail>();
  expectTypeOf<
    Awaited<ReturnType<Automations["enrollmentDetail"]>>
  >().toEqualTypeOf<AutomationEnrollmentDetail>();
  expectTypeOf<AutomationDependency["graph"]>().toEqualTypeOf<AutomationDefinition>();
  expectTypeOf<
    AutomationExecutionSnapshot["dependencies"][string]
  >().toEqualTypeOf<AutomationDependency>();
  type Batch = Extract<
    Extract<AutomationDefinition["nodes"][number], { type: "source" }>["config"],
    { source: "batch" }
  >;
  expectTypeOf<Batch["schedule"]>().toEqualTypeOf<AutomationSchedule>();
  expectTypeOf<Batch["audience"]>().toEqualTypeOf<AutomationAudience>();
});
