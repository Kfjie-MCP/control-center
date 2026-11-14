import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP 管理中心",
  description: "MCP 服务、授权与凭据管理。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  icons: { icon: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#252a31"/><g fill="none" stroke="white" stroke-width="1.7"><rect x="12" y="5" width="8" height="7" rx="2"/><rect x="4" y="21" width="8" height="7" rx="2"/><rect x="20" y="21" width="8" height="7" rx="2"/><path d="M16 12v5M8 21v-4h16v4"/></g></svg>') },
};
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('mcp-manager-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}catch{}`;
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}} /></head><body>{children}</body></html>;
}
