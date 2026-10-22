import { resumeUserJobs } from "../app/lib/api-worker";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    const path = new URL(request.url).pathname;
    const identity = request.headers.get("oai-authenticated-user-id");
    const scheduledOnly = Boolean(env.JOB_RUNNER_SECRET) && request.headers.get("x-job-scheduled-only") === env.JOB_RUNNER_SECRET;
    if (!scheduledOnly && response.ok && identity && ["POST","DELETE"].includes(request.method) &&
      (request.method === "DELETE" || /^\/api\/(courses\/(import|\d+\/sync)|subtitles\/(process|lectures\/\d+\/process)|jobs\/(run|\d+\/retry)|udemy\/cookies)\/?$/.test(path))) {
      ctx.waitUntil(resumeUserJobs(identity).catch(() => console.error("Background job resume failed; durable checkpoint retained.")));
    }
    return response;
  },
};
