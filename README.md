# SaaS Micro App SDK

独立 SDK 源码与协议仓库。Node 24.18.0 / npm 11.16.0。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

`npm run build` 显式生成，`npm run check` 只检查。生成器在临时的规范目录布局中构建，以保留登记 1.0.0 产物的原始字节和逻辑 source label；不读取平台或业务仓库。工具依赖由本仓库 package-lock.json 固定。

`releases/1.0.0` 为可交付的 classic/ESM、类型、Schema、Rust DTO 和摘要清单。根 package.json 是开发工具入口，交付消费者应使用 releases 下的版本包。SDK 当前仍为 REPOSITORY_CANDIDATE；没有执行外部包发布。

平台与业务以固定产物副本消费 SDK。升级需要审阅版本、SHA-256 及兼容性，不能在消费者构建时跟随 SDK main。compat 中旧 iframe bridge 仍是活跃的兼容基线，不属于已退役服务。

Git 历史从原平台 examples/micro-app-sdk 经 subtree split 保留。
