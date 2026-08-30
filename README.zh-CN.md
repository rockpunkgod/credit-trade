# Credit Trade

[English](README.md)

Credit Trade 是一个本地沙箱，用于构建厂商中立的、经授权 API 推理服务按量买卖平台。供应方登记其控制的接口端点，平台识别模拟服务，购买方获得版本化报价；随后，系统对模拟推理调用进行计量，并将结果记入借贷平衡的复式账本。

本仓库**不交易 API credits、个人订阅额度、促销余额或可转让储值**。

## 当前安全状态

| 能力 | 当前状态 |
|---|---|
| 供应方与购买方流程 | 仅限本地模拟沙箱 |
| 推理服务提供方 | 仅使用模拟端点；未启用任何真实厂商 |
| 购买方资金与供应方收益 | 仅为模拟账本分录；尚未实现提现，也没有真实资金流动 |
| 生产支付 | 不可用，且默认失败关闭 |
| 市场准入 | 所有未知或未经审查的组合均为 `PENDING_REVIEW` |
| GitHub Release | 尚未发布 |

未知的厂商、支付通道、供应方类型、市场或证据缺口均保持 `PENDING_REVIEW`。只有现行官方来源明确禁止的适用范围才会标记为 `PROHIBITED`；沙箱不会因为缺少信息就推定禁止。两种状态都不能解锁生产支付。

模拟流程只能作为技术测试证据，不能视为支付服务商沙箱验证、厂商授权、法律批准、市场运营资格或真实资金交易。

## 运行要求

- Node.js 24 或更高版本
- pnpm 11 或更高版本

当前内存版演示不需要 Docker、PostgreSQL、Redis、生产凭证或第三方账户。

不要将 API key、支付凭证、身份文件、合同或法律意见放入本仓库。未来的集成只能接受经批准的秘密管理器引用或环境变量名称，不能把秘密值写入源代码或文档。

先确认当前终端可以使用以下两个命令：

```powershell
node --version
pnpm --version
```

在 Codex Desktop 中，随附的 Node 运行时起初可能不在终端的 `PATH` 中。如果无法识别 `node --version`，可仅为当前 PowerShell 会话添加该路径：

```powershell
$creditTradeNodeBin = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$env:Path = "$creditTradeNodeBin;$env:Path"
```

## 本地运行

当前沙箱没有第三方运行时依赖。启动 API：

```powershell
pnpm start
```

在另一个终端中运行完整模拟流程：

```powershell
pnpm demo
```

演示程序会自行启动临时本地 API 进程，因此不必预先运行 `pnpm start`。它会按以下顺序调用已经实现的 HTTP 接口：

1. 创建模拟供应方；
2. 登记并识别其模拟推理端点；
3. 创建沙箱购买方，并获取仅展示一次的 API key；
4. 创建不可变报价并计算最大预占金额；
5. 发起模拟推理请求，完成预占、按实际用量结算并释放剩余金额；
6. 查看最终用量和保持借贷平衡的账本。

所有调用都不会离开本机，演示输出也不会打印原始 API key、完整提示词或完整模型输出。

运行自动化测试：

```powershell
pnpm test
```

API 默认监听 `http://127.0.0.1:3000`。已经实现的准确接口契约见 [`docs/api/openapi.yaml`](docs/api/openapi.yaml)。

模拟数据使用 10% 平台费，并以整数最小货币单位记录每 token 价格。这些只是演示值，不是已批准的商业条款。

## 初版限制

- 所有状态都保存在内存中，进程停止后会丢失。
- 只有 `mock://acme-ai` 和 `mock://contoso-ai` 可以执行模拟推理。
- 其他格式有效的端点会以 `PENDING_REVIEW` 状态登记，但系统绝不会连接或路由到这些端点。
- 购买方在请求报价时需要指定供应方端点；尚未实现多供应方自动路由。
- 尚未实现流式响应、取消、持久化、RBAC/MFA、退款、拒付、供应方提现及支付服务商沙箱适配器。

## 生产锁

当前版本没有生产支付适配器或生产推理适配器。前端开关或普通环境变量都不能让本沙箱获得生产能力。未来每个市场都必须分别完成运营主体、支付、KYC/KYB、制裁筛查、税务、隐私、数据驻留、厂商授权、双人批准和限额真实试点证据审查，之后才能启用任何真实资金功能。

预期市场包括中国大陆、中国香港、新加坡、美国和欧盟，目前均未上线。美国尚未限定州，欧盟尚未限定成员国；请求或资金绝不能在不同市场间故障转移。

## 仓库结构

- `apps/api`：本地 HTTP 控制面与推理接口
- `packages/core`：内存沙箱领域核心、定价、计量和账本逻辑
- `scripts/demo.ts`：可执行的端到端模拟流程
- `docs/api/openapi.yaml`：已经实现的 HTTP 契约
- `docs/compliance`：合规证据元数据规则；机密证据保留在 Git 之外
- `docs/security`：安全假设与风险登记
- `docs/runbooks`：运维与恢复说明

当前生命周期状态见 [`docs/project-status.md`](docs/project-status.md)，精确的外部恢复条件见 [`docs/blockers.md`](docs/blockers.md)。
