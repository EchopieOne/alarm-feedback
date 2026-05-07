import net from "node:net";
import tls from "node:tls";

type RedisValue = string | null;

interface RedisParts {
  hostname: string;
  port: number;
  password?: string;
  secure: boolean;
}

export class RedisClient {
  private parts: RedisParts;

  constructor(url: string) {
    this.parts = parseRedisUrl(url);
  }

  async get(key: string): Promise<RedisValue> {
    const response = await this.command(["GET", key]);
    return typeof response === "string" ? response : null;
  }

  async mget(keys: string[]): Promise<RedisValue[]> {
    if (keys.length === 0) return [];
    const response = await this.command(["MGET", ...keys]);
    if (!Array.isArray(response)) return keys.map(() => null);
    return response.map((item) => typeof item === "string" ? item : null);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.command(["SETEX", key, String(seconds), value]);
  }

  async del(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  private async command(args: string[]): Promise<unknown> {
    const commands = this.parts.password
      ? [["AUTH", this.parts.password], args]
      : [args];
    return sendRedisCommand(this.parts, commands);
  }
}

async function sendRedisCommand(parts: RedisParts, commands: string[][]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const socket = parts.secure
      ? tls.connect({ host: parts.hostname, port: parts.port, servername: parts.hostname })
      : net.connect({ host: parts.hostname, port: parts.port });

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(10_000);
    const readyEvent = parts.secure ? "secureConnect" : "connect";
    socket.once(readyEvent, () => {
      socket.write(encodeCommands(commands), (error) => {
        if (error) {
          cleanup();
          reject(error);
        }
      });
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const text = decodeChunks(chunks);
      const parsed = parseAllResponses(text, commands.length);
      if (!parsed.complete) return;
      cleanup();
      if (parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      resolve(parsed.values[parsed.values.length - 1]);
    });
    socket.once("timeout", () => {
      cleanup();
      reject(new Error("Redis request timed out"));
    });
    socket.once("error", (error) => {
      cleanup();
      reject(error);
    });
    socket.once("end", () => {
      cleanup();
      reject(new Error("Redis response ended before command completed"));
    });
  });
}

function parseRedisUrl(value: string): RedisParts {
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must start with redis:// or rediss://");
  }
  return {
    hostname: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    secure: url.protocol === "rediss:"
  };
}

function encodeCommands(commands: string[][]): Uint8Array {
  const lines = commands
    .map((args) => {
      const parts = [`*${args.length}`];
      for (const arg of args) {
        parts.push(`$${new TextEncoder().encode(arg).length}`, arg);
      }
      return parts.join("\r\n");
    })
    .join("\r\n");
  return new TextEncoder().encode(`${lines}\r\n`);
}

function decodeChunks(chunks: Uint8Array[]): string {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

function parseAllResponses(text: string, expected: number) {
  const values: unknown[] = [];
  let cursor = 0;
  let error: string | undefined;

  while (values.length < expected) {
    const parsed = parseResponse(text, cursor);
    if (!parsed) return { complete: false, values, error };
    cursor = parsed.next;
    values.push(parsed.value);
    if (parsed.error) error = parsed.error;
  }

  return { complete: true, values, error };
}

function parseResponse(text: string, start: number): { value: unknown; next: number; error?: string } | null {
  const type = text[start];
  const lineEnd = text.indexOf("\r\n", start);
  if (lineEnd === -1) return null;
  const line = text.slice(start + 1, lineEnd);

  if (type === "+") return { value: line, next: lineEnd + 2 };
  if (type === "-") return { value: null, next: lineEnd + 2, error: line };
  if (type === ":") return { value: Number(line), next: lineEnd + 2 };
  if (type === "*") return parseArrayResponse(text, lineEnd + 2, Number(line));
  if (type !== "$") return { value: null, next: lineEnd + 2, error: `Unsupported Redis response: ${type}` };

  const length = Number(line);
  if (length === -1) return { value: null, next: lineEnd + 2 };

  const valueStart = lineEnd + 2;
  const valueEnd = valueStart + length;
  if (text.length < valueEnd + 2) return null;
  return { value: text.slice(valueStart, valueEnd), next: valueEnd + 2 };
}

function parseArrayResponse(
  text: string,
  start: number,
  length: number
): { value: unknown[] | null; next: number; error?: string } | null {
  if (length === -1) return { value: null, next: start };
  const values: unknown[] = [];
  let cursor = start;
  let error: string | undefined;

  for (let index = 0; index < length; index += 1) {
    const parsed = parseResponse(text, cursor);
    if (!parsed) return null;
    cursor = parsed.next;
    values.push(parsed.value);
    if (parsed.error) error = parsed.error;
  }

  return { value: values, next: cursor, error };
}
