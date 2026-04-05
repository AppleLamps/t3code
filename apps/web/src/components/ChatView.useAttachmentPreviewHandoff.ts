import type { MessageId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  collectUserMessageBlobPreviewUrls,
} from "./ChatView.logic";
import type { ChatMessage } from "../types";

const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5000;

export interface AttachmentPreviewHandoffResult {
  attachmentPreviewHandoffByMessageId: Record<string, string[]>;
  handoffAttachmentPreviews: (messageId: MessageId, previewUrls: string[]) => void;
  clearAttachmentPreviewHandoffs: () => void;
}

export function useAttachmentPreviewHandoff(input: {
  optimisticUserMessagesRef: React.RefObject<ChatMessage[]>;
}): AttachmentPreviewHandoffResult {
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({});

  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);

  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const timeoutId of Object.values(attachmentPreviewHandoffTimeoutByMessageIdRef.current)) {
      window.clearTimeout(timeoutId);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current = {};
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const messagesRef = input.optimisticUserMessagesRef;
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of messagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs, input.optimisticUserMessagesRef]);

  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    for (const previewUrl of previousPreviewUrls) {
      if (!previewUrls.includes(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });

    const existingTimeout = attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    if (typeof existingTimeout === "number") {
      window.clearTimeout(existingTimeout);
    }
    attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
      const currentPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId];
      if (currentPreviewUrls) {
        for (const previewUrl of currentPreviewUrls) {
          revokeBlobPreviewUrl(previewUrl);
        }
      }
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) return existing;
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      delete attachmentPreviewHandoffTimeoutByMessageIdRef.current[messageId];
    }, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
  }, []);

  return {
    attachmentPreviewHandoffByMessageId,
    handoffAttachmentPreviews,
    clearAttachmentPreviewHandoffs,
  };
}

// Re-export for convenience
export { collectUserMessageBlobPreviewUrls };
