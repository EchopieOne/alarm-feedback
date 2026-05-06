import type { Env } from "./types";

export async function sendEmail(
  env: Env,
  mail: { to: string; subject: string; html: string; text: string }
): Promise<void> {
  const response = await fetch("https://api.zeabur.com/api/v1/zsend/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ZEABUR_EMAIL_API_KEY}`
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    })
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message) : response.statusText;
    throw new Error(`邮件发送失败: ${message}`);
  }
}
