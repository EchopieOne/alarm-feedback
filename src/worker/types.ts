export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetFetcher;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  FEISHU_APP_TOKEN?: string;
  FEISHU_TABLE_ID?: string;
  FEISHU_APP_TOKEN_1?: string;
  FEISHU_TABLE_ID_1?: string;
  FEISHU_SOURCE_NAME_1?: string;
  FEISHU_APP_TOKEN_2?: string;
  FEISHU_TABLE_ID_2?: string;
  FEISHU_SOURCE_NAME_2?: string;
  REDIS_URL: string;
  AI_API_KEY: string;
  AI_BASE_URL: string;
  AI_MODEL: string;
  ZEABUR_EMAIL_API_KEY: string;
  MAIL_FROM: string;
}

export interface Draft {
  recordId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  solution?: string;
  updatedAt: string;
}

export interface FeedbackCase {
  recordId: string;
  sourceId: string;
  sourceName: string;
  feedbackType: string;
  content: string;
  email: string;
  attachments: Attachment[];
  processed: boolean;
  submittedAt?: string;
  updatedAt?: string;
  draft?: Draft;
}

export interface Attachment {
  name: string;
  url?: string;
}
