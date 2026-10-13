import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { default as worker } from "./src/worker/index.ts"; export { createSessionCookie } from "./src/worker/auth.ts"; export { generateMailDraft } from "./src/worker/ai.ts";',
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false
});
const { worker, createSessionCookie, generateMailDraft } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

// Deliberately omit Redis/Feishu configuration to catch accidental dependencies.
const env = {
  ASSETS: { fetch: async () => new Response("assets") },
  ADMIN_USERNAME: "test-admin",
  ADMIN_PASSWORD: "test-password",
  SESSION_SECRET: "test-session-secret",
  REDIS_URL: "",
  AI_API_KEY: "test-ai-key",
  AI_BASE_URL: "https://ai.example.test/v1/",
  AI_MODEL: "test-model",
  ZEABUR_EMAIL_API_KEY: "test-email-key",
  MAIL_FROM: "Alarm One <support@example.test>"
};
const cookie = (await createSessionCookie(env)).split(";")[0];
const mail = { to: "user@example.test", subject: "测试邮件", text: "第一行\n第二行" };

function call(action, body = mail, options = {}) {
  const method = options.method || "POST";
  return worker.fetch(new Request(`https://app.example.test/api/mail/${action}`, {
    method,
    headers: { "Content-Type": "application/json", ...(options.anonymous ? {} : { Cookie: cookie }) },
    body: method === "GET" ? undefined : options.raw ?? JSON.stringify(body)
  }), options.env || env);
}

function blockFetch(t) {
  return t.mock.method(globalThis, "fetch", async () => {
    assert.fail("This request must not contact any external service");
  });
}

function aiResponse(content) {
  return Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
}

test("both mail actions require a logged-in session", async (t) => {
  const mock = blockFetch(t);
  for (const action of ["optimize", "send"]) {
    const response = await call(action, mail, { anonymous: true });
    assert.equal(response.status, 401);
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("both actions reject other HTTP methods before reading a body", async (t) => {
  const mock = blockFetch(t);
  for (const action of ["optimize", "send"]) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await call(action, mail, { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "POST");
    }
  }
  assert.equal(mock.mock.callCount(), 0);
});

for (const [name, body] of [
  ["null", null], ["an array", []], ["a string", "mail"],
  ["empty text", { ...mail, text: "  " }],
  ["non-string text", { ...mail, text: 42 }],
  ["oversized text", { ...mail, text: "a".repeat(20_001) }],
  ["non-string subject", { ...mail, subject: {} }],
  ["oversized subject", { ...mail, subject: "a".repeat(201) }],
  ["a multiline subject", { ...mail, subject: "subject\r\nBcc: someone@example.test" }]
]) {
  test(`invalid content (${name}) never invokes AI or email`, async (t) => {
    const mock = blockFetch(t);
    for (const action of ["optimize", "send"]) assert.equal((await call(action, body)).status, 400);
    assert.equal(mock.mock.callCount(), 0);
  });
}

test("malformed JSON returns a useful validation error", async (t) => {
  blockFetch(t);
  const response = await call("send", mail, { raw: "{" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /有效的邮件内容/);
});

test("send requires a single valid recipient and a subject", async (t) => {
  const mock = blockFetch(t);
  for (const to of ["", "invalid", "first@example.test,second@example.test", "user@example.test\nBcc: other@example.test", 123]) {
    assert.equal((await call("send", { ...mail, to })).status, 400);
  }
  assert.equal((await call("send", { ...mail, subject: "" })).status, 400);
  assert.equal(mock.mock.callCount(), 0);
});

test("polish can generate a subject without a recipient and never sends email", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://ai.example.test/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-ai-key");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "test-model");
    assert.deepEqual(JSON.parse(request.messages[1].content), { subject: "", text: "请帮我检查更新后的闹钟。" });
    return aiResponse('```json\n{"subject":"更新后的闹钟","text":"请帮我检查更新后的闹钟是否正常。"}\n```');
  });
  const response = await call("optimize", { text: "请帮我检查更新后的闹钟。" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { draft: { subject: "更新后的闹钟", text: "请帮我检查更新后的闹钟是否正常。" } });
  assert.equal(mock.mock.callCount(), 1);
});

for (const [name, content] of [
  ["invalid JSON", "not json"], ["null JSON", "null"],
  ["missing fields", { subject: "Subject" }],
  ["incorrect field types", { subject: 42, text: "Body" }],
  ["oversized output", { subject: "Subject", text: "a".repeat(20_001) }],
  ["multiline subject", { subject: "Subject\nother", text: "Body" }]
]) {
  test(`bad AI output (${name}) cannot become a sendable draft`, async (t) => {
    const mock = t.mock.method(globalThis, "fetch", async () => aiResponse(content));
    const response = await call("optimize");
    assert.ok(response.status >= 500);
    assert.ok((await response.json()).error);
    assert.equal(mock.mock.callCount(), 1);
  });
}

test("AI provider errors surface without automatic retries", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Quota exceeded" } }, { status: 429 }));
  const response = await call("optimize");
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Quota exceeded/);
  assert.equal(mock.mock.callCount(), 1);
});

