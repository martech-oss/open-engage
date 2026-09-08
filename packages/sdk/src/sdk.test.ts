import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createOpenEngageClient,
  type MarketingCapabilitySnapshot,
  type OpenEngageClient,
  type ProjectBriefAllowedActions,
  type ProjectBriefDraftInput,
  type ProjectBriefMutation,
  type ProjectBriefReference,
} from "./index";

function exerciseProjectBriefContract(client: OpenEngageClient): void {
  void client.projects.briefWithdraw({
    id: "project-id",
    reason: "The owner needs to revise the brief",
    expectedRowVersion: 2,
  });
  void client.projects.briefSubmit({ id: "project-id", expectedRowVersion: 2 });
}

void exerciseProjectBriefContract;

describe("createOpenEngageClient", () => {
  it("transports scoring cursors and preserves page summaries", async () => {
    const requests: URL[] = [];
    const response = {
      items: [],
      total: 201,
      nextCursor: "rule-100",
      summary: { enabled: 201, pageActions: 2 },
    };
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "test-key",
      fetch: async (input, init) => {
        requests.push(new URL(new Request(input, init).url));
        return Response.json(response);
      },
    });
    expect(await client.scoring.listRules({ cursor: "rule-050", limit: 50 })).toEqual(response);
    expect(requests[0]?.pathname).toBe("/api/v1/scoring/rules");
    expect(requests[0]?.searchParams.get("cursor")).toBe("rule-050");
    expect(requests[0]?.searchParams.get("limit")).toBe("50");
    await client.scoring.listCriteria({ cursor: "criterion-100", limit: 100 });
    expect(requests[1]?.pathname).toBe("/api/v1/scoring/grading-criteria");
    expect(requests[1]?.searchParams.get("cursor")).toBe("criterion-100");
    expect(requests[1]?.searchParams.get("limit")).toBe("100");
  });
  it("exports the public project brief types without breaking the legacy alias", () => {
    expectTypeOf<ProjectBriefDraftInput>().toEqualTypeOf<ProjectBriefMutation>();
    expectTypeOf<ProjectBriefReference>().toMatchTypeOf<
      | { projectId: string; briefRevision: number }
      | { projectId?: undefined; briefRevision?: undefined }
    >();
    expectTypeOf<ProjectBriefAllowedActions["withdraw"]>().toEqualTypeOf<boolean>();
    expectTypeOf<MarketingCapabilitySnapshot["ga4Integration"]["state"]>().toEqualTypeOf<
      "unavailable" | "available" | "configured"
    >();
  });

  it("sends a workspace-scoped bearer token to /api/v1", async () => {
    let authorization = "";
    let url = "";
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        authorization = request.headers.get("authorization") ?? "";
        url = request.url;
        return Response.json([]);
      },
    });
    await client.segments.list();
    expect(authorization).toBe("Bearer openengage_abcdefghijkl_secret-secret-secret-secret");
    expect(url).toBe("https://openengage.example/api/v1/segments");
  });

  it("surfaces contract-defined errors as typed ORPCErrors", async () => {
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
      fetch: async () =>
        Response.json(
          { defined: true, code: "UNAUTHORIZED", status: 401, message: "ログインが必要です" },
          { status: 401 },
        ),
    });
    await expect(client.workspace.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
      defined: true,
    });
  });

  it("uses the v0.1 domain namespace and REST path", async () => {
    let method = "";
    let url = "";
    const client = createOpenEngageClient({
      baseUrl: "https://openengage.example",
      apiKey: "openengage_abcdefghijkl_secret-secret-secret-secret",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        method = request.method;
        url = request.url;
        return Response.json({ jobId: "job-id" }, { status: 202 });
      },
    });

    await client.contacts.startExport();

    expect(method).toBe("POST");
    expect(url).toBe("https://openengage.example/api/v1/contacts/exports");
  });
});
