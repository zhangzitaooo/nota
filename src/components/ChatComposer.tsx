import React, { useEffect, useRef, useState } from 'react';
import ContextPill from './ContextPill';

interface ChatComposerProps {
  selectedText: string;
  sending: boolean;
  onSend: (question: string) => Promise<void>;
  onClearSelection: () => void;
}

const ChatComposer: React.FC<ChatComposerProps> = ({
  selectedText,
  sending,
  onSend,
  onClearSelection,
}) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const inputEl = inputRef.current;
    if (!inputEl) return;
    const lineHeight = 24;
    const maxHeight = lineHeight * 10;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, maxHeight)}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const question = input.trim();
    setInput('');
    await onSend(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className={`chat-input-area ${selectedText ? 'has-context' : ''}`}>
      {selectedText && (
        <ContextPill
          text={selectedText}
          className="chat-input-context"
          onClear={onClearSelection}
        />
      )}
      <textarea
        ref={inputRef}
        className="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入你的问题..."
        rows={2}
      />
      <button
        className="chat-send-btn"
        onClick={handleSend}
        disabled={!input.trim() || sending}
        title={sending ? '发送中' : '发送'}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
};

export default ChatComposer;
