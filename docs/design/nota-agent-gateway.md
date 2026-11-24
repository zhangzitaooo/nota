# Nota Agent 共享服务

当前已部署为私有 Cloudflare Worker + D1 网关，通过 Sites 维护。固定 `deepseek-flash`（DeepSeek V4.1 Flash），不开放 Pro。上游 DeepSeek Key 只存在云端 secret store，客户端、仓库和安装包不包含该 Key。


## 请求链路

Nota UI → 本机服务 → 本机回环 relay → 私有云网关 → 固定 DeepSeek Anthropic Messages 接口。

只有本机主进程读取安装凭证与 Sites 私有服务凭证。Harness 子进程只获得随机的进程级回环凭证，无法用该凭证直接访问云网关。回环 relay 仅监听 127.0.0.1，拒绝浏览器 Origin、错误 Host、无效凭证和未知路径；远程跳转不跟随。凭证文件位于应用数据目录的 0700 `credentials/`，文件权限为 0600，均在仓库外。

云端先验证 Sites 私有服务访问权限，再验证每台安装的随机凭证（仅存 SHA256、到期时间、禁用状态）。当前仅授权本机，2026-12-09 UTC 到期，没有公共注册和匿名调用。公开分发前需要增加用户登录、自动签发短期设备凭证，不能将共享 Sites 服务凭证放入安装包。

Harness 的对话与辅助模型搜索经过网关；匿名公开网页读取仍使用 Harness 本地网络工具。

## 防盗刷与停止服务

D1 事务集中扣减配额，多个 Worker 实例、重启和重新部署都不能重置额度。每台安装每分钟 12 次、并发 2 次；全局每分钟 24 次、并发 4 次。单次最多 512 KiB 请求、8192 输出 tokens、2 次原生搜索、120 秒。

每日保守预留额度为单安装 500,000、全局 1,000,000 单位；初始累计闸门为 100 次上游调用和 2,000,000 预留单位，任一到达即停止继续调用。一个用户问题可能触发多次工具后的模型调用，不能把此处的 100 次理解为 100 条用户消息。预留单位为输入字节 + 最大输出 tokens + 搜索预留量，失败也扣减；这是保守准入门槛，不是精确账单或金额上限。上游账户仍应设置独立消费上限。

托管配置全部通过 Sites 的 secret 环境变量维护：

- `NOTA_UPSTREAM_API_KEY`：上游服务端 Key。
- `NOTA_CLIENTS_JSON`：安装 id、tokenHash、expiresAt、disabled。
- `NOTA_SERVICE_ENABLED`：仅值 `1` 开通。

紧急停止：将 enabled 设为 `0` 并部署已有版本。撤销单台安装：在授权列表设 disabled 或移除条目，再部署。轮换上游 Key：只更新云端 secret 并重新部署，客户端无需更新。已应用的 D1 迁移不得改写；后续迁移追加。

## 本机配置与验证

`agent-gateway.json` 只保存 `url`、`tokenFile`、`serviceTokenFile` 路径，不含上游 Key。环境变量可替代这些路径：`NOTA_AGENT_GATEWAY_URL`、`NOTA_AGENT_TOKEN_FILE`、`NOTA_AGENT_SERVICE_TOKEN_FILE`。仅本地开发允许回环 HTTP，远程必须 HTTPS。

云 Worker 的五项真实 SQLite 测试覆盖鉴权、事务回滚、全局累计额度、并发名额在流结束/取消后释放、固定上游和请求上限。本仓库测试包括 relay 访问边界与真实 Harness 的模拟上游回归。显式真实服务验证脚本 `scripts/verify-nota-service.mjs <agent-gateway.json路径>` 会产生少量真实调用，不加入自动测试。
