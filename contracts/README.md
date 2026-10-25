# 微应用公共协议

本目录定义平台、微应用和后端之间共享的数据结构。结构来源为 [schema.json](schema.json)，版本和限额来源为 [release.json](../release.json)；消费者使用生成后登记在 `releases/3.0.0/` 中的固定材料。运行与消费方法见 [SDK README](../README.md)。

## 版本与数据边界

| 协议或值 | 当前版本 / 支持值 | 使用位置 |
| --- | --- | --- |
| SDK | `3.0.0` | JavaScript 客户端及发布材料版本 |
| `AppAuthorizationContext.contractVersion` | `1.0` | 平台返回给业务服务的应用授权上下文 |
| `MicroProps.contractVersion` | `2.0` | 宿主向前端微应用传递的业务上下文 |
| 通知 `contractVersion` | `1.0` | Socket.IO 上下文和实时通知 |
| `MicroEntryType` | `HTML` | qiankun HTML 入口 |
| `MicroRuntimeMode` | `TRUSTED` | 可信微应用同页运行 |

当前 Schema 不包含 iframe 通道版本、MessagePort、bridge 或宿主自定义 ESM 加载模式。`releases/1.0.0/` 中的旧协议属于历史归档；它不参与当前生成和运行时兼容判定。2.0.0 同样保留原始字节。当前 3.0.0 的系统 UUID 字段增加 v7 与 RFC variant 格式约束，wire 字段及独立协议版本不变。

`MicroPropsWire` 是可序列化的数据部分：SDK 版本、上下文版本与 epoch、两个期限、应用与路由、令牌、用户/租户/组织、组织范围、角色、权限、数据授权、主题及菜单。`MicroProps` 在它之上增加 `AbortSignal`、`onNavigate(path)` 和 `onNotify(message, variant?)`。令牌及上下文只能在其用途和有效期内使用。

`QiankunProps` 的 `platform` 包含完整 `MicroProps`，另有 `container`、可选应用名和可选 `services.downloadCsv`。`QiankunLifecycle` 使用标准单参数 `bootstrap` / `mount` / `unmount` / 可选 `update`。容器、signal、回调与宿主服务只存在 TypeScript 运行时模板中，不生成 Rust DTO，不通过 JSON 传输。

## Schema 与生成产物

源 Schema 使用 Draft 2020-12 结构，并通过 `x-release-sdk-version`、`x-release-contract`、`x-release-limit` 引用登记信息。`x-rust-tristate`、`x-rust-tag`、`x-preserve-additional` 指导当前专用生成器生成 Rust 字段或枚举。这些扩展不是交给通用校验器执行的约束。

| 产物 | 内容与用途 |
| --- | --- |
| `generated/schema.json` / 发布目录 `schema.json` | 已解析登记版本和限额的标准 JSON Schema |
| `generated/types.d.ts` / 发布目录 `types.d.ts` | wire 类型及浏览器运行时类型 |
| `generated/protocol.mjs`、`protocol.d.mts` | 版本、限额及 SDK 支持集合函数 |
| `generated/protocol.rs` / 发布目录 `protocol.rs` | 仅依赖 `serde`、`serde_json` 的 Rust DTO 和显式边界校验 |
| 发布目录 `artifact-manifest.json` | 每个交付文件的大小与 SHA-256 |

标准 Schema 的数据结构位于 `$defs`。校验某个协议时选择明确的定义，例如 `#/$defs/MicroPropsWire`，并按所用校验器配置启用 `date-time` 等 format 校验；仅将根 Schema 交给校验器并不能自动选择输入类型。Schema 不判断令牌真假、上下文是否已过期或调用者是否有权访问业务记录。

在 SDK 仓库根运行：

```sh
npm run build
npm run check
npm test
```

生成器支持当前仓库约定的 Schema 子集，运行时字段和部分验证为显式模板。新增 Schema 关键字后必须同时检查 TypeScript、Rust 与运行时验证，不假定生成器能编译任意 JSON Schema。消费者构建只读取自己固定的版本，不运行其他仓库的生成命令。

## Rust 消费与解析

将固定 `protocol.rs` 放入消费者的协议模块，通过显式模块导入使用；项目依赖 `serde`（启用 derive）与 `serde_json`。该模块不依赖平台 HTTP、数据库实现、令牌刷新或业务模型。

主要解析入口为：

