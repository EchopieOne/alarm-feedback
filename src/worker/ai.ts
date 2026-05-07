import type { Draft, Env, FeedbackCase } from "./types";

interface MailDraft {
  subject: string;
  html: string;
  text: string;
}

export async function generateMailDraft(env: Env, feedback: FeedbackCase, solution: string): Promise<MailDraft> {
  const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.AI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You write concise, professional customer support emails. Detect the primary language of the user's original feedback and reply in that language. If the feedback is Chinese, reply in Chinese. If it is English, reply in English. Return strict JSON only with subject, html, and text string fields. Do not wrap JSON in markdown. Our team is Alarm One."
        },
        {
          role: "user",
          content: JSON.stringify({
            feedbackType: feedback.feedbackType,
            userEmail: feedback.email,
            originalFeedback: feedback.content,
            internalSolution: solution
          })
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`AI 草稿生成失败: ${payload.error?.message || response.statusText}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 草稿生成失败: 响应为空");

  const parsed = parseJson(content);
  if (!parsed.subject || !parsed.html || !parsed.text) {
    throw new Error("AI 草稿生成失败: 响应缺少 subject/html/text");
  }

  return parsed;
}

export function makeDraft(
  recordId: string,
  to: string,
  mail: Pick<Draft, "subject" | "html" | "text">,
  solution?: string
): Draft {
  return {
    recordId,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    solution,
    updatedAt: new Date().toISOString()
  };
}

function parseJson(content: string): MailDraft {
  const trimmed = content.trim();
  const cleaned = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "") : trimmed;
  return JSON.parse(cleaned) as MailDraft;
}
