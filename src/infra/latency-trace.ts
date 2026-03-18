export type DiagnosticTraceIdentity = {
  channel?: string;
  accountId?: string;
  chatId?: number | string;
  messageId?: number | string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  provider?: string;
  model?: string;
};

export type LatencyTraceContext = DiagnosticTraceIdentity & {
  source?: "websocket" | "webhook";
  feishuMessageCreatedAtMs?: number;
  feishuEventReceivedAtMs?: number;
  gatewayQueuedAtMs?: number;
  workerStartedAtMs?: number;
  firstModelTokenAtMs?: number;
  finalReplyReadyAtMs?: number;
};
