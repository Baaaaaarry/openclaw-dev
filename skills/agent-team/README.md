# Agent Dev Skill — Team Agent (arch/dev/test/review + Jenkins gate)

本仓库提供一个「开发团队 Agent Team」Skill，用于在本机把**需求拆解 → 开发实现 → 白盒测试 → Jenkins 门禁 → 黑盒测试 → 上库触发 Review → 检视回路**串成可执行的自动化工作流。

> 适用场景：你希望把日常“接需求-写代码-跑CI-测功能-发Review-修Review”的流程标准化，并用 agent 的方式协作执行与留痕。

---

## 功能概览

### 角色与职责

- **arch agent**
  - 负责理解用户需求 prompt
  - 输出两份结构化结果：
    - `requirements`：可执行的功能实现需求细节（含验收标准/约束/依赖）
    - `test_points`：功能测试点（含场景、步骤、预期、优先级）
  - 将 `requirements` 发给 dev agent，将 `test_points` 发给 test agent

- **dev agent**
  - 基于 `requirements` 在目标 repo 中实现代码
  - 本地执行白盒测试（单测 / lint / 静态检查等）
  - commit 后推送分支
  - 触发 Jenkins 门禁构建并等待结果
  - CI 成功后通知 test agent 进行黑盒验证

- **test agent**
  - 基于 `test_points` 和 CI build 信息进行黑盒测试（功能用例/E2E/API 等）
  - 输出 PASS/FAIL、证据、缺陷描述

- **review agent（检视）**
  - 基于 diff 和上下文做代码检视
  - 输出：APPROVE 或 REQUEST_CHANGES + 具体意见
  - 如需修改，dev agent 与 review agent 讨论并决定是否修改
  - 修改后重新走：门禁 → 测试 → 上库

---

## 仓库结构

```text
.
├── SKILL.md                     # Skill 说明与约束（给 Clawdbot/Claude Code 读取）
├── scripts/
│   ├── team_agent.py            # 主编排：arch → dev → jenkins → test → review → loop
│   ├── claude_pty.py            # 以 PTY 方式调用 claude，避免无 TTY hang
│   ├── jenkins_client.py        # Jenkins 触发与轮询
│   ├── git_ops.py               # 分支/提交/推送等 git 操作封装
│   └── notify.py                # 控制台/webhook 通知
└── templates/
    ├── arch_prompt.txt          # arch agent 提示词模板（JSON 输出）
    ├── dev_prompt.txt           # dev agent 提示词模板（JSON 输出）
    ├── test_prompt.txt          # test agent 提示词模板（JSON 输出）
    └── review_prompt.txt        # review agent 提示词模板（JSON 输出）
```
