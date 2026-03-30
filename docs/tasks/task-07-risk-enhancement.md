# Task-07: 风控系统强化

## 任务ID

`TASK-07-RISK-ENHANCE`

## 任务目标

强化风控系统，新增连续失败熔断机制、相关性风控（多市场组合敞口）、实时滑点校准反馈。

## 详细实现要求

### 1. 当前实现分析

现有 `risk/` 模块：

- `pre_trade.ts`: 简单的预交易检查
- `realtime.ts`: 回撤触发检查
  缺少：
- 连续失败熔断
- 多市场相关性风控
- 滑点实时校准
- 组合级敞口管理

### 2. 连续失败熔断机制

- 统计连续失败交易次数
- 触发阈值（默认 5 次）后暂停策略
- 支持按策略类型分别计数
- 失败定义：双腿未完成、滑点超标、净亏损
- 恢复机制：人工确认或自动冷却期后恢复

### 3. 相关性风控

- 识别相关市场（同一事件、相似主题）
- 计算组合敞口：`combinedExposure = sum(exposure_i * correlation_i)`
- 组合敞口限额：独立于单市场限额
- 相关性矩阵：维护市场间相关性估计
- 动态相关性更新：基于历史价差

### 4. 实时滑点校准反馈

- 收集实际执行滑点数据
- 计算滑点分布：均值、标准差、P95、P99
- 反馈到 Edge 模型调整成本估计
- 滑点异常告警：超过阈值时通知
- 支持按市场/策略分组统计

### 5. 组合级风控

新增组合级限额：

- 日内最大亏损（绝对值和百分比）
- 最大回撤限额
- 单事件总敞口（跨所有相关问题）
- 单策略类型总敞口
- VaR/CVaR 估计（可选，高级）

### 6. 风控状态管理

维护全局风控状态：

- `equity`: 当前权益
- `intradayPnl`: 日内盈亏
- `openExposure`: 未平仓敞口
- `consecutiveFails`: 连续失败计数
- `killSwitch`: 熔断开关
- `restrictedStrategies`: 受限策略列表

## 接口契约

### 输入类型

```typescript
type RiskConfigEnhanced = {
  // 基础限额
  maxPositionSize: number // 单笔最大
  maxMarketExposure: number // 单市场最大敞口
  maxIntradayLoss: number // 日内最大亏损（绝对值）
  maxIntradayLossPct: number // 日内最大亏损百分比，默认 0.02
  maxDrawdownPct: number // 最大回撤，默认 0.04

  // 连续失败熔断
  consecutiveFailThreshold: number // 连续失败阈值，默认 5
  failCooldownMs: number // 冷却期，默认 300000 (5min)

  // 相关性风控
  correlationMatrix: Map<string, Map<string, number>> // 市场相关性
  maxCombinedExposure: number // 组合敞口上限

  // 滑点校准
  slippageAlertThreshold: number // 滑点告警阈值 bps，默认 100
  slippageCalibrationWindow: number // 校准窗口，默认 100 次交易
}

type CorrelationGroup = {
  groupId: string
  markets: string[]
  avgCorrelation: number
  combinedExposure: number
  maxAllowedExposure: number
}

type SlippageStats = {
  marketId: string
  strategy: string
  count: number
  meanBps: number
  stdBps: number
  p95Bps: number
  p99Bps: number
  lastUpdate: number
}
```

### 输出类型

```typescript
type RiskStateEnhanced = {
  equity: number
  intradayPnl: number
  peakEquity: number
  drawdown: number
  openExposure: number
  combinedExposure: number
  consecutiveFails: number
  consecutiveFailsByStrategy: Map<string, number>
  killSwitch: boolean
  restrictedStrategies: string[]
  lastFailTime: number
  slippageStats: Map<string, SlippageStats>
}

type RiskDecisionEnhanced = {
  allow: boolean
  reason?: string
  maxSize?: number
  maxSlippageBps?: number
  killSwitch: boolean
  warnings: string[] // 告警信息
  slippageAdjustment: number // 滑点校准调整
  correlationWarning: boolean // 相关性风控警告
}

type SlippageFeedback = {
  marketId: string
  strategy: string
  expectedSlippageBps: number
  actualSlippageBps: number
  ts: number
}
```

### 主函数签名

```typescript
export class RiskEngineEnhanced {
  constructor(config: RiskConfigEnhanced)

  // 预交易检查
  preTradeCheck(
    opportunity: Opportunity,
    state: RiskStateEnhanced
  ): RiskDecisionEnhanced

  // 状态更新
  onTradeResult(
    result: ExecutionResult,
    state: RiskStateEnhanced
  ): RiskStateEnhanced
  onSlippageFeedback(
    feedback: SlippageFeedback,
    state: RiskStateEnhanced
  ): RiskStateEnhanced

  // 连续失败熔断
  checkConsecutiveFail(state: RiskStateEnhanced): {
    shouldPause: boolean
    strategy?: string
  }
  resetConsecutiveFail(
    state: RiskStateEnhanced,
    strategy?: string
  ): RiskStateEnhanced

  // 相关性风控
  computeCombinedExposure(
    positions: Position[],
    correlations: Map<string, Map<string, number>>
  ): number
  checkCorrelationRisk(
    state: RiskStateEnhanced,
    newOpportunity: Opportunity
  ): boolean

  // 滑点校准
  getSlippageAdjustment(
    marketId: string,
    strategy: string,
    stats: Map<string, SlippageStats>
  ): number
  updateSlippageStats(
    feedback: SlippageFeedback,
    stats: Map<string, SlippageStats>
  ): Map<string, SlippageStats>

  // 回撤检查
  checkDrawdown(state: RiskStateEnhanced): boolean

  // 熔断控制
  triggerKillSwitch(state: RiskStateEnhanced, reason: string): RiskStateEnhanced
  releaseKillSwitch(state: RiskStateEnhanced): RiskStateEnhanced
}

export function buildCorrelationMatrix(
  priceHistory: Map<string, number[]>
): Map<string, Map<string, number>>
```

