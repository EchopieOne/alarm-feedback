import { RedisClient } from "./redis";
import type { Attachment, Draft, Env, FeedbackCase } from "./types";

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const TOKEN_KEY = "feishu:tenant_access_token";
const FIELD_FEEDBACK_TYPE = "反馈类型";
const FIELD_CONTENT = "您对短信猎手有什么好的建议";
const FIELD_EMAIL = "Email";
const FIELD_ATTACHMENT = "附件";
const FIELD_PROCESSED = "处理";
const FIELD_FINAL_REPLY = "最终回复邮件";
const FEISHU_CODE_FIELD_NAME_NOT_FOUND = 1254045;
const FEISHU_FIELD_TYPE_TEXT = 1;
const FEISHU_FIELD_TYPE_CHECKBOX = 7;

interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
  last_modified_time?: string;
}

interface FeishuSource {
  id: string;
  name: string;
  appToken: string;
  tableId: string;
}

interface FeishuPayload {
  code?: number;
  msg?: string;
}

export async function listCases(env: Env, redis: RedisClient): Promise<FeedbackCase[]> {
  const token = await getTenantAccessToken(redis);
  const sources = getFeishuSources(env);
  const cases: FeedbackCase[] = [];

  for (const source of sources) {
    const records = await listSourceRecords(source, token);
    cases.push(...records.map((record) => mapRecordToCase(record, source)).filter((item) => !item.processed));
  }

  const withDrafts = await Promise.all(
    cases.map(async (item) => {
      const draft = await getDraft(redis, item.recordId);
      return draft ? { ...item, draft } : item;
    })
  );

  return withDrafts;
}

async function listSourceRecords(source: FeishuSource, token: string): Promise<BitableRecord[]> {
  const records: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${source.appToken}/tables/${source.tableId}/records/search`
    );
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const response = await fetch(url, {
      method: "POST",
      headers: feishuHeaders(token),
      body: JSON.stringify({})
    });
    const payload = await response.json<{
      code: number;
      msg?: string;
      data?: { items?: BitableRecord[]; page_token?: string; has_more?: boolean };
    }>();

    if (!response.ok || payload.code !== 0) {
      throw new Error(makeFeishuError("读取", source, response, payload));
    }

    records.push(...(payload.data?.items || []));
    pageToken = payload.data?.has_more ? payload.data.page_token : undefined;
  } while (pageToken);

  return records;
}

export async function updateCaseAfterSend(
  env: Env,
  redis: RedisClient,
  recordId: string,
  finalMail: Pick<Draft, "to" | "subject" | "html" | "text">
): Promise<void> {
  const token = await getTenantAccessToken(redis);
  const { source, rawRecordId } = resolveRecordSource(env, recordId);
  const sentAt = new Date().toISOString();
  const finalReply = JSON.stringify({ ...finalMail, sentAt }, null, 2);
  await updateRecordFields(source, token, rawRecordId, {
    [FIELD_PROCESSED]: true,
    [FIELD_FINAL_REPLY]: finalReply
  });
}

export async function updateCaseAfterSubmit(
  env: Env,
  redis: RedisClient,
  recordId: string,
  solution: string
): Promise<void> {
  const token = await getTenantAccessToken(redis);
  const { source, rawRecordId } = resolveRecordSource(env, recordId);
  const submittedAt = new Date().toISOString();
  const finalReply = JSON.stringify({ solution, submittedAt, delivery: "no_email" }, null, 2);
  await updateRecordFields(source, token, rawRecordId, {
    [FIELD_PROCESSED]: true,
    [FIELD_FINAL_REPLY]: finalReply
  });
}

async function updateRecordFields(
  source: FeishuSource,
  token: string,
  rawRecordId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const firstResult = await putRecordFields(source, token, rawRecordId, fields);
  if (isFeishuSuccess(firstResult.response, firstResult.payload)) return;

  if (firstResult.payload.code !== FEISHU_CODE_FIELD_NAME_NOT_FOUND) {
    throw new Error(makeFeishuError("回写", source, firstResult.response, firstResult.payload));
  }

  await ensureWritebackFields(source, token);
  const retryResult = await putRecordFields(source, token, rawRecordId, fields);
  if (!isFeishuSuccess(retryResult.response, retryResult.payload)) {
    throw new Error(makeFeishuError("回写", source, retryResult.response, retryResult.payload));
  }
}

async function putRecordFields(
  source: FeishuSource,
  token: string,
  rawRecordId: string,
  fields: Record<string, unknown>
): Promise<{ response: Response; payload: FeishuPayload }> {
  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${source.appToken}/tables/${source.tableId}/records/${rawRecordId}`,
    {
      method: "PUT",
      headers: feishuHeaders(token),
      body: JSON.stringify({ fields })
    }
  );
  const payload = await response.json<FeishuPayload>();
  return { response, payload };
}

async function ensureWritebackFields(source: FeishuSource, token: string): Promise<void> {
  const existingFields = await listTableFieldNames(source, token);
  if (!existingFields.has(FIELD_PROCESSED)) {
    await createTableField(source, token, FIELD_PROCESSED, FEISHU_FIELD_TYPE_CHECKBOX);
  }
  if (!existingFields.has(FIELD_FINAL_REPLY)) {
    await createTableField(source, token, FIELD_FINAL_REPLY, FEISHU_FIELD_TYPE_TEXT);
  }
}