- `AppAuthorizationContext::from_json(bytes)`：先限制输入为 1 MiB，再反序列化并校验必需标识、组织上限与数据授权数组限额。
- `AppAuthorizationContext::organization_ceiling()`：解释组织范围三态，返回硬上限。
- `MicroPropsWire::from_json(bytes)`：限制 1 MiB，要求显式存在 `organizationScopeIds`，检查正数安全整数 epoch、令牌、应用编码及 `/micro/{appCode}` 基路径等当前模板约束。
- `NotificationPublishBody::from_json(bytes)`：限制 1 MiB，校验幂等键、目标与文本边界。JavaScript 发布助手另有更小的 64 KiB 发送上限。
- `RealtimeNotification::validate()`、`NotificationRecord::validate()`：校验接收身份字段、文本与应用发布标识的组合。

这些入口与 `validate()` 仅覆盖模板明确实现的约束，不是完整 Schema 校验器，也不负责可信来源、期限和授权。直接使用 `serde_json::from_slice` 不会自动调用 `validate()`；需要边界校验时使用上述入口或显式调用。带令牌的 DTO 不派生 `Debug`，公开解析错误为 `PUBLIC_CONTRACT_INVALID`，不保留输入或底层解析错误。

## 组织范围与数据授权

`AppAuthorizationContext.organizationScopeIds` 的三种状态有不同含义：

| wire 状态 | Rust 表示 | 解释 |
| --- | --- | --- |
| 字段缺失 | `OptionalNullable::Missing` | 旧上下文仅限当前组织 |
| `null` | `OptionalNullable::Null` | 平台根范围；只有已验证的平台上下文才能赋予该语义 |
| 字符串数组 | `OptionalNullable::Value(ids)` | 显式硬上限，必须包含当前组织、不得有空 ID、最多 10,000 项 |

不能把缺失和 null 合并，不能截断超限数组后继续授权。`OptionalNullable` 在序列化往返中保留三态；`MicroPropsWire` 采用更严格的必填字段，只允许 null 或数组。

`MicroDataGrant` 描述 `resource`、`action`、`scope`、主体用户、租户和组织集合。范围枚举为 `SELF`、`ORG`、`ORG_SUBTREE`、`TENANT`，但具体资源动作、记录归属和组织树展开规则由业务服务实现。

业务服务先验证平台传输与响应身份绑定，再逐请求校验令牌受众、用户/租户/组织、会话和授权期限、permission、数据授权及记录归属，并将租户和组织上限落实到 SQL。浏览器传来的菜单、按钮可见性或已通过结构校验的 DTO 均不能替代这些判断。

## 通知协议

发布目标 `NotificationTarget` 是带 `kind` 的互斥结构：

| `kind` | 必需字段 |
| --- | --- |
| `USER` | `userId`、`organizationId` |
| `ORGANIZATION` | `organizationId` |
| `TENANT` | 无额外目标字段 |

`NotificationPublishBody` 要求幂等键、目标、类型和标题，允许 content/link；目标及发布体拒绝未知字段。幂等键为 1–128 个 ASCII 字母数字或 `._:-`；标题最多 200 字符，内容最多 8,192 字符，链接最多 300 字符。类型为 `INFO`、`SUCCESS`、`WARNING`、`SECURITY`。是否允许某个目标、是否有通知发布权限和链接是否归属应用由平台校验。

`NotificationPublication` 是 HTTP 发布结果，包含持久化数量及重复标识。`NotificationPlatformSocketContext` 供实时服务从平台校验响应中读取，额外含 `sessionId`；面向浏览器的 `NotificationSocketContext` 不含该字段。

`RealtimeNotification` 为实时提示，包含接收人身份、发布标识、内容及创建时间；应用通知的 `applicationId` 与 `publicationId` 同时非空，系统通知同时为 null。`NotificationRecord` 为 HTTP 收件箱记录，另含 `sourceKind`、应用名和已读字段。实时 DTO 不承载 `isRead`、`sourceKind` 或 session；`LEGACY` 历史行不属于当前 APP/SYSTEM 收件箱 DTO。

## 固定样例与兼容验证

[fixtures/public-wire.json](fixtures/public-wire.json) 是无真实秘密的结构样例，供版本、组织三态、通知目标及公共/内部上下文场景验证。它不证明实际平台鉴权、PostgreSQL 通知、qiankun 生命周期或浏览器恢复正确。

修改协议时同步检查源 Schema、显式生成模板、客户端行为、固定样例、生成物与消费类型。`npm run check` 验证当前材料与源一致，`npm test` 另验证 1.0 归档摘要未变。消费者保留版本和逐文件来源摘要；本地说明文字修订应有自己的记录，不能伪装成上游协议或可执行字节升级。
