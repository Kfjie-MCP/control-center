# MCP 服务中心

展示 MCP 服务，并提供连接地址、客户端配置和按需展开的接入信息。

React、Next.js、shadcn/ui、Tailwind CSS。服务列表在 `lib/services.ts` 中维护；收藏和复制记录仅保存在访问者的浏览器。页面不保存连接密码，也不管理服务器授权。

```bash
npm ci
npm run build
npm run preview
```

打开 `http://127.0.0.1:3185/auth-ui/preview/manager/`。

本地使用示例域名；HTTPS 部署默认使用当前访问域名，也可通过 `.env.local` 中的 `NEXT_PUBLIC_MCP_ORIGIN` 指定服务域名。公开源码不包含实际部署地址。

`out/` 可静态托管至 `/auth-ui/preview/manager/`。`npm run typecheck` 检查类型。
