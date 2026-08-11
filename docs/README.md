# Sunland AI documentation / 文档

This directory contains repository-wide documentation. Core implementation contracts live under [packages/core/docs](../packages/core/docs/).

本目录保存仓库级文档；Core 的实现契约位于 [packages/core/docs](../packages/core/docs/)。

## Start here / 从这里开始

| Document | Purpose | 用途 |
|---|---|---|
| [README](../README.md) / [简中 README](../README.zh-CN.md) | Product overview and quick start | 项目介绍与快速开始 |
| [Architecture](architecture.md) | Runtime flow, package boundaries, and state ownership | 运行链路、包边界与状态所有权 |
| [Development](development.md) | Local setup, commands, and validation | 本地环境、命令与验证 |
| [HTTP API](api.md) | Routes, payloads, limits, idempotency, and errors | 路由、载荷、限制、幂等与错误 |
| [Deployment](deployment.md) | Secrets, staging, production, migrations, and release gates | 密钥、预发布、生产、迁移与发布门禁 |
| [Project memory](project-memory.md) | Stable context for maintainers and coding agents | 供维护者与 AI 使用的长期稳定上下文 |
| [Contributing](../CONTRIBUTING.md) / [简中贡献指南](../CONTRIBUTING.zh-CN.md) | Change and review workflow | 变更与评审流程 |

## Core contracts / Core 契约

- [Core architecture](../packages/core/docs/architecture.md)
- [SDK boundary](../packages/core/docs/sdk.md)
- [Semantic boundary](../packages/core/docs/semantic.md)
- [Reasoning boundary](../packages/core/docs/reasoning.md)
- [Knowledge and Memory](../packages/core/docs/knowledge.md)
- [Conversation Context](../packages/core/docs/context.md)
- [API client integration](../packages/core/docs/provider-integration.md)
- [Security boundary](../packages/core/docs/security-boundary.md)
- [Versioning](../packages/core/docs/versioning.md)
- [Release checklist](../packages/core/docs/release-checklist.md)

## Historical documents / 历史文档

The v0.1.0 Beta audit and checklist under packages/core/docs describe an earlier client-side Web/Flutter Bundle architecture. They are retained as historical evidence and are not current runbooks.

packages/core/docs 中的 v0.1.0 Beta 审计和清单描述的是早期客户端 Web/Flutter Bundle 架构，仅作为历史证据保留，不能当作当前操作手册。
