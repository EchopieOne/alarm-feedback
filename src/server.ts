import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import worker from "./worker/index";
import type { AssetFetcher, Env } from "./worker/types";

const port = Number(process.env.PORT || 8080);
const clientDir = path.resolve("dist/client");
const assets = createAssetFetcher(clientDir);

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = await toWebRequest(incoming);
    const response = await worker.fetch(request, makeEnv());
    await sendResponse(outgoing, response);
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: "Internal Server Error" }));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`alarm-feedback listening on :${port}`);
});

function makeEnv(): Env {
  return {
    ASSETS: assets,
    ADMIN_USERNAME: getEnv("ADMIN_USERNAME"),
    ADMIN_PASSWORD: getEnv("ADMIN_PASSWORD"),
    SESSION_SECRET: getEnv("SESSION_SECRET"),
    FEISHU_APP_TOKEN: process.env.FEISHU_APP_TOKEN,
    FEISHU_TABLE_ID: process.env.FEISHU_TABLE_ID,
    FEISHU_APP_TOKEN_1: process.env.FEISHU_APP_TOKEN_1,
    FEISHU_TABLE_ID_1: process.env.FEISHU_TABLE_ID_1,
    FEISHU_SOURCE_NAME_1: process.env.FEISHU_SOURCE_NAME_1,
    FEISHU_APP_TOKEN_2: process.env.FEISHU_APP_TOKEN_2,
    FEISHU_TABLE_ID_2: process.env.FEISHU_TABLE_ID_2,
    FEISHU_SOURCE_NAME_2: process.env.FEISHU_SOURCE_NAME_2,
    REDIS_URL: getEnv("REDIS_URL"),
    AI_API_KEY: getEnv("AI_API_KEY"),
    AI_BASE_URL: getEnv("AI_BASE_URL"),
    AI_MODEL: getEnv("AI_MODEL"),
    ZEABUR_EMAIL_API_KEY: getEnv("ZEABUR_EMAIL_API_KEY"),
    MAIL_FROM: getEnv("MAIL_FROM")
  };
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function toWebRequest(incoming: IncomingMessage): Promise<Request> {
  const host = incoming.headers.host || `localhost:${port}`;
  const forwardedProto = incoming.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const url = new URL(incoming.url || "/", `${protocol || "http"}://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, value);
    }
  }

  const method = incoming.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(incoming);
  return new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
}

function readBody(incoming: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.once("end", () => resolve(Buffer.concat(chunks)));
    incoming.once("error", reject);
  });
}

async function sendResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value);
  });

  if (!response.body) {
    outgoing.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  outgoing.end(body);
}

function createAssetFetcher(rootDir: string): AssetFetcher {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const filePath = resolveStaticPath(rootDir, url.pathname);

      try {
        const content = await readFile(filePath);
        return new Response(new Uint8Array(content), {
          headers: { "Content-Type": contentType(filePath) }
        });
      } catch {
        const content = await readFile(path.join(rootDir, "index.html"));
        return new Response(new Uint8Array(content), {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
    }
  };
}

function resolveStaticPath(rootDir: string, pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalized === "/" ? "index.html" : normalized.replace(/^[/\\]/, "");
  return path.join(rootDir, relativePath);
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".ico") return "image/x-icon";
  return "application/octet-stream";
}
