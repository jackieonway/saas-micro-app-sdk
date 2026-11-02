# SaaS 微应用 SDK 3.0

本仓库提供 qiankun 微应用使用的授权上下文客户端、通知发布助手以及 TypeScript、JSON Schema、Rust 公共协议。当前登记版本为 **3.0.0**，发布状态为 `REPOSITORY_CANDIDATE`：仓库内已生成固定交付材料，尚不代表已经发布到外部 npm registry。

微应用通过标准 `bootstrap(props)`、`mount(props)`、`unmount(props)` 和可选 `update(props)` 接入宿主，业务上下文位于 `props.platform`。平台登记的入口类型为 `HTML`，运行模式为 `TRUSTED`。SDK 的 ESM 是代码模块格式，应用入口仍由 qiankun 加载 HTML。

## 仓库内容与版本

| 位置 | 用途 |
| --- | --- |
| `src/` | 浏览器客户端实现与手写声明 |
| `contracts/schema.json` | 公共结构定义及生成器扩展字段 |
| `contracts/fixtures/public-wire.json` | 无真实凭据的固定协议样例 |
| `release.json` | SDK 版本、支持集合、独立协议版本和限额 |
| `generated/` | 生成的协议常量、TypeScript 类型、Schema、Rust DTO |
| `releases/3.0.0/` | 当前完整交付目录与 SHA-256 清单 |
| `releases/1.0.0/`、`releases/2.0.0/` | 旧版本不可变历史归档 |
| `tools/`、`scripts/`、`tests/` | 构建、生成、字节校验和行为测试 |

SDK 版本与业务协议独立：SDK 为 `3.0.0`，`MicroProps` 为 `2.0`，应用授权上下文与通知协议均为 `1.0`。当前支持集合仅含 `3.0.0`；省略 `sdkVersion` 的业务上下文仍由客户端接受，显式传入旧版或未知版本会被拒绝。

活动源码和 3.0 发布材料已移除 iframe bridge、MessagePort 通道、自定义双参数生命周期及 `host` / `iframe` 能力模式。1.0 目录保留原始 iframe 文件供追溯；根入口和生成器均不选择它，也不提供旧运行时兼容开关。

3.0 对现有系统身份与请求标识要求 RFC UUID v7，拒绝 v4、nil 和错误 variant；这属于运行时兼容性变化，因此升级 SDK 主版本。MicroProps、上下文和通知的字段及协议版本保持现有合同。

## 开发与验证

仓库工具包、SDK 运行时与当前交付目录版本均为 `3.0.0`；变更说明见 [release 日志](RELEASE.md)。

使用 [.nvmrc](.nvmrc) 中的 Node.js `24.22.1`、`package.json` 声明的 npm `11.16.0`，在本仓库根执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

修改 `src/`、协议模板、Schema 或 `release.json` 后，显式生成并复核差异：

```sh
npm run build
npm run check
npm test
```

`build` 写入当前版本生成结果，`check` 在受控临时目录重新构建并逐字节比较，发现漂移直接失败。它们不连接平台服务，不读取兄弟仓库，也不向业务仓库同步文件。生成文件头保留既有逻辑来源标签；当前入口命令以本节和 `package.json` 为准。CI 使用相同的安装、校验和测试流程。

测试覆盖上下文更新与取消、响应流上限、错误脱敏、通知幂等键、浏览器能力、确定性生成、摘要、旧归档不变和独立消费类型检查。浏览器加载、宿主切换、真实后端鉴权仍需在各应用联调中验证。

## 在 qiankun 应用中使用

将审阅过的 `releases/3.0.0/` **完整目录**固定到消费者的 vendor 目录，或使用团队自己的固定版本包分发方式。下面假定目录为 `vendor/micro-sdk/`：

```js
import { createContextClient } from './vendor/micro-sdk/index.mjs'

let client = null
let root = null

export async function bootstrap() {}

export async function mount(props) {
  root = props.container.querySelector('#app')
  if (!root) throw new Error('Application root is missing')
  client = createContextClient(props.platform)
  root.textContent = props.platform.user.displayName
}

export async function update(props) {
  client?.update(props.platform)
  if (root) root.textContent = props.platform.user.displayName
}

export async function unmount() {
  client?.dispose()
  client = null
  root?.replaceChildren()
  root = null
}
```

