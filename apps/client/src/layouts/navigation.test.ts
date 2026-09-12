import { describe, expect, it } from "vitest";

import { activeSection, isNavTabActive, navigationSections } from "./navigation";

describe("work navigation", () => {
  it.each([
    ["/dashboard", "モニター"],
    ["/reports", "分析"],
    ["/projects/p1", "施策"],
    ["/contacts", "顧客"],
    ["/companies/c1", "顧客"],
    ["/scoring/rules", "顧客"],
    ["/automations/a1", "配信・自動化"],
    ["/emails/tracking", "配信・自動化"],
    ["/emails/archive", "配信・自動化"],
    ["/emails/templates", "コンテンツ・接点"],
    ["/website/pages/p1", "コンテンツ・接点"],
    ["/deal-reports", "営業"],
    ["/tasks", "営業"],
    ["/settings", "設定"],
  ])("keeps %s in %s without changing its URL", (path, label) => {
    expect(activeSection(path)?.label).toBe(label);
  });
  it("distinguishes the two project views sharing one URL", () => {
    const section = navigationSections.find((section) => section.to === "/projects")!;
    const [projects, briefs] = section.tabs;
    expect(isNavTabActive("/projects", section, projects!)).toBe(true);
    expect(isNavTabActive("/projects", section, briefs!)).toBe(false);
    expect(isNavTabActive("/projects", section, briefs!, { view: "briefs" })).toBe(true);
    expect(isNavTabActive("/projects", section, projects!, { view: "briefs" })).toBe(false);
  });
  it("does not select a similarly prefixed unknown path", () => {
    expect(activeSection("/contacts-unknown")).toBeUndefined();
  });
});
