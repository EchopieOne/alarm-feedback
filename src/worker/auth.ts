import type { Env } from "./types";

const COOKIE_NAME = "feedback_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export async function createSessionCookie(env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = String(expires);
  const signature = await sign(payload, env.SESSION_SECRET);
  return `${COOKIE_NAME}=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get("Cookie") || "";
  const raw = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!raw) return false;
  const [expires, signature] = raw.split(".");
  if (!expires || !signature) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(signature, await sign(expires, env.SESSION_SECRET));
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
