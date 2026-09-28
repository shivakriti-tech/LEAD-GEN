/** Small line icons (24px grid, currentColor), so buttons read at a glance. */
const I = ({ d, size = 16, fill }: { d: string; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
);

export const IconPhone = () => <I d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />;
export const IconWhatsApp = () => (
  <I fill d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" />
);
export const IconMail = () => <I d="M3 6h18v12H3zM3 7l9 6 9-6" />;
export const IconMap = () => <I d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />;
export const IconCopy = () => <I d="M9 9h11v11H9zM5 15H4V4h11v1" />;
export const IconClose = () => <I d="M6 6l12 12M18 6 6 18" />;
export const IconEdit = () => <I d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />;
export const IconDownload = () => <I d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />;
export const IconStop = () => <I fill d="M7 7h10v10H7z" />;
export const IconSettings = () => <I d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />;
export const IconHistory = () => <I d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />;
export const IconLink = () => <I d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />;
export const IconCheck = () => <I d="m5 12 4.5 4.5L19 7" />;
export const IconCross = () => <I d="M7 7l10 10M17 7 7 17" />;
export const IconSearch = () => <I d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4" />;
