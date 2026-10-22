# 微应用 SDK

本仓库维护微应用公共协议、浏览器实现、生成工具与固定发布材料。它是独立 npm 工程，根 package.json 是真实构建入口，不划分 frontend/backend，也没有运行服务需要 Compose 部署。

## 开发与检查

Node 24.18.0、npm 11.16.0，在本仓库根执行：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

修改源码或 schema 后使用 npm run build 显式生成，再执行 check 和测试。check 只校验登记材料，不读取平台或业务仓库；生成器使用受控临时布局保持既有逻辑来源标签和产物字节。

## 目录

| 位置 | 职责 |
| --- | --- |
| src | SDK 实现 |
| contracts | 公共 schema、固定示例和协议规则 |
| generated | 类型、DTO 和 schema 生成结果 |
| releases/1.0.0 | classic/ESM、类型、Schema、Rust DTO 与摘要清单 |
| compat | 仍用于兼容验证的旧 bridge |
| tools、scripts、tests | 生成、校验和行为测试 |

## 消费与交付

当前 SDK 1.0.0 状态为 REPOSITORY_CANDIDATE，未执行外部包发布。消费者使用审阅的固定版本材料及逐文件摘要，构建时不跟随本仓库 main。已有应用无需共享 node_modules 或平台实现。

协议变更先审查版本、旧 bridge、类型与 Rust DTO 的一致性。不可把不同内容直接覆盖为同一已登记发布；发布新版本并更新消费者摘要和兼容验证。说明文档的本地翻译单独登记，不改变协议与可执行产物。

组织范围三态、解析及授权边界见 [协议说明](contracts/README.md)。
