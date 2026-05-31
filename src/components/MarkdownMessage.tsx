import React from 'react';

interface MarkdownMessageProps {
  content: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function renderMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown.trim());
  const lines = escaped.split(/\n+/);
  const html: string[] = [];
  let listOpen = false;
  let listTag: 'ol' | 'ul' | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (ordered || unordered) {
      const nextTag = ordered ? 'ol' : 'ul';
      if (listOpen && listTag !== nextTag) {
        html.push(`</${listTag}>`);
        listOpen = false;
      }
      if (!listOpen) {
        html.push(`<${nextTag}>`);
        listOpen = true;
        listTag = nextTag;
      }
      html.push(`<li>${formatInlineMarkdown(ordered?.[2] || unordered?.[1] || '')}</li>`);
      continue;
    }

    if (listOpen) {
      html.push(`</${listTag}>`);
      listOpen = false;
      listTag = null;
    }
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  if (listOpen) {
    html.push(`</${listTag}>`);
  }

  return html.join('');
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <div
      className="chat-message-content chat-markdown"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
};

export default MarkdownMessage;
