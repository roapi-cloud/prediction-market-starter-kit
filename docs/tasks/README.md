# 并行开发任务总览

## 任务列表

| ID      | 任务名称     | 预计工作量 | 核心交付                          | 关键依赖                  |
| ------- | ------------ | ---------- | --------------------------------- | ------------------------- |
| TASK-01 | 统计套利模块 | 3-5天      | `bot/signal/stat-arb.ts`          | 无                        |
| TASK-02 | 微观结构套利 | 4-6天      | `bot/signal/microstructure.ts`    | 无                        |
| TASK-03 | 期限结构套利 | 3-4天      | `bot/signal/term-structure.ts`    | Gamma API                 |
| TASK-04 | Bayesian增强 | 5-7天      | `bot/signal/particle-filter.ts`   | 无                        |
| TASK-05 | 语义信号集成 | 4-6天      | `bot/signal/semantic-engine.ts`   | TASK-04                   |
| TASK-06 | 执行编排优化 | 5-7天      | `bot/execution/orchestrator.ts`   | 无                        |
| TASK-07 | 风控系统强化 | 4-6天      | `bot/risk/engine-enhanced.ts`     | TASK-06                   |
| TASK-08 | 回测框架增强 | 6-8天      | `bot/backtest/engine-enhanced.ts` | TASK-06, TASK-07          |
| TASK-09 | 策略路由器   | 4-5天      | `bot/signal/router.ts`            | TASK-01, TASK-02, TASK-03 |
| TASK-10 | 监控运维体系 | 4-5天      | `bot/metrics/enhanced.ts`         | 所有模块                  |

---

## 依赖关系图

```
Layer 1 (无依赖，可立即并行启动):
├── TASK-01 统计套利
├── TASK-02 微观结构套利
├── TASK-03 期限结构套利
├── TASK-04 Bayesian增强
├── TASK-06 执行编排优化

Layer 2 (依赖 Layer 1):
├── TASK-05 语义信号 ← TASK-04
├── TASK-07 风控强化 ← TASK-06
├── TASK-09 策略路由 ← TASK-01, TASK-02, TASK-03

Layer 3 (依赖 Layer 2):
├── TASK-08 回测增强 ← TASK-06, TASK-07

Layer 4 (依赖所有):
├── TASK-10 监控运维 ← 所有模块
```

---

## 并行执行建议

### 第一波 (Day 1-5): 5 个任务并行

启动以下无依赖任务：

- TASK-01 统计套利
- TASK-02 微观结构套利
- TASK-03 期限结构套利
- TASK-04 Bayesian增强
- TASK-06 执行编排优化

### 第二波 (Day 5-10): 3 个任务

等待 Layer 1 完成后启动：

- TASK-05 语义信号集成 (需 TASK-04)
- TASK-07 风控强化 (需 TASK-06)
- TASK-09 策略路由 (需 TASK-01/02/03)

### 第三波 (Day 10-15): 1 个任务

- TASK-08 回测增强 (需 TASK-06, TASK-07)

### 第四波 (Day 15-20): 1 个任务

- TASK-10 监控运维 (需所有模块稳定)

---

## 接口契约冻结

所有任务依赖 `bot/contracts/types.ts`，建议第一天冻结以下核心类型：

```typescript
// 已定义类型 (保持不变)
MarketEvent
FeatureSnapshot
Opportunity
RiskDecision
OrderIntent
OrderUpdate

// 需扩展的类型 (各任务自行添加)
// TASK-01: StatArbConfig, SpreadSnapshot, StatArbSignal
// TASK-02: MicrostructureConfig, BookMetrics, TradeMetrics, MicrostructureSignal
// TASK-03: TermStructureConfig, TermSpreadSnapshot, TermStructureSignal
// TASK-04: BayesianConfig, MarketRegime, ParticleState, BayesianOutputEnhanced
// TASK-05: SemanticConfig, SemanticEvent, SemanticSignal
// TASK-06: ExecutionConfig, Leg, ExecutionState, ExecutionPlan, ExecutionResult
// TASK-07: RiskConfigEnhanced, RiskStateEnhanced, RiskDecisionEnhanced
// TASK-08: BacktestConfigEnhanced, BacktestResultEnhanced
// TASK-09: StrategyConfig, StrategyState, RoutedOpportunity
// TASK-10: MetricsSnapshot, AlertEvent, DailyReport, DeploymentStatus
```

---

## 各任务提示词索引

| 任务    | 提示词文件                                       |
| ------- | ------------------------------------------------ |
| TASK-01 | `docs/tasks/task-01-statistical-arbitrage.md`    |
| TASK-02 | `docs/tasks/task-02-microstructure-arbitrage.md` |
| TASK-03 | `docs/tasks/task-03-term-structure-arbitrage.md` |
| TASK-04 | `docs/tasks/task-04-bayesian-enhancement.md`     |
| TASK-05 | `docs/tasks/task-05-semantic-signal.md`          |
| TASK-06 | `docs/tasks/task-06-execution-orchestration.md`  |
| TASK-07 | `docs/tasks/task-07-risk-enhancement.md`         |
| TASK-08 | `docs/tasks/task-08-backtest-enhancement.md`     |
| TASK-09 | `docs/tasks/task-09-strategy-router.md`          |
| TASK-10 | `docs/tasks/task-10-monitoring.md`               |

---

## 验收总览

各任务完成后需通过：

1. **单元测试**: 覆盖核心逻辑
2. **类型检查**: 无 TypeScript 错误
3. **集成测试**: 与 `run-engine.ts` 或相关模块集成
4. **回测验证**: 提供模拟数据测试脚本

全局验收：

- 所有任务完成后，`pnpm bot:test:all` 通过
- 回测框架能运行所有策略的完整回测
- 纸交易流程可验证执行质量

---

## 联调顺序

完成所有任务后，按以下顺序联调：

1. **策略层联调**: TASK-01/02/03/04/05 + TASK-09
2. **执行层联调**: TASK-06 + TASK-07
3. **回测联调**: TASK-08 + 所有策略
4. **监控联调**: TASK-10 + 所有模块
5. **全链路测试**: `run-engine.ts` 调用完整流程

---

## 快速启动子 Agent

复制对应任务文档中的"建议子Agent提示词"部分，启动独立开发 Agent。

示例：

```bash
# 启动 TASK-01 Agent
将 task-01-statistical-arbitrage.md 底部的提示词复制给新 Agent
```
