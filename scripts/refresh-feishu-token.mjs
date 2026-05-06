import net from "node:net";
import tls from "node:tls";

const { FEISHU_APP_ID, FEISHU_APP_SECRET, REDIS_URL } = process.env;
const TOKEN_KEY = "feishu:tenant_access_token";

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET || !REDIS_URL) {
  throw new Error("FEISHU_APP_ID, FEISHU_APP_SECRET, and REDIS_URL are required");
}

const tokenResponse = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  })
});

const tokenPayload = await tokenResponse.json();
if (!tokenResponse.ok || tokenPayload.code !== 0 || !tokenPayload.tenant_access_token) {
  throw new Error(`Failed to fetch tenant_access_token: ${tokenPayload.msg || tokenResponse.statusText}`);
}

const ttl = Math.max(60, Number(tokenPayload.expire || 7200) - 300);
await redisCommand(REDIS_URL, ["SETEX", TOKEN_KEY, String(ttl), tokenPayload.tenant_access_token]);

console.log(`Refreshed ${TOKEN_KEY} with ttl=${ttl}s`);

async function redisCommand(redisUrl, args) {
  const url = new URL(redisUrl);
  const secure = url.protocol === "rediss:";
  const port = Number(url.port || (secure ? 6380 : 6379));
  const socket = secure
    ? tls.connect({ host: url.hostname, port })
    : net.connect({ host: url.hostname, port });

  await once(socket, "connect");

  const commands = url.password
    ? [["AUTH", decodeURIComponent(url.password)], args]
    : [args];

  socket.write(encodeCommands(commands));
  const response = await readUntilResponses(socket, commands.length);
  socket.end();

  const last = response.at(-1);
  if (last?.error) throw new Error(last.error);
}

function encodeCommands(commands) {
  return commands
    .map((args) => {
      const parts = [`*${args.length}`];
      for (const arg of args) {
        parts.push(`$${Buffer.byteLength(arg)}`, arg);
      }
      return `${parts.join("\r\n")}\r\n`;
    })
    .join("");
}

async function readUntilResponses(socket, expected) {
  let buffer = "";
  const responses = [];

  return await new Promise((resolve, reject) => {
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const parsed = parseResponse(buffer);
        if (!parsed) break;
        responses.push(parsed.response);
        buffer = buffer.slice(parsed.next);
        if (responses.length === expected) resolve(responses);
      }
    });
    socket.on("error", reject);
    socket.on("end", () => reject(new Error("Redis connection ended before response completed")));
  });
}

function parseResponse(text) {
  const type = text[0];
  const lineEnd = text.indexOf("\r\n");
  if (lineEnd === -1) return null;
  const line = text.slice(1, lineEnd);

  if (type === "+") return { response: { value: line }, next: lineEnd + 2 };
  if (type === "-") return { response: { error: line }, next: lineEnd + 2 };
  if (type === ":") return { response: { value: Number(line) }, next: lineEnd + 2 };
  if (type !== "$") return { response: { error: `Unsupported Redis response ${type}` }, next: lineEnd + 2 };

  const length = Number(line);
  if (length === -1) return { response: { value: null }, next: lineEnd + 2 };
  const valueStart = lineEnd + 2;
  const valueEnd = valueStart + length;
  if (text.length < valueEnd + 2) return null;
  return { response: { value: text.slice(valueStart, valueEnd) }, next: valueEnd + 2 };
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    target.once(event, resolve);
    target.once("error", reject);
  });
}
