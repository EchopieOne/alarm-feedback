import { clearSessionCookie, createSessionCookie, isAuthenticated } from "./auth";
import { generateMailDraft, makeDraft } from "./ai";
import { sendEmail } from "./email";
import { deleteDraft, getDraft, listCases, saveDraft, updateCaseAfterSend, updateCaseAfterSubmit } from "./feishu";
import { RedisClient } from "./redis";
import type { Draft, Env, FeedbackCase } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url).catch((error) => json({ error: getErrorMessage(error) }, 500));
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await request.json<{ username?: string; password?: string }>();
    if (body.username !== env.ADMIN_USERNAME || body.password !== env.ADMIN_PASSWORD) {
      return json({ error: "用户名或密码错误" }, 401);
    }
    return json(
      { ok: true },
      200,
      { "Set-Cookie": await createSessionCookie(env) }
    );
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  if (!(await isAuthenticated(request, env))) {
    return json({ error: "未登录" }, 401);
  }

  const redis = new RedisClient(env.REDIS_URL);

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ username: env.ADMIN_USERNAME });
  }

  if (url.pathname === "/api/cases" && request.method === "GET") {
    return json({ cases: await listCases(env, redis) });
  }

  const match = url.pathname.match(/^\/api\/cases\/([^/]+)\/(optimize|draft|send|submit)$/);
  if (!match) return json({ error: "接口不存在" }, 404);

  const recordId = decodeURIComponent(match[1]);
  const action = match[2];

  if (action === "optimize" && request.method === "POST") {
    const body = await request.json<{ solution?: string }>();
    const solution = body.solution?.trim();
    if (!solution) return json({ error: "请输入解决方案" }, 400);

    const feedback = await findCase(env, redis, recordId);
    const mail = await generateMailDraft(env, feedback, solution);
    const draft = makeDraft(recordId, feedback.email, mail, solution);
    await saveDraft(redis, draft);
    return json({ draft });
  }

  if (action === "draft" && request.method === "PUT") {
    const draft = await readDraftBody(request, recordId);
    await saveDraft(redis, draft);
    return json({ draft });
  }

  if (action === "send" && request.method === "POST") {
    const body = await request.json<{ to?: string; subject?: string; html?: string; text?: string }>();
    const mail = validateMail(body);
    await sendEmail(env, mail);
    await updateCaseAfterSend(env, redis, recordId, mail);
    await deleteDraft(redis, recordId);
    return json({ ok: true });
  }

  if (action === "submit" && request.method === "POST") {
    const body = await request.json<{ solution?: string }>();
    const solution = body.solution?.trim();
    if (!solution) return json({ error: "请输入解决方案" }, 400);
    await updateCaseAfterSubmit(env, redis, recordId, solution);
    await deleteDraft(redis, recordId);
    return json({ ok: true });
  }

  return json({ error: "Method Not Allowed" }, 405);
}

async function findCase(env: Env, redis: RedisClient, recordId: string): Promise<FeedbackCase> {
  const cases = await listCases(env, redis);
  const feedback = cases.find((item) => item.recordId === recordId);
  if (!feedback) throw new Error("未找到该未处理 case");
  return feedback;
}

async function readDraftBody(request: Request, recordId: string): Promise<Draft> {
  const body = await request.json<Partial<Draft>>();
  const mail = validateMail(body);
  return {
    recordId,
    ...mail,
    solution: body.solution,
    updatedAt: new Date().toISOString()
  };
}

function validateMail(body: { to?: string; subject?: string; html?: string; text?: string }) {
  const to = body.to?.trim();
  const subject = body.subject?.trim();
  const html = body.html?.trim();
  const text = body.text?.trim();
  if (!to || !subject || !html || !text) {
    throw new Error("邮件收件人、主题、HTML 和文本内容均不能为空");
  }
  return { to, subject, html, text };
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      ...headers,
      "Cache-Control": "no-store"
    }
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