应用自身还要按构建工具要求输出 qiankun 可识别的生命周期，并将框架渲染限制在 `props.container` 内。SDK 不安装生命周期，也不替应用清理计时器、DOM 监听、框架实例或应用自行创建的 WebSocket；这些资源随 `unmount` 释放。

`QiankunProps` 包含 `container: HTMLElement`、`platform: MicroProps`、可选 `name` 和 `services`。目前 `services.downloadCsv({ resource, filename, content })` 是可选宿主服务，调用前检查其存在。容器、服务、`AbortSignal`、导航和提示回调均为内存对象，不序列化到后端。

ESM 消费入口为目录内的 `index.mjs`，类型为 `index.d.mts`。需要普通脚本时加载同一版本的 `sdk.js`，通过当前 `window.MicroSdk` 访问 API；该全局对象冻结并含 `sdkVersion`，不会安装 bridge 或自动挂载应用。根包的 `./sdk.js`、`./schema.json`、`./protocol.rs` 导出均指向 3.0 材料。`private: true` 表示当前仓库没有可直接执行的 npm 发布流程。

## 公共客户端 API

| API | 行为与约束 |
| --- | --- |
| `createContextClient(props, fetchImpl?)` | 使用宿主提供的 `MicroProps` 创建上下文作用域；可注入兼容原生 Fetch 的实现 |
| `client.current()` | 返回仍有效的当前上下文；宿主取消、SDK 作用域取消或期限到达时返回 `null` |
| `client.update(props)` | 接受新的上下文；授权字段或 signal 变化时取消旧请求 |
| `client.requestJson(url, options?)` | 以调用开始时的上下文发起有界 JSON 请求，返回解析结果 |
| `client.dispose()` | 取消当前作用域并移除宿主 signal 监听；应用卸载后应丢弃引用 |
| `requestWithContext(options)` | 低层请求函数，显式提供 `props`、`url`，可指定 `responseType`、`maxBytes` 和新鲜度检查 `check` |
| `createNotificationPublisher(client)` | 在当前应用上下文中构造通知发布助手 |
| `authorizationContextSignature(props)` | 生成仅供内存比较的授权身份；含令牌，不得记录日志或遥测；未知字段返回 `null` |
| `sameAuthorizationContext(previous, next)` | 比较授权字段；signal 身份、取消及期限由调用方另行检查 |
| `detectBrowserCapabilities('client', environment?)` | 返回冻结的 `{ mode, supported, missing }` |
| `assertBrowserCapabilities('client', environment?)` | 能力缺失时抛出带 `BROWSER_CAPABILITIES_UNSUPPORTED` 与固定缺失 API 名的错误 |

根入口还导出协议常量、`SUPPORTED_SDK_VERSIONS`、`isSupportedSdkVersion`、`assertSupportedSdkVersion` 及公共 TypeScript 类型。完整字段以 [协议说明](contracts/README.md)和当前 [声明](releases/3.0.0/index.d.mts)为准。

浏览器需要 Fetch、Headers、URL、AbortController、DOMException、TextEncoder、TextDecoder、ReadableStream、`Response.body` 和 `crypto.getRandomValues`。能力检查只覆盖客户端自身使用的 API；qiankun 与应用框架的浏览器支持由各自构建配置保证。

## 上下文、请求与错误

宿主负责取得令牌和授权上下文，设置 `contextEpoch`、`contextVersion`、`expiresAt`、`tokenExpiresAt`，并管理 `signal`。SDK 只保存在内存中，不保存到浏览器持久存储，也不刷新会话。`current()` 返回的上下文按只读快照使用。

仅主题、路由或显示回调变化且授权身份与 signal 不变时，`update` 可以保留正在进行的请求。用户、租户、组织、组织上限、角色、permission、数据授权、菜单、令牌、期限、部署标识或上下文版本变化会取消旧请求；即使旧 Fetch 实现迟到返回，也不能向新上下文交付结果。未知顶层字段会阻止请求复用。

