# Nota Agent 共享服务

Nota 0.2.2 起默认使用公开试用网关。首次使用时，桌面端在自己的资料目录生成 256 位随机凭据，并以仅当前用户可读写的权限保存。网关按凭据的摘要隔离各安装的用量记录。原先配置过单独凭据的安装继续沿用其配置。

内置 DeepSeek Harness 经过本机回环 relay 访问网关。上游 Key 保存在云端。试用用户无需安装外部 Agent 或提供 Key。

## 防盗刷与停止服务

D1 事务集中扣减配额，多个 Worker 实例、重启和重新部署都不能重置额度。每台安装每分钟 12 次、并发 2 次；全局每分钟 24 次、并发 4 次。单次最多 512 KiB 请求、8192 输出 tokens、2 次原生搜索、120 秒。

0.2.3 起，每个安装凭据拥有 100 次免费提问。桌面端以同一问题编号预留一个名额，内置 Harness 成功完成且产出非空最终回答后确认扣次。工具调用、失败、停止和翻译不扣次。确认请求支持重放，未完成的问题预留会过期。客户端会在查询余额或下次提问时重试未送达的结算。旧版调用仍走原有共享调用上限，新版对话继续受并发、每日和累计 token 预算保护。

托管配置全部通过 Sites 的 secret 环境变量维护：

- `NOTA_UPSTREAM_API_KEY`：上游服务端 Key。
- `NOTA_CLIENTS_JSON`：安装 id、tokenHash、expiresAt、disabled。
- `NOTA_SERVICE_ENABLED`：仅值 `1` 开通。

紧急停止：将 enabled 设为 `0` 并部署已有版本。撤销手动授权的旧安装：在授权列表设 disabled 或移除条目，再部署。轮换上游 Key：只更新云端 secret 并重新部署，客户端无需更新。已应用的 D1 迁移不得改写；后续迁移追加。

## 本机配置与验证

`agent-gateway.json` 只保存 `url`、`tokenFile`、`serviceTokenFile` 路径，不含上游 Key。环境变量可替代这些路径：`NOTA_AGENT_GATEWAY_URL`、`NOTA_AGENT_TOKEN_FILE`、`NOTA_AGENT_SERVICE_TOKEN_FILE`。仅本地开发允许回环 HTTP，远程必须 HTTPS。

云 Worker 的 SQLite 测试覆盖鉴权、事务回滚、全局累计额度、并发名额在流结束/取消后释放、固定上游和请求上限。本仓库测试包括 relay 访问边界与真实 Harness 的模拟上游回归。显式真实服务验证脚本 `scripts/verify-nota-service.mjs <agent-gateway.json路径>` 会产生少量真实调用，不加入自动测试。
