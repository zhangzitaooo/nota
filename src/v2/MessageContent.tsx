import { Fragment } from "react";
import { MathText } from "./MathText";

import type { Block } from "./types";

type Sources = { blocks: Block[]; onPreview: (block: Block) => void };
function Inline({ text, blocks, onPreview }: Sources & { text: string }) {
  return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("`")
    ? <code key={i}>{part.slice(1, -1)}</code>
    : part.startsWith("**") ? <strong key={i}><Inline text={part.slice(2, -2)} blocks={blocks} onPreview={onPreview} /></strong>
    : <Fragment key={i}>{part.split(/(\[原文第\s*\d+\s*页\s*[·・]\s*[\w-]+\])/g).map((chunk, j) => {
      const citation = chunk.match(/^\[原文第\s*(\d+)\s*页\s*[·・]\s*([\w-]+)\]$/);
      const block = citation && blocks.find(b => b.id === citation[2] && b.page === Number(citation[1]));
      return block ? <button className="paper-citation" key={j} onClick={() => onPreview(block)}>原文第 {block.page} 页</button>
        : <MathText key={j} text={chunk} ranges={[]} />;
    })}</Fragment>)}</>;
}

// Deliberately small, React-rendered Markdown subset. Model HTML never executes.
export function MessageContent({ text, ...sources }: Sources & { text: string }) {
  return <>{text.split(/(```[\s\S]*?(?:```|$))/g).map((chunk, chunkIndex) => {
    if (chunk.startsWith("```")) {
      const code = chunk.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return <pre key={chunkIndex}><code>{code}</code></pre>;
    }
    const lines = chunk.split("\n"), blocks = [];
    for (let i = 0; i < lines.length;) {
      if (!lines[i].trim()) { i++; continue; }
      const heading = lines[i].match(/^#{1,6}\s+(.+)/);
      if (heading) { blocks.push(<h3 key={i}><Inline {...sources} text={heading[1]} /></h3>); i++; continue; }
      const list = lines[i].match(/^\s*(?:([-*])|\d+[.)])\s+(.+)/);
      if (list) {
        const ordered = !list[1], start = Number(lines[i].match(/^\s*(\d+)/)?.[1] || 1), items = [], index = i;
        const pattern = ordered ? /^\s*\d+[.)]\s+(.+)/ : /^\s*[-*]\s+(.+)/;
        while (i < lines.length) { const match = lines[i].match(pattern); if (!match) break; items.push(<li key={i}><Inline {...sources} text={match[1]} /></li>); i++; }
        blocks.push(ordered ? <ol key={index} start={start}>{items}</ol> : <ul key={index}>{items}</ul>); continue;
      }
      const paragraph = [], index = i;
      while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|[-*]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
      if (!paragraph.length) paragraph.push(lines[i++]);
      blocks.push(<p key={index}><Inline {...sources} text={paragraph.join("\n")} /></p>);
    }
    return <Fragment key={chunkIndex}>{blocks}</Fragment>;
  })}</>;
}