## 文件结构

```
bot/
├── risk/
│   ├── pre_trade.ts              # 保留并增强
│   ├── realtime.ts               # 保留并增强
│   ├── engine-enhanced.ts        # 增强版风控引擎
│   ├── consecutive-fail.ts       # 连续失败熔断
│   ├── correlation-risk.ts       # 相关性风控
│   ├── slippage-calibration.ts   # 滑点校准
│   └── drawdown.ts               # 回撤控制
├── config/
│   └── risk-config.ts            # 风控配置
└── contracts/
    └── types.ts                  # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 连续失败计数正确性
   - [ ] 熔断触发和恢复逻辑正确
   - [ ] 相关性矩阵计算正确
   - [ ] 组合敞口计算正确
   - [ ] 滑点统计正确性

2. **集成测试**
   - [ ] 与 `run-engine.ts` 集成
   - [ ] 输出 `RiskDecisionEnhanced` 类型正确
   - [ ] 与 `execution/orchestrator.ts` 协同（接收执行结果）

3. **边界场景**
   - [ ] 连续失败触发后自动冷却
   - [ ] 多市场同时持仓时相关性检查
   - [ ] 滑点异常告警触发
   - [ ] 回撤达到阈值触发熔断

4. **性能要求**
   - [ ] 预交易检查耗时 < 1ms
   - [ ] 相关性矩阵查询高效

5. **回测验证**
   - [ ] 提供模拟交易流测试脚本
   - [ ] 输出：熔断触发次数、相关性风险事件、滑点统计

## 依赖关系

- 依赖 `bot/contracts/types.ts` 的 `Opportunity`、`ExecutionResult`
- 依赖 `bot/execution/orchestrator.ts` 获取执行结果
- 与 `TASK-08-BACKTEST-ENHANCE` 集成（提供风控参数）

## 参考现有代码

- `bot/risk/pre_trade.ts` - 当前预交易检查
- `bot/risk/realtime.ts` - 当前实时检查
- `bot/core/run-engine.ts` - 风控调用方式

## 数据需求

- 需要历史价格数据构建相关性矩阵
- 需要交易执行结果更新风控状态
- 需要实际滑点数据校准

## 风险与缓解

| 风险           | 缓解措施                 |
| -------------- | ------------------------ |
| 相关性估计滞后 | 定期更新，保守估计       |
| 熔断误触发     | 可配置阈值，人工确认机制 |
| 滑点数据不足   | 使用默认值，逐步校准     |

## 预计工作量

4-6 天

## 建议子Agent提示词

```
你是风控系统强化模块开发者。请实现连续失败熔断、相关性风控、滑点校准反馈。

核心任务：
1. 在 bot/risk/engine-enhanced.ts 中实现 RiskEngineEnhanced 类
2. 在 bot/risk/consecutive-fail.ts 中实现连续失败熔断逻辑
3. 在 bot/risk/correlation-risk.ts 中实现相关性矩阵和组合敞口计算
4. 在 bot/risk/slippage-calibration.ts 中实现滑点统计和校准
5. 在 bot/risk/drawdown.ts 中增强回撤控制逻辑
6. 增强 bot/risk/pre_trade.ts 和 realtime.ts，集成新功能
7. 在 bot/config/risk-config.ts 中定义增强配置
8. 扩展 bot/contracts/types.ts 添加 RiskConfigEnhanced、RiskStateEnhanced、RiskDecisionEnhanced、SlippageFeedback、CorrelationGroup、SlippageStats 类型

实现要求：
- 连续失败阈值默认 5 次，冷却期 5 分钟
- 相关性矩阵基于历史价格差计算
- 组合敞口 = sum(exposure * correlation)，有上限
- 滑点统计：均值、标准差、P95、P99
- 滑点反馈调整 Edge 模型的成本估计
- 日内亏损限额默认 2%，回撤限额默认 4%
- 提供 RiskEngineEnhanced 类和 buildCorrelationMatrix() 函数

验收标准：
- 单元测试覆盖连续失败熔断、相关性计算、滑点统计
- 边界场景：多市场持仓、连续失败触发、滑点异常
- 提供模拟交易流测试脚本

请先阅读 bot/risk/pre_trade.ts、bot/risk/realtime.ts、bot/core/run-engine.ts 理解现有风控逻辑。
```
