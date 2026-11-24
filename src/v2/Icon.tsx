type Name =
  | "globe"
  | "mail"
  | "info"
  | "quote"
  | "link"
  | "upload"
  | "refresh"
  | "minus"
  | "down"
  | "stop"
  | "settings"
  | "copy"
  | "compose"
  | "conversations"
  | "panelRight"
  | "edit"
  | "menu"
  | "book"
  | "chat"
  | "annotatedPage"
  | "note"
  | "close"
  | "plus"
  | "arrow"
  | "chevron"
  | "source"
  | "highlight"
  | "check"
  | "file"
  | "pause";
const paths: Record<Name, React.ReactNode> = {
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  mail: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 10.8v5m0-8.5v.1" /></>,
  quote: <path d="M4 13c0-4 2-7 5-8M4 13h5v6H4zM14 13c0-4 2-7 5-8m-5 8h5v6h-5z" />,
  link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
  upload: <path d="M12 16V3m-4 4 4-4 4 4M4 15v6h16v-6" />,
  refresh: <path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5M4 15a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />,
  minus: <path d="M5 12h14" />,
  down: <path d="M12 4v16m-6-6 6 6 6-6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  settings: <>
    <path strokeWidth="1.9" d="m9.7 3 .5-1h3.6l.5 1 .4 1.6 1.5.9 1.6-.5 1.1.1 1.8 3.1-.5 1-1.2 1.1v1.8l1.2 1.1.5 1-1.8 3.1-1.1.1-1.6-.5-1.5.9-.4 1.6-.5 1h-3.6l-.5-1-.4-1.6-1.5-.9-1.6.5-1.1-.1-1.8-3.1.5-1L5 12.2v-1.8L3.8 9.3l-.5-1 1.8-3.1 1.1-.1 1.6.5 1.5-.9z" />
    <circle cx="12" cy="11.4" r="3.1" strokeWidth="1.9" />
  </>,
  compose: <>
    <path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13" />
    <path d="m10 14 1-4 6.8-6.8a1.8 1.8 0 0 1 2.5 2.5L13.5 13z" />
  </>,
  conversations: <>
    <path d="M5.5 4h10A2.5 2.5 0 0 1 18 6.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-5.5 4v-4.8a2.5 2.5 0 0 1-.5-1.7v-6A2.5 2.5 0 0 1 5.5 4Z" />
    <path d="M21 9v6.5a2.5 2.5 0 0 1-2.5 2.5H18v3l-4.5-3H11" />
  </>,
  panelRight: <>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M15 5v14" />
  </>,
  edit: <path d="m14 4 6 6M4 20l5-1L21 7l-6-6L3 13z" />,
  menu: (
    <>
      <path d="M4 5h16v14H4zM9 5v14" />
    </>
  ),
  book: (
    <>
      <path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15" />
    </>
  ),
  chat: (
    <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 3v-3H3V6a2 2 0 0 1 2-2z" />
  ),
  annotatedPage: <>
    <rect x="4" y="2.75" width="16" height="18.5" rx="2.75" />
    <path d="M7.5 7.5h9M7.5 16.5h5" />
    <rect x="7" y="10" width="10" height="4" rx="1" fill="#e8c565" stroke="none" />
    <path d="M8 12.5h7" />
  </>,
  note: (
    <>
      <path d="M5 3h14v14l-4 4H5zM15 21v-5h4M8 8h8M8 12h6" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 20V4m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  source: (
    <>
      <path d="M14 3h7v7m0-7-11 11M10 4H4v16h16v-6" />
    </>
  ),
  highlight: (
    <>
      <path d="m14 3 7 7-10 10-7-7zM3 21h7M7 10l7 7" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  file: (
    <>
      <path d="M5 3h9l5 5v13H5zM14 3v6h5" />
    </>
  ),
  pause: <path d="M8 5v14M16 5v14" />,
};
export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