请求强制写入当前令牌的 `Authorization: Bearer …`，强制 `credentials: 'omit'`，保留合法 RFC UUID v7 `X-Request-Id` 或生成新值。**URL 由调用方提供，SDK 不校验目标来源或路径白名单**；调用方必须只使用可信的业务 API 地址，避免把令牌发送到外部地址。业务服务仍需逐请求验证身份、受众、权限与记录归属。

JSON 响应默认上限为 1 MiB。低层 `requestWithContext` 支持 `responseType: 'text'` 及显式 `maxBytes`，绝对上限为 4 MiB；流式读取同时检查声明长度和实际字节数，不先无界调用 `response.text()` / `json()`。文本模式保留 CSV BOM。取消或过期使用 `AbortError`，调用方应在卸载后忽略该结果。

`MicroSdkError` 提供固定文案与 `kind`、`status`、`code`、可选合法 RFC UUID v7 `requestId`，`toJSON()` 只输出公开字段。401、403、409 分别映射 `UNAUTHORIZED`、`FORBIDDEN`、`CONFLICT`；其余 HTTP 失败为 `HTTP`，传输异常为 `NETWORK`，无效结构、编码或超限为 `PROTOCOL`。错误不保留响应正文、URL、令牌或原始异常 `cause`；应用也不应将上下文或原始请求配置写入错误日志。

## 发布应用通知

```js
import { createNotificationPublisher } from './vendor/micro-sdk/index.mjs'

const publisher = createNotificationPublisher(client)
await publisher.publish({
  idempotencyKey: 'order:123:approved',
  target: { kind: 'ORGANIZATION', organizationId: 'current-organization-id' },
  type: 'SUCCESS',
  title: '订单已审批',
  content: '可在订单列表查看处理结果',
  link: '/micro/orders/list',
})
```

助手向 `/api/apps/{当前 appCode}/notifications` 发送 JSON。一个业务事件重试时复用同一个幂等键；不同事件使用不同键。客户端只做活跃上下文、非空键、可序列化与 64 KiB 请求体检查，接收人范围、完整字段、链接归属和发布授权由平台再次校验。返回的 `NotificationPublication` 包含发布 ID、收件人与持久投递数量、是否重复以及创建时间；数量不等于用户已读或已收到实时事件。

这里的发布 API 与独立 Socket.IO 通知服务职责不同：发布和收件箱持久化属于平台 HTTP API，实时提示由 [通知服务](../saas-notification/README.md)负责；微应用 SDK 不创建 Socket.IO 连接。

此 SDK 3.0.0 发布助手消费宿主颁发的内部 `app_session`，公共端点不接受外部 OAuth Token。使用外部 canonical USER 的工单等资源服务应通过独立 Basic 服务凭据和原 token，调用平台的[私有通知发布／结果合同](../saas-plateform/backend/docs/designs/unified-auth/phase-18-private-notification-contract.md)。该适配器运行在服务端，不把外部 token 转为内部 JWT，也不向微应用分发服务密钥；MACHINE 和 CUSTOMER 仍不能发布员工提醒。切换后应卸载旧实例并取得新的宿主能力；保留的旧 client 不得更新成另一账号或组织的凭据后重试原操作。

## 固定交付与升级

交付时保存 SDK 版本、源码修订和 `artifact-manifest.json`，按清单检查每个文件的大小与 SHA-256。消费者构建从固定副本读取，不追踪 SDK 仓库分支、不共享 `node_modules`、不在构建期间调用上游生成器。升级时重新审核声明、Schema、协议版本、可执行字节和摘要，再更新消费者来源记录。

`releases/1.0.0/` 和 `releases/2.0.0/` 的归档摘要由测试固定验证，生成器只产生当前 3.0 材料。已有登记版本不得被当成可随意覆盖的公开发布；若需要对外发布新内容，应先设计并登记新版本，更新生成器版本断言及消费者验证。qiankun 的同页运行环境面向可信微应用，授权最终由后端执行。
