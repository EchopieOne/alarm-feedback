import { AlertCircle, Archive, Bot, Check, FileText, Inbox, LogOut, Mail, Save, Send, Sparkles } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

interface Draft {
  recordId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  solution?: string;
  updatedAt: string;
}

interface FeedbackCase {
  recordId: string;
  sourceId: string;
  sourceName: string;
  feedbackType: string;
  content: string;
  email: string;
  attachments: Array<{ name: string; url?: string }>;
  processed: boolean;
  updatedAt?: string;
  draft?: Draft;
}

type Status = { type: "idle" | "loading" | "success" | "error"; message: string };

function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    api<{ username: string }>("/api/me")
      .then((data) => setUser(data.username))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) return <ShellLoading />;
  if (!user) return <Login onLogin={setUser} />;
  return <Workbench user={user} onLogout={() => setUser(null)} />;
}

function Login({ onLogin }: { onLogin: (user: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ type: "idle", message: "" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus({ type: "loading", message: "登录中" });
    try {
      await api("/api/login", { method: "POST", body: { username, password } });
      onLogin(username);
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    }
  }

  return (
    <main className="loginPage">
      <form className="loginPanel" onSubmit={submit}>
        <div className="brandMark"><Mail size={20} /></div>
        <h1>alarm-feedback</h1>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {status.type === "error" && <p className="errorLine">{status.message}</p>}
        <button className="primaryButton" disabled={status.type === "loading"}>
          登录
        </button>
      </form>
    </main>
  );
}

function Workbench({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [cases, setCases] = useState<FeedbackCase[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState<Status>({ type: "loading", message: "正在读取飞书反馈" });

  async function loadCases() {
    setStatus({ type: "loading", message: "正在读取飞书反馈" });
    try {
      const data = await api<{ cases: FeedbackCase[] }>("/api/cases");
      setCases(data.cases);
      setSelectedId((current) => current && data.cases.some((item) => item.recordId === current) ? current : data.cases[0]?.recordId || "");
      setStatus({ type: "idle", message: "" });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    void loadCases();
  }, []);

  const selected = cases.find((item) => item.recordId === selectedId);

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    onLogout();
  }

  function removeCase(recordId: string) {
    setCases((current) => current.filter((item) => item.recordId !== recordId));
    setSelectedId((current) => current === recordId ? cases.find((item) => item.recordId !== recordId)?.recordId || "" : current);
  }

  function updateDraft(recordId: string, draft: Draft) {
    setCases((current) => current.map((item) => item.recordId === recordId ? { ...item, draft } : item));
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="sidebarTop">
          <div className="workspaceBadge">SMS</div>
          <div>
            <strong>短信猎手</strong>
            <span>{user}</span>
          </div>
        </div>
        <nav className="navBlock">
          <span className="navLabel">Workspace</span>
          <button className="navItem active"><Inbox size={16} />alarm-feedback</button>
        </nav>
        <nav className="navBlock muted">
          <span className="navLabel">Coming soon</span>
          <button className="navItem" disabled><Archive size={16} />更多运营工具</button>
        </nav>
        <button className="logoutButton" onClick={logout}><LogOut size={16} />退出登录</button>
      </aside>

      <section className="contentShell">
        <header className="topbar">
          <div>
            <h1>alarm-feedback</h1>
            <p>处理未回复反馈，生成邮件草稿并回写飞书。</p>
          </div>
          <button className="ghostButton" onClick={loadCases}>刷新</button>
        </header>

        {status.type === "error" && <StatusBanner status={status} />}
        {status.type === "loading" && <StatusBanner status={status} />}

        <div className="workspaceGrid">
          <CaseList cases={cases} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? (
            <CaseDetail feedback={selected} onDraft={updateDraft} onSent={removeCase} />
          ) : (
            <EmptyState />
          )}
        </div>
      </section>
    </main>
  );
}

function CaseList({ cases, selectedId, onSelect }: { cases: FeedbackCase[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section className="caseList">
      <div className="panelHeader">
        <div>
          <h2>未处理反馈</h2>
          <span>{cases.length} cases</span>
        </div>
      </div>
      <div className="caseRows">
        {cases.map((item) => (
          <button
            key={item.recordId}
            className={`caseRow ${item.recordId === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(item.recordId)}
          >
            <span className="rowTop">
              <strong>{item.feedbackType || "反馈"}</strong>
              {item.draft && <em>草稿</em>}
            </span>
            <span className="sourceLine">{item.sourceName}</span>
            <span className="emailLine">{item.email || "无邮箱"}</span>
            <span className="summaryLine">{item.content || "无内容"}</span>
          </button>
        ))}
        {cases.length === 0 && <div className="emptyList">没有未处理反馈</div>}
      </div>
    </section>
  );
}

function CaseDetail({ feedback, onDraft, onSent }: { feedback: FeedbackCase; onDraft: (recordId: string, draft: Draft) => void; onSent: (recordId: string) => void }) {
  const [solution, setSolution] = useState(feedback.draft?.solution || "");
  const [to, setTo] = useState(feedback.draft?.to || feedback.email);
  const [subject, setSubject] = useState(feedback.draft?.subject || "");
  const [html, setHtml] = useState(feedback.draft?.html || "");
  const [text, setText] = useState(feedback.draft?.text || "");
  const [status, setStatus] = useState<Status>({ type: "idle", message: "" });

  useEffect(() => {
    setSolution(feedback.draft?.solution || "");
    setTo(feedback.draft?.to || feedback.email);
    setSubject(feedback.draft?.subject || "");
    setHtml(feedback.draft?.html || "");
    setText(feedback.draft?.text || "");
    setStatus({ type: "idle", message: "" });
  }, [feedback.recordId]);

  const canSend = useMemo(() => to && subject && html && text && status.type !== "loading", [to, subject, html, text, status.type]);

  async function optimize() {
    setStatus({ type: "loading", message: "AI 正在生成草稿" });
    try {
      const data = await api<{ draft: Draft }>(`/api/cases/${encodeURIComponent(feedback.recordId)}/optimize`, {
        method: "POST",
        body: { solution }
      });
      applyDraft(data.draft);
      setStatus({ type: "success", message: "草稿已生成并缓存" });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function save() {
    setStatus({ type: "loading", message: "正在保存草稿" });
    try {
      const data = await api<{ draft: Draft }>(`/api/cases/${encodeURIComponent(feedback.recordId)}/draft`, {
        method: "PUT",
        body: { to, subject, html, text, solution }
      });
      applyDraft(data.draft);
      setStatus({ type: "success", message: "草稿已保存" });
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function send() {
    setStatus({ type: "loading", message: "正在发送邮件并回写飞书" });
    try {
      await api(`/api/cases/${encodeURIComponent(feedback.recordId)}/send`, {
        method: "POST",
        body: { to, subject, html, text }
      });
      setStatus({ type: "success", message: "邮件已发送，飞书已更新" });
      onSent(feedback.recordId);
    } catch (error) {
      setStatus({ type: "error", message: getErrorMessage(error) });
    }
  }

  function applyDraft(draft: Draft) {
    setTo(draft.to);
    setSubject(draft.subject);
    setHtml(draft.html);
    setText(draft.text);
    setSolution(draft.solution || "");
    onDraft(feedback.recordId, draft);
  }

  return (
    <section className="detailPanel">
      <div className="detailHeader">
        <div>
          <span className="eyebrow">{feedback.feedbackType || "反馈"}</span>
          <h2>{feedback.email || "无邮箱"}</h2>
          <p className="sourceMeta">{feedback.sourceName}</p>
        </div>
        {feedback.draft && <span className="draftPill"><FileText size={14} />Redis 草稿</span>}
      </div>

      <div className="feedbackBox">
        <div className="miniTitle">用户反馈</div>
        <p>{feedback.content || "无反馈内容"}</p>
        {feedback.attachments.length > 0 && (
          <div className="attachments">
            {feedback.attachments.map((item, index) => item.url ? (
              <a href={item.url} key={`${item.name}-${index}`} target="_blank" rel="noreferrer">{item.name}</a>
            ) : (
              <span key={`${item.name}-${index}`}>{item.name}</span>
            ))}
          </div>
        )}
      </div>

      <label className="fieldBlock">
        解决方案
        <textarea rows={4} value={solution} onChange={(event) => setSolution(event.target.value)} placeholder="输入你希望如何解决问题，AI 会基于用户原文语言生成回复邮件。" />
      </label>

      <div className="actionRow">
        <button className="secondaryButton" onClick={optimize} disabled={!solution || status.type === "loading"}><Sparkles size={16} />AI 优化</button>
        <button className="ghostButton" onClick={save} disabled={!subject || status.type === "loading"}><Save size={16} />保存草稿</button>
        <button className="primaryButton" onClick={send} disabled={!canSend}><Send size={16} />发送邮件</button>
      </div>

      {status.message && <StatusBanner status={status} />}

      <div className="mailEditor">
        <label className="fieldBlock">
          收件人
          <input value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label className="fieldBlock">
          主题
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label className="fieldBlock">
          HTML
          <textarea rows={9} value={html} onChange={(event) => setHtml(event.target.value)} />
        </label>
        <label className="fieldBlock">
          Text
          <textarea rows={7} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
      </div>
    </section>
  );
}

function StatusBanner({ status }: { status: Status }) {
  const Icon = status.type === "success" ? Check : status.type === "error" ? AlertCircle : Bot;
  return <div className={`statusBanner ${status.type}`}><Icon size={16} />{status.message}</div>;
}

function EmptyState() {
  return (
    <section className="detailPanel emptyState">
      <Mail size={28} />
      <h2>选择一条反馈</h2>
      <p>未处理 case 会显示在左侧列表。</p>
    </section>
  );
}

function ShellLoading() {
  return <main className="loginPage"><div className="loadingText">加载中</div></main>;
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}

createRoot(document.getElementById("root")!).render(<App />);
