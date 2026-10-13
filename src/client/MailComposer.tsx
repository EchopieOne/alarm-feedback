import { AlertCircle, Check, Mail, RotateCcw, Send, Sparkles } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { EmailReceipt, MailContent } from "../worker/types";
import { api, getErrorMessage } from "./api";

export function MailComposer() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState<MailContent | null>(null);
  const [status, setStatus] = useState<{ type: "idle" | "loading" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const busy = useRef(false);
  const isLoading = status.type === "loading";
  const StatusIcon = status.type === "error" ? AlertCircle : status.type === "success" ? Check : Sparkles;

  async function polish() {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    setStatus({ type: "loading", message: "AI 正在润色邮件" });
    try {
      const data = await api<{ draft: MailContent }>("/api/mail/optimize", {
        method: "POST",
        body: { subject, text }
      });
      setOriginal({ subject, text });
      setSubject(data.draft.subject);
      setText(data.draft.text);
      setStatus({ type: "success", message: "润色完成，可继续编辑后发送" });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      busy.current = false;
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setStatus({ type: "loading", message: "正在提交邮件发送" });
    try {
      const data = await api<{ receipt: EmailReceipt }>("/api/mail/send", {
        method: "POST",
        body: { to, subject, text }
      });
      setTo("");
      setSubject("");
      setText("");
      setOriginal(null);
      setStatus({ type: "success", message: data.receipt.id ? `邮件已提交发送，编号：${data.receipt.id}` : "邮件已提交发送" });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    } finally {
      busy.current = false;
    }
  }

  function restore() {
    if (!original) return;
    setSubject(original.subject);
    setText(original.text);
    setOriginal(null);
    setStatus({ type: "idle", message: "" });
  }

  return (
    <form className="detailPanel composePanel" onSubmit={send}>
      <div className="detailHeader">
        <div>
          <span className="eyebrow">新邮件</span>
          <h2>写邮件</h2>
          <p className="sourceMeta">输入正文，AI 帮你调整表达。</p>
        </div>
        <Mail size={22} />
      </div>

      <fieldset className="composeFields" disabled={isLoading}>
        <label className="fieldBlock">
          收件人
          <input type="email" required maxLength={254} value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com" autoComplete="email" />
        </label>
        <label className="fieldBlock">
          主题
          <input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="输入主题，也可由 AI 根据正文生成" />
        </label>
        <label className="fieldBlock">
          邮件正文
          <textarea rows={14} required maxLength={20_000} value={text} onChange={(event) => setText(event.target.value)} placeholder="写下你想发送的内容，润色后仍可自由修改。" />
        </label>
        <p className="composeHint">AI 会保留原文语言和含义。请核对最终内容后发送。</p>
      </fieldset>

      {status.message && (
        <div className={`statusBanner ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
          <StatusIcon size={16} />{status.message}
        </div>
      )}

      <div className="actionRow">
        {original && <button type="button" className="ghostButton restoreButton" onClick={restore} disabled={isLoading}><RotateCcw size={16} />恢复润色前内容</button>}
        <button type="button" className="secondaryButton" onClick={polish} disabled={!text.trim() || isLoading}><Sparkles size={16} />AI 润色</button>
        <button type="submit" className="primaryButton" disabled={!to.trim() || !subject.trim() || !text.trim() || isLoading}><Send size={16} />发送邮件</button>
      </div>
    </form>
  );
}
