import React from 'react';

interface ContextPillProps {
  text: string;
  className?: string;
  onClear?: () => void;
}

function truncateContext(text: string): string {
  let units = 0;
  let output = '';

  for (const char of text.trim()) {
    const nextUnits = /[\u4e00-\u9fff]/.test(char) ? 2 : 1;
    if (units + nextUnits > 24) {
      return `${output}...`;
    }
    units += nextUnits;
    output += char;
  }

  return output;
}

const ContextPill: React.FC<ContextPillProps> = ({
  text,
  className = '',
  onClear,
}) => {
  return (
    <span className={`chat-context-pill ${className}`} title={text}>
      <span className="chat-context-pill-text">{truncateContext(text)}</span>
      {onClear && (
        <button
          className="chat-context-clear"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          title="取消选中"
          type="button"
        >
          ×
        </button>
      )}
    </span>
  );
};

export default ContextPill;
