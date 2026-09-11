import { runScenarios } from "./helpers.mjs";

await runScenarios("architecture: client-permissions", [
  {
    name: "rejects direct client role equality used as permission logic",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (workspace: { role: string }) => workspace.role === "admin";\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects direct analyst role equality used as permission logic",
    files: {
      "apps/client/src/features/reports/permissions.ts":
        'export const canView = (workspace: { role: string }) => workspace.role === "analyst";\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects direct client role permission sets",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (role: string) => ["owner", "admin"].includes(role);\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects renamed client role equality",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (currentRole: string) => currentRole !== "viewer";\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects role equality through a local alias",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (workspace: { role: string }) => { const access = workspace.role; return access === "admin"; };\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects role equality through a destructuring alias",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (workspace: { role: string }) => { const { role: access } = workspace; return access !== "viewer"; };\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects aliased role collections used for permission lookup",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const canManage = (workspace: { role: string }) => { const access = workspace.role; const privileged = ["owner", "admin"]; return privileged.includes(access); };\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "rejects a client role Set even before its permission lookup",
    files: {
      "apps/client/src/features/settings/permissions.ts":
        'export const privileged = new Set(["owner", "admin"]);\n',
    },
    want: "server-provided capabilities",
  },
  {
    name: "allows role labels and role display values",
    files: {
      "apps/client/src/features/settings/role-labels.tsx":
        'const labels = { owner: "所有者", admin: "管理者" };\n' +
        "export const RoleLabel = ({ member }: { member: { role: string } }) => <span>{member.role}</span>;\n" +
        "void labels;\n",
    },
  },
  {
    name: "allows canonical role literals used only as display labels",
    files: {
      "apps/client/src/features/settings/role-labels.tsx":
        'const labels = { owner: "所有者", admin: "管理者", marketer: "マーケター", analyst: "分析者", viewer: "閲覧者" };\n' +
        "export const RoleLabel = ({ member }: { member: { role: string } }) => <span>{labels[member.role as keyof typeof labels]}</span>;\n",
    },
  },
  {
    name: "allows role aliases used only for labels",
    files: {
      "apps/client/src/features/settings/role-labels.tsx":
        'const labels: Record<string, string> = { owner: "所有者", admin: "管理者" };\n' +
        "export const RoleLabel = ({ workspace }: { workspace: { role: string } }) => { const access = workspace.role; return <span>{labels[access]}</span>; };\n",
    },
  },
  {
    name: "allows direct role logic in test fixtures",
    files: {
      "apps/client/src/features/settings/permissions.test.ts":
        'export const expected = ({ role }: { role: string }) => role === "admin";\n',
    },
  },
]);
