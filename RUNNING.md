# 元AI — 运行指南（已拆分）

本文件原为 630 行的「从零部署参考手册」，内容与 `docs/` 下的专项文档大量重复，
且已出现失同步（例如 PostgreSQL 端口写成 5432，实际是 5433）。
2026-09-17 起内容按主题拆分到 `docs/`，本文件只保留索引。

**文档总入口：[docs/README.md](docs/README.md)**

## 原章节的新位置

| 原章节                               | 现在看这里                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 环境要求、克隆与安装                 | [docs/dev-guide.md 固定运行时](docs/dev-guide.md#固定运行时)                                                   |
| 基础设施启动（Docker）               | [docs/dev-guide.md 启动步骤](docs/dev-guide.md#启动步骤)                                                       |
| 环境变量配置                         | [docs/dev-guide.md 环境变量](docs/dev-guide.md#环境变量)                                                       |
| 启动后端 / Web                       | [docs/dev-guide.md](docs/dev-guide.md)                                                                         |
| 启动移动端（Expo）                   | [docs/dev-guide.md 启动移动端](docs/dev-guide.md#启动移动端)                                                   |
| 启动桌面端（Electron）               | [docs/dev-guide.md 启动桌面端](docs/dev-guide.md#启动桌面端)                                                   |
| 服务端口总览                         | [docs/dev-guide.md 基础设施端口](docs/dev-guide.md#基础设施端口)                                               |
| 测试                                 | [docs/testing-standards.md](docs/testing-standards.md)                                                         |
| 代码质量（类型检查 / Lint / 格式化） | [docs/dev-standards.md](docs/dev-standards.md)                                                                 |
| Git 工作流、Commit 规范、Git Hooks   | [docs/dev-standards.md 五、六](docs/dev-standards.md)                                                          |
| 常用命令速查                         | [README.md 常用命令](README.md#常用命令)                                                                       |
| 常见问题                             | [docs/dev-guide.md 常见问题](docs/dev-guide.md#常见问题) 与 [docs/troubleshooting.md](docs/troubleshooting.md) |
| 生产部署（新增）                     | [docs/deployment.md](docs/deployment.md)                                                                       |
