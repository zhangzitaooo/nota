import React from 'react';
import { AnnotationType } from '../domain/types';

interface SelectionToolbarProps {
  x: number;
  y: number;
  onAnnotate: (type: AnnotationType) => void;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  x,
  y,
  onAnnotate,
}) => {
  return (
    <div
      className="annotation-toolbar"
      style={{ left: x, top: y }}
    >
      <button
        className="toolbar-btn highlight-btn"
        onClick={() => onAnnotate('highlight')}
        title="高亮"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>
      <button
        className="toolbar-btn bold-btn"
        onClick={() => onAnnotate('bold')}
        title="加粗"
      >
        <strong>B</strong>
      </button>
    </div>
  );
};

export default SelectionToolbar;
