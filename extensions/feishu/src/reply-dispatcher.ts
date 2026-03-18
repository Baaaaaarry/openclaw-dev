import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  logLatencySegment,
  type ReplyPayload,
  type RuntimeEnv,
  type LatencyTraceContext,
} from "openclaw/plugin-sdk";
import { resolveFeishuAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { sendMediaFeishu } from "./media.js";
import type { MentionTarget } from "./mention.js";
import { buildMentionedCardContent } from "./mention.js";
import { getFeishuRuntime } from "./runtime.js";
import { sendMarkdownCardFeishu, sendMessageFeishu } from "./send.js";
import { FeishuStreamingSession } from "./streaming-card.js";
import { resolveReceiveIdType } from "./targets.js";
import { addTypingIndicator, removeTypingIndicator, type TypingIndicatorState } from "./typing.js";

/** Detect if text contains markdown elements that benefit from card rendering */
function shouldUseCard(text: string): boolean {
  return /```[\s\S]*?```/.test(text) || /\|.+\|[\r\n]+\|[-:| ]+\|/.test(text);
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  /** When true, preserve typing indicator on reply target but send messages without reply metadata */
  skipReplyToInMessages?: boolean;
  replyInThread?: boolean;
  rootId?: string;
  mentionTargets?: MentionTarget[];
  accountId?: string;
  latencyTrace?: LatencyTraceContext;
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const {
    cfg,
    agentId,
    chatId,
    replyToMessageId,
    skipReplyToInMessages,
    replyInThread,
    rootId,
    mentionTargets,
    accountId,
  } = params;
  const sendReplyToMessageId = skipReplyToInMessages ? undefined : replyToMessageId;
  const account = resolveFeishuAccount({ cfg, accountId });
  const prefixContext = createReplyPrefixContext({ cfg, agentId });
  const latencyTrace: LatencyTraceContext | undefined = params.latencyTrace
    ? {
        ...params.latencyTrace,
        channel: "feishu",
        accountId: account.accountId,
        chatId,
        messageId: params.latencyTrace.messageId ?? replyToMessageId,
      }
    : undefined;
  let firstModelReadyAtMs: number | undefined;
  let finalModelReadyAtMs: number | undefined;
  let firstAckLogged = false;

  const emitReturnLatency = (
    stage: string,
    startedAtMs: number | undefined,
    transport: "streaming-card" | "post" | "card",
  ) => {
    if (!startedAtMs) {
      return;
    }
    const endedAtMs = Date.now();
    if (endedAtMs < startedAtMs) {
      return;
    }
    logLatencySegment({
      segment: "t6_feishu_return",
      stage,
      durationMs: endedAtMs - startedAtMs,
      startedAtMs,
      endedAtMs,
      channel: latencyTrace?.channel ?? "feishu",
      accountId: latencyTrace?.accountId ?? account.accountId,
      chatId: latencyTrace?.chatId ?? chatId,
      messageId: latencyTrace?.messageId ?? replyToMessageId,
      sessionKey: latencyTrace?.sessionKey,
      sessionId: latencyTrace?.sessionId,
      runId: latencyTrace?.runId,
      provider: latencyTrace?.provider,
      model: latencyTrace?.model,
      transport,
    });
  };

  let typingState: TypingIndicatorState | null = null;
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // Check if typing indicator is enabled (default: true)
      if (!(account.config.typingIndicator ?? true)) {
        return;
      }
      if (!replyToMessageId) {
        return;
      }
      typingState = await addTypingIndicator({
        cfg,
        messageId: replyToMessageId,
        accountId,
        runtime: params.runtime,
      });
    },
    stop: async () => {
      if (!typingState) {
        return;
      }
      await removeTypingIndicator({ cfg, state: typingState, accountId, runtime: params.runtime });
      typingState = null;
    },
    onStartError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      }),
    onStopError: (err) =>
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "feishu", accountId, {
    fallbackLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({ cfg, channel: "feishu" });
  const renderMode = account.config?.renderMode ?? "auto";
  const streamingEnabled = account.config?.streaming !== false && renderMode !== "raw";

  let streaming: FeishuStreamingSession | null = null;
  let streamText = "";
  let lastPartial = "";
  let partialUpdateQueue: Promise<void> = Promise.resolve();
  let streamingStartPromise: Promise<void> | null = null;

  const startStreaming = () => {
    if (!streamingEnabled || streamingStartPromise || streaming) {
      return;
    }
    streamingStartPromise = (async () => {
      const creds =
        account.appId && account.appSecret
          ? { appId: account.appId, appSecret: account.appSecret, domain: account.domain }
          : null;
      if (!creds) {
        return;
      }

      streaming = new FeishuStreamingSession(createFeishuClient(account), creds, (message) =>
        params.runtime.log?.(`feishu[${account.accountId}] ${message}`),
      );
      try {
        await streaming.start(chatId, resolveReceiveIdType(chatId), {
          replyToMessageId,
          replyInThread,
          rootId,
        });
      } catch (error) {
        params.runtime.error?.(`feishu: streaming start failed: ${String(error)}`);
        streaming = null;
      }
    })();
  };

  const closeStreaming = async () => {
    if (streamingStartPromise) {
      await streamingStartPromise;
    }
    await partialUpdateQueue;
    if (streaming?.isActive()) {
      let text = streamText;
      if (mentionTargets?.length) {
        text = buildMentionedCardContent(mentionTargets, text);
      }
      await streaming.close(text);
      if (!firstAckLogged) {
        firstAckLogged = true;
        emitReturnLatency(
          "first_ack",
          firstModelReadyAtMs ?? finalModelReadyAtMs,
          "streaming-card",
        );
      }
      emitReturnLatency("final_ack", finalModelReadyAtMs, "streaming-card");
    }
    streaming = null;
    streamingStartPromise = null;
    streamText = "";
    lastPartial = "";
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        if (streamingEnabled && renderMode === "card") {
          startStreaming();
        }
        void typingCallbacks.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        const text = payload.text ?? "";
        const mediaList =
          payload.mediaUrls && payload.mediaUrls.length > 0
            ? payload.mediaUrls
            : payload.mediaUrl
              ? [payload.mediaUrl]
              : [];
        const hasText = Boolean(text.trim());
        const hasMedia = mediaList.length > 0;

        if (!hasText && !hasMedia) {
          return;
        }

        if (hasText) {
          if (!firstModelReadyAtMs) {
            firstModelReadyAtMs = Date.now();
          }
          if (info?.kind === "final") {
            finalModelReadyAtMs = Date.now();
            if (latencyTrace) {
              latencyTrace.finalReplyReadyAtMs = finalModelReadyAtMs;
            }
          }
          const useCard = renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

          if ((info?.kind === "block" || info?.kind === "final") && streamingEnabled && useCard) {
            startStreaming();
            if (streamingStartPromise) {
              await streamingStartPromise;
            }
          }

          if (streaming?.isActive()) {
            if (info?.kind === "final") {
              streamText = text;
              await closeStreaming();
            }
            // Send media even when streaming handled the text
            if (hasMedia) {
              for (const mediaUrl of mediaList) {
                await sendMediaFeishu({
                  cfg,
                  to: chatId,
                  mediaUrl,
                  replyToMessageId: sendReplyToMessageId,
                  replyInThread,
                  accountId,
                });
              }
            }
            return;
          }

          let first = true;
          if (useCard) {
            for (const chunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode,
            )) {
              await sendMarkdownCardFeishu({
                cfg,
                to: chatId,
                text: chunk,
                replyToMessageId: sendReplyToMessageId,
                replyInThread,
                mentions: first ? mentionTargets : undefined,
                accountId,
              });
              if (!firstAckLogged) {
                firstAckLogged = true;
                emitReturnLatency("first_ack", firstModelReadyAtMs, "card");
              }
              first = false;
            }
          } else {
            const converted = core.channel.text.convertMarkdownTables(text, tableMode);
            for (const chunk of core.channel.text.chunkTextWithMode(
              converted,
              textChunkLimit,
              chunkMode,
            )) {
              await sendMessageFeishu({
                cfg,
                to: chatId,
                text: chunk,
                replyToMessageId: sendReplyToMessageId,
                replyInThread,
                mentions: first ? mentionTargets : undefined,
                accountId,
              });
              if (!firstAckLogged) {
                firstAckLogged = true;
                emitReturnLatency("first_ack", firstModelReadyAtMs, "post");
              }
              first = false;
            }
          }
          if (info?.kind === "final") {
            emitReturnLatency("final_ack", finalModelReadyAtMs, useCard ? "card" : "post");
          }
        }

        if (hasMedia) {
          for (const mediaUrl of mediaList) {
            await sendMediaFeishu({
              cfg,
              to: chatId,
              mediaUrl,
              replyToMessageId: sendReplyToMessageId,
              replyInThread,
              accountId,
            });
          }
        }
      },
      onError: async (error, info) => {
        params.runtime.error?.(
          `feishu[${account.accountId}] ${info.kind} reply failed: ${String(error)}`,
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onCleanup: () => {
        typingCallbacks.onCleanup?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onAgentRunStart: (runId: string) => {
        if (latencyTrace) {
          latencyTrace.runId = runId;
        }
      },
      onModelSelected: (ctx: {
        provider: string;
        model: string;
        thinkLevel: string | undefined;
      }) => {
        prefixContext.onModelSelected?.(ctx);
        if (latencyTrace) {
          latencyTrace.provider = ctx.provider;
          latencyTrace.model = ctx.model;
        }
      },
      onPartialReply: streamingEnabled
        ? (payload: ReplyPayload) => {
            if (!firstModelReadyAtMs && payload.text && payload.text !== lastPartial) {
              firstModelReadyAtMs = Date.now();
              if (latencyTrace) {
                latencyTrace.firstModelTokenAtMs = firstModelReadyAtMs;
              }
            }
            if (!payload.text || payload.text === lastPartial) {
              return;
            }
            lastPartial = payload.text;
            streamText = payload.text;
            partialUpdateQueue = partialUpdateQueue.then(async () => {
              if (streamingStartPromise) {
                await streamingStartPromise;
              }
              if (streaming?.isActive()) {
                await streaming.update(streamText);
                if (!firstAckLogged) {
                  firstAckLogged = true;
                  emitReturnLatency("first_ack", firstModelReadyAtMs, "streaming-card");
                }
              }
            });
          }
        : undefined,
    },
    markDispatchIdle,
  };
}