async function listTableFieldNames(source: FeishuSource, token: string): Promise<Set<string>> {
  const names = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(`${FEISHU_BASE_URL}/bitable/v1/apps/${source.appToken}/tables/${source.tableId}/fields`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const response = await fetch(url, { headers: feishuHeaders(token) });
    const payload = await response.json<{
      code?: number;
      msg?: string;
      data?: { items?: Array<{ field_name?: string }>; page_token?: string; has_more?: boolean };
    }>();
    if (!isFeishuSuccess(response, payload)) {
      throw new Error(makeFeishuError("读取", source, response, payload));
    }

    for (const item of payload.data?.items || []) {
      if (item.field_name) names.add(item.field_name);
    }
    pageToken = payload.data?.has_more ? payload.data.page_token : undefined;
  } while (pageToken);

  return names;
}

async function createTableField(source: FeishuSource, token: string, fieldName: string, type: number): Promise<void> {
  const response = await fetch(
    `${FEISHU_BASE_URL}/bitable/v1/apps/${source.appToken}/tables/${source.tableId}/fields`,
    {
      method: "POST",
      headers: feishuHeaders(token),
      body: JSON.stringify({
        field_name: fieldName,
        type
      })
    }
  );
  const payload = await response.json<FeishuPayload>();
  if (!isFeishuSuccess(response, payload)) {
    throw new Error(makeFeishuError("回写", source, response, payload));
  }
}

export async function getTenantAccessToken(redis: RedisClient): Promise<string> {
  const token = await redis.get(TOKEN_KEY);
  if (!token) {
    throw new Error("Redis 中缺少 feishu:tenant_access_token，请检查 GitHub Actions token 刷新任务");
  }
  return token;
}

export async function getDraft(redis: RedisClient, recordId: string): Promise<Draft | undefined> {
  const raw = await redis.get(draftKey(recordId));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return undefined;
  }
}

export async function saveDraft(redis: RedisClient, draft: Draft): Promise<void> {
  await redis.setex(draftKey(draft.recordId), 60 * 60 * 24 * 7, JSON.stringify(draft));
}

export async function deleteDraft(redis: RedisClient, recordId: string): Promise<void> {
  await redis.del(draftKey(recordId));
}

function draftKey(recordId: string): string {
  return `draft:feedback:${recordId}`;
}

function feishuHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function isFeishuSuccess(response: Response, payload: FeishuPayload): boolean {
  return response.ok && payload.code === 0;
}

function makeFeishuError(
  action: "读取" | "回写",
  source: FeishuSource,
  response: Response,
  payload: { code?: number; msg?: string }
): string {
  const detail = payload.msg || response.statusText;
  const code = payload.code == null ? "" : ` code=${payload.code}`;
  const hint = response.status === 403 || detail.toLowerCase().includes("forbidden")
    ? "。请检查飞书开放平台是否已开通多维表格写权限，并确认该应用已被添加到目标多维表格/文档应用且有可编辑权限；权限变更后需要重新刷新 tenant_access_token。"
    : "";
  return `飞书${action}失败 (${source.name}): ${detail}${code}, status=${response.status}${hint}`;
}

function getFeishuSources(env: Env): FeishuSource[] {
  const candidates: Array<FeishuSource | undefined> = [
    makeSource(
      "source1",
      env.FEISHU_SOURCE_NAME_1 || "国内用户",
      env.FEISHU_APP_TOKEN_1 || env.FEISHU_APP_TOKEN,
      env.FEISHU_TABLE_ID_1 || env.FEISHU_TABLE_ID
    ),
    makeSource("source2", env.FEISHU_SOURCE_NAME_2 || "国外用户", env.FEISHU_APP_TOKEN_2, env.FEISHU_TABLE_ID_2)
  ];
  const sources = candidates.filter((source): source is FeishuSource => Boolean(source));
  if (sources.length === 0) {
    throw new Error("请至少配置一组飞书来源环境变量");
  }
  return sources;
}

function makeSource(id: string, name: string, appToken?: string, tableId?: string): FeishuSource | undefined {
  if (!appToken && !tableId) return undefined;
  if (!appToken || !tableId) {
    throw new Error(`${name} 需要同时配置 app token 和 table id`);
  }
  return { id, name, appToken, tableId };
}

function resolveRecordSource(env: Env, recordId: string): { source: FeishuSource; rawRecordId: string } {
  const sources = getFeishuSources(env);
  const separator = recordId.indexOf(":");
  if (separator === -1) {
    return { source: sources[0], rawRecordId: recordId };
  }

  const sourceId = recordId.slice(0, separator);
  const rawRecordId = recordId.slice(separator + 1);
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`未找到 record 来源: ${sourceId}`);
  }
  return { source, rawRecordId };
}

function mapRecordToCase(record: BitableRecord, source: FeishuSource): FeedbackCase {
  const fields = record.fields || {};
  return {
    recordId: `${source.id}:${record.record_id}`,
    sourceId: source.id,
    sourceName: source.name,
    feedbackType: stringifyField(fields[FIELD_FEEDBACK_TYPE]),
    content: stringifyField(fields[FIELD_CONTENT]),
    email: stringifyField(fields[FIELD_EMAIL]),
    attachments: parseAttachments(fields[FIELD_ATTACHMENT]),
    processed: Boolean(fields[FIELD_PROCESSED]),
    updatedAt: record.last_modified_time
  };
}

function stringifyField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyField).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.link === "string") return obj.link;
    return JSON.stringify(obj);
  }
  return String(value);
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      return {
        name: stringifyField(obj.name || obj.file_name || obj.token || "附件"),
        url: typeof obj.url === "string" ? obj.url : undefined
      };
    }
    return { name: stringifyField(item) || "附件" };
  });
}
