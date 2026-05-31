import React, { useEffect, useRef } from 'react';
import { ChatThread } from '../domain/types';
import ContextPill from './ContextPill';
import MarkdownMessage from './MarkdownMessage';

interface ChatMessagesProps {
  chats: ChatThread[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onCopyReply: (content: string) => void;
}

const ChatMessages: React.FC<ChatMessagesProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  onCopyReply,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sortedChats = [...chats].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const conversationItems = sortedChats.flatMap((chat) =>
    chat.messages.map((message) => ({
      chat,
      message,
      showContext: message.role === 'user' && Boolean(chat.selectedText),
    }))
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationItems.length, activeChatId]);

  if (conversationItems.length === 0) {
    return <div className="chat-empty" />;
  }

  return (
    <div className="chat-messages">
      {conversationItems.map(({ chat, message, showContext }) => (
        <div
          key={`${chat.id}-${message.id}`}
          className={`chat-message chat-message-${message.role} ${
            message.status === 'pending' ? 'chat-message-pending' : ''
          }`}
          onClick={() => onSelectChat(chat.id)}
        >
          {showContext && (
            <ContextPill text={chat.selectedText} className="chat-message-context" />
          )}
          {message.status === 'pending' ? (
            <div className="chat-message-content chat-thinking">
              <span className="thinking-icon">💭</span>
              <span>思考中</span>
              <span className="thinking-dots" aria-hidden="true">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </div>
          ) : message.role === 'assistant' ? (
            <MarkdownMessage content={message.content} />
          ) : (
            <div className="chat-message-content">{message.content}</div>
          )}
          {message.role === 'assistant' && message.status !== 'pending' && (
            <button
              className="chat-copy-btn"
              onClick={(event) => {
                event.stopPropagation();
                onCopyReply(message.content);
              }}
              title="拷贝回复"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessages;
