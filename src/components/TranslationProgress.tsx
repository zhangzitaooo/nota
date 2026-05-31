import React from 'react';

interface TranslationProgressProps {
  stats: {
    total: number;
    done: number;
    failed: number;
    translating: number;
  };
}

const TranslationProgressBar: React.FC<TranslationProgressProps> = ({ stats }) => {
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="progress-screen">
      <div className="progress-card">
        <h2>正在处理论文...</h2>
        <p className="progress-step">解析 PDF 结构 → 逐段 AI 翻译</p>

        <div className="progress-bar-container">
          <div
            className="progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="progress-stats">
          <span>{percent}% 完成</span>
          <span className="progress-detail">
            {stats.done}/{stats.total} 段落已翻译
            {stats.translating > 0 && ` · ${stats.translating} 段翻译中`}
            {stats.failed > 0 && ` · ${stats.failed} 段失败`}
          </span>
        </div>

        {stats.total === 0 && (
          <p className="progress-waiting">等待解析结果...</p>
        )}
      </div>
    </div>
  );
};

export default TranslationProgressBar;