test("direct send uses the final edited text, environment sender, and safe HTML without AI or Redis", async (t) => {
  const edited = { to: " user@example.test ", subject: " Final subject ", text: 'Edited <script>alert("x")</script> & updated\r\nNext line' };
  const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.zeabur.com/api/v1/zsend/emails");
    assert.equal(options.headers.Authorization, "Bearer test-email-key");
    const request = JSON.parse(options.body);
    assert.equal(request.from, env.MAIL_FROM);
    assert.deepEqual(request.to, ["user@example.test"]);
    assert.equal(request.subject, "Final subject");
    assert.equal(request.text, edited.text);
    assert.ok(!request.html.includes("<script>"));
    assert.match(request.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; updated<br>\nNext line/);
    return Response.json({ id: "email-test-123", status: "pending" }, { status: 201 });
  });
  const response = await call("send", edited, { env: { ...env, AI_API_KEY: "", AI_MODEL: "", AI_BASE_URL: "" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, receipt: { id: "email-test-123", status: "pending" } });
  assert.equal(mock.mock.callCount(), 1);
});

test("the alternate email_id receipt is supported", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ email_id: "email-test-456", status: "queued" }));
  const response = await call("send");
  assert.equal((await response.json()).receipt.id, "email-test-456");
});

test("email rejection surfaces without success or automatic retries", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Sender not verified" }, { status: 403 }));
  const response = await call("send");
  assert.equal(response.status, 500);
  const result = await response.json();
  assert.equal(result.ok, undefined);
  assert.match(result.error, /Sender not verified/);
  assert.equal(mock.mock.callCount(), 1);
});

test("missing API configuration is reported before external requests", async (t) => {
  const mock = blockFetch(t);
  const ai = await call("optimize", mail, { env: { ...env, AI_API_KEY: "" } });
  assert.match((await ai.json()).error, /AI_API_KEY/);
  const email = await call("send", mail, { env: { ...env, MAIL_FROM: "" } });
  assert.match((await email.json()).error, /MAIL_FROM/);
  assert.equal(mock.mock.callCount(), 0);
});

test("session lookup works without Redis configuration", async (t) => {
  blockFetch(t);
  const response = await worker.fetch(new Request("https://app.example.test/api/me", { headers: { Cookie: cookie } }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: env.ADMIN_USERNAME });
});

test("feedback drafts still include the original feedback and solution with all three mail fields", async (t) => {
  const draft = { subject: "Reply", html: "<p>Try the update.</p>", text: "Try the update." };
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.originalFeedback, "Alarm is quiet.");
    assert.equal(input.internalSolution, "Install the update.");
    return aiResponse(draft);
  });
  const result = await generateMailDraft(env, { feedbackType: "Bug", email: mail.to, content: "Alarm is quiet." }, "Install the update.");
  assert.deepEqual(result, draft);
});
