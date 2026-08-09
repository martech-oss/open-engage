import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";

import { AutomationDesigner } from "./agents/automation-designer.ts";
import { EmailDesigner } from "./agents/email-designer.ts";
import { EmailSequenceDesigner } from "./agents/email-sequence-designer.ts";
import { Hello } from "./agents/hello.ts";
import { SegmentDesigner } from "./agents/segment-designer.ts";

const app = new Hono();

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to Hello with one POST per message:
//
//   curl -X POST http://localhost:5173/api/agents/hello/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route("/api/agents/hello", createAgentRouter(Hello));
app.route("/internal/automation-designer", createAgentRouter(AutomationDesigner));
app.route("/internal/email-designer", createAgentRouter(EmailDesigner));
app.route("/internal/email-sequence-designer", createAgentRouter(EmailSequenceDesigner));
app.route("/internal/segment-designer", createAgentRouter(SegmentDesigner));

export default app;
