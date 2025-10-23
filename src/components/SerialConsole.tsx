import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type SerialCopyFailureReason = 'empty' | 'unsupported' | 'error';

export interface SerialCopyResult {
  success: boolean;
  reason?: SerialCopyFailureReason;
  error?: string;
}

interface SerialConsoleProps {
  log: string;
  placeholder?: string;
  onCopyResult?: (result: SerialCopyResult) => void;
  clipboard?: Pick<Clipboard, 'writeText'> | null;
}

interface FeedbackState {
  message: string;
  tone: 'info' | 'success' | 'error';
}

const DEFAULT_PLACEHOLDER = 'Waiting for serial output…';

const SerialConsole: React.FC<SerialConsoleProps> = ({
  log,
  placeholder = DEFAULT_PLACEHOLDER,
  onCopyResult,
  clipboard
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isCopying, setIsCopying] = useState(false);

  const trimmedLog = useMemo(() => log.trim(), [log]);
  const hasOutput = trimmedLog.length > 0;
  const displayText = hasOutput ? log : placeholder;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timer = window.setTimeout(() => setFeedback(null), 2400);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const fallbackCopy = useCallback(() => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = log;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      document.body.appendChild(textarea);
      const selection = document.getSelection();
      const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      textarea.select();
      const succeeded = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (currentRange && selection) {
        selection.removeAllRanges();
        selection.addRange(currentRange);
      }
      if (!succeeded) {
        return false;
      }
      return true;
    } catch (error) {
      console.warn('SerialConsole fallback copy failed', error);
      return false;
    }
  }, [log]);

  const copyToClipboard = useCallback(async () => {
    if (isCopying) {
      return;
    }
    if (!hasOutput) {
      const result: SerialCopyResult = { success: false, reason: 'empty' };
      setFeedback({ message: 'No serial output captured yet.', tone: 'info' });
      onCopyResult?.(result);
      return;
    }

    setIsCopying(true);

    try {
      const clipboardApi =
        clipboard === undefined ? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined) : clipboard;
      if (clipboardApi?.writeText) {
        await clipboardApi.writeText(log);
        setFeedback({ message: 'Serial log copied to clipboard.', tone: 'success' });
        onCopyResult?.({ success: true });
      } else {
        const succeeded = fallbackCopy();
        if (succeeded) {
          setFeedback({ message: 'Serial log copied to clipboard.', tone: 'success' });
          onCopyResult?.({ success: true });
        } else {
          setFeedback({ message: 'Clipboard access is not available.', tone: 'error' });
          onCopyResult?.({ success: false, reason: 'unsupported' });
        }
      }
    } catch (error) {
      const message = (error as Error)?.message ?? 'Unknown clipboard error';
      setFeedback({ message: 'Failed to copy serial log.', tone: 'error' });
      onCopyResult?.({ success: false, reason: 'error', error: message });
    } finally {
      setIsCopying(false);
    }
  }, [clipboard, fallbackCopy, hasOutput, isCopying, log, onCopyResult]);

  return (
    <div className="serial-console">
      <div className="console-feed" ref={viewportRef} aria-live="polite">
        <pre>{displayText}</pre>
      </div>
      <div className="console-actions">
        {feedback && (
          <span className={`console-actions__feedback console-actions__feedback--${feedback.tone}`}>
            {feedback.message}
          </span>
        )}
        <button type="button" onClick={copyToClipboard} disabled={!hasOutput || isCopying}>
          {isCopying ? 'Copying…' : 'Copy serial log'}
        </button>
      </div>
    </div>
  );
};

export default SerialConsole;
