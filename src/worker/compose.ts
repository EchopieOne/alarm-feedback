import { polishMailContent } from "./ai";
import { sendEmail } from "./email";
import type { Env, MailContent } from "./types";

export async function handleCompose(request: Request, env: Env, action: "optimize" | "send"): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405, { Allow: "POST" });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "请提供有效的邮件内容" }, 400);
  }

  const fields = body as Record<string, unknown>;
  const mail = readMailContent(fields);
  if (typeof mail === "string") return json({ error: mail }, 400);

  if (action === "optimize") {
    const draft = await polishMailContent(env, mail);
    const validated = readMailContent(draft);
    if (typeof validated === "string" || !draft.subject) {
      return json({ error: "AI 润色结果格式不正确，请重试" }, 502);
    }
    return json({ draft });
  }

  const to = typeof fields.to === "string" ? fields.to.trim() : "";
  if (to.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) {
    return json({ error: "请输入一个有效的收件人邮箱" }, 400);
  }
  if (!mail.subject) return json({ error: "请输入邮件主题" }, 400);

  const receipt = await sendEmail(env, { to, ...mail, html: textToHtml(mail.text) });
  return json({ ok: true, receipt });
}

function readMailContent(body: Record<string, unknown> | MailContent): MailContent | string {
  if (body.subject !== undefined && typeof body.subject !== "string") return "邮件主题格式不正确";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return "请输入邮件正文";
  if (text.length > 20_000) return "邮件正文不能超过 20000 字符";
  if (subject.length > 200 || /[\r\n]/.test(subject)) return "邮件主题须为单行，且不能超过 200 字符";
  return { subject, text };
}

function textToHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  return `<div style="font-family: sans-serif; line-height: 1.6">${escaped.replace(/\r\n|\r|\n/g, "<br>\n")}</div>`;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { ...headers, "Cache-Control": "no-store" } });
}
