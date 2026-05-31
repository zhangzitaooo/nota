import React, { useState } from 'react';
import { ChatThread } from '../domain/types';
import ChatComposer from './ChatComposer';
import ChatMessages from './ChatMessages';

interface ChatPaneProps {
  chats: ChatThread[];
  activeChatId: string | null;
  selectedText: string;
  onSend: (question: string) => Promise<void>;
  onSelectChat: (chatId: string) => void;
  onClearSelection: () => void;
}

const ChatPane: React.FC<ChatPaneProps> = ({
  chats,
  activeChatId,
  selectedText,
  onSend,
  onSelectChat,
  onClearSelection,
}) => {
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  const handleSend = async (question: string) => {
    setSending(true);
    try {
      await onSend(question);
    } catch (error) {
      console.error('发送失败:', error);
    } finally {
      setSending(false);
    }
  };

  const handleCopyReply = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setToast('回复已拷贝到剪贴板');
    window.setTimeout(() => setToast(''), 1800);
  };

  return (
    <div className="chat-pane">
      <div className="chat-header">
        <span>AI 对话</span>
      </div>

      <ChatMessages
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={onSelectChat}
        onCopyReply={handleCopyReply}
      />

      <ChatComposer
        selectedText={selectedText}
        sending={sending}
        onSend={handleSend}
        onClearSelection={onClearSelection}
      />

      {toast && <div className="chat-toast" role="status">{toast}</div>}
    </div>
  );
};

export default ChatPane;
