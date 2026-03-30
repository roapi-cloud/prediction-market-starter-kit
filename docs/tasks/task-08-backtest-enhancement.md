# Task-08: 回测框架增强

## 任务ID

`TASK-08-BACKTEST-ENHANCE`

## 任务目标

增强回测框架，实现真实盘口深度模拟、订单排队模拟、网络延迟注入、Monte Carlo 参数扰动系统化。

## 详细实现要求

### 1. 当前实现分析

现有回测较简化：

- `run-engine.ts`: 使用合成数据，简化成交假设
- `montecarlo/sim.ts`: 简单的 Monte Carlo PnL 模拟
- 缺少：
  - 真实盘口深度模拟
  - 订单队列模拟
  - 网络延迟注入
  - 系统化参数扰动

### 2. 真实盘口深度模拟

- 使用历史盘口快照数据
- 模拟盘口变化：新增、撤单、成交消耗
- 支持多档位深度（L1-L10）
- 模拟流动性突然消失场景
- 支持自定义盘口冲击模型

### 3. 订单排队模拟

- 模拟订单进入队列的排队位置
- 跟踪队列前方的挂单变化
- 计算队列消耗速率
- 模拟部分成交时的队列位置变化
- 支持撤单重排队

### 4. 网络延迟注入

- 配置延迟分布：均值、标准差、P99
- 支持随机延迟注入
- 模拟不同网络环境（良好/中等/恶劣）
- 记录延迟对执行的影响
- 支持延迟尖峰模拟（突发延迟）

### 5. Monte Carlo 参数扰动

系统化参数扰动框架：

- 支持多维度参数扰动：
  - 滑点范围：[0.5x, 2x] 基准值
  - 延迟范围：[0.5x, 3x] 基准值
  - 成交率范围：[0.6, 1.0]
  - 概率估计误差：±0.05
  - 相关性漂移：±0.1
  - 波动率变化：[0.5x, 2x]
- 支持 Latin Hypercube Sampling 减少维度冗余
- 每个参数独立分布或联合分布
- 输出参数敏感性分析

### 6. 回测结果归因

分离归因：

- 信号质量：正确识别机会的比例
- 执行损耗：滑点、延迟、失败导致的损失
- 库存风险：持仓累积导致的损失
- 风控影响：限额、熔断导致的机会损失

### 7. 回测报告

生成详细回测报告：

- PnL 曲线
- 最大回撤
- 分策略统计
- 分市场统计
- 执行质量统计
- 风控事件统计
- 参数敏感性分析
- Monte Carlo 置信区间

## 接口契约

### 输入类型

```typescript
type BacktestConfigEnhanced = {
  // 数据配置
  dataStart: number // 开始时间戳
  dataEnd: number // 结束时间戳
  dataPath: string // 数据文件路径
  replaySpeed: number // 回放速度倍率，默认 1

  // 模拟配置
  simulateQueue: boolean // 是否模拟排队
  simulateDepth: number // 模拟盘口档位，默认 5
  injectDelay: boolean // 是否注入延迟
  delayConfig: DelayDistribution

  // Monte Carlo 配置
  monteCarloRuns: number // 模拟次数，默认 10000
  perturbationRanges: PerturbationRanges
  samplingMethod: "random" | "lhs" // Latin Hypercube Sampling

  // 策略配置
  strategiesEnabled: string[] // 启用的策略
  riskConfig: RiskConfigEnhanced
  executionConfig: ExecutionConfig
}

type DelayDistribution = {
  meanMs: number // 平均延迟，默认 50
  stdMs: number // 标准差，默认 30
  p99Ms: number // P99 延迟，默认 200
  spikeProbability: number // 延迟尖峰概率，默认 0.01
  spikeMs: number // 尖峰延迟，默认 1000
}

type PerturbationRanges = {
  slippageMultiplier: [number, number] // [0.5, 2.0]
  delayMultiplier: [number, number] // [0.5, 3.0]
  fillRateRange: [number, number] // [0.6, 1.0]
  probabilityError: number // ±0.05
  correlationDrift: number // ±0.1
  volatilityMultiplier: [number, number] // [0.5, 2.0]
}

type QueueSimulationConfig = {
  trackQueuePosition: boolean
  consumeRate: number // 队列消耗速率估计
  frontCancelRate: number // 前方撤单率
}
```

### 输出类型

```typescript
type BacktestResultEnhanced = {
  // 基础指标
  totalPnl: number
  totalPnlBps: number
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  maxDrawdownPct: number

  // 交易统计
  totalOpportunities: number
  totalExecuted: number
  winRate: number
  avgEvBps: number
  avgHoldingTimeMs: number

  // 执行质量
  avgSlippageBps: number
  p95SlippageBps: number
  avgDelayMs: number
  p99DelayMs: number
  legCompletionRate: number // 双腿完成率

  // 风控统计
  killSwitchTriggered: number // 熔断触发次数
  riskLimitBreaches: number // 限额突破次数
  consecutiveFailEvents: number // 连续失败事件

  // 归因分析
  signalPnl: number // 信号贡献 PnL
  executionLoss: number // 执行损耗
  inventoryLoss: number // 库存损失
  riskControlLoss: number // 风控限制损失

  // Monte Carlo 结果
  mcPnLMean: number
  mcPnLP05: number
  mcPnLP95: number
  mcMaxDdMean: number
  mcMaxDdP95: number
  mcRuinProbability: number // 破产概率

  // 参数敏感性
  sensitivityAnalysis: Record<string, number> // 各参数敏感度
}

type BacktestReport = {
  summary: BacktestResultEnhanced
  pnlCurve: Array<{ ts: number; pnl: number; equity: number }>
  strategyBreakdown: Record<string, BacktestResultEnhanced>
  marketBreakdown: Record<string, BacktestResultEnhanced>
  executionEvents: ExecutionEvent[]
  riskEvents: RiskEvent[]
  mcDistribution: Array<{ pnl: number; probability: number }>
}
```

### 主函数签名

```typescript
export class BacktestEngineEnhanced {
  constructor(config: BacktestConfigEnhanced)

  // 数据加载
  loadHistoricalData(path: string): Promise<HistoricalData>

  // 回测执行
  runBacktest(data: HistoricalData): BacktestResultEnhanced

  // Monte Carlo 扰动
  runMonteCarlo(
    baseResult: BacktestResultEnhanced,
    runs: number
  ): MonteCarloResult
  perturbParams(
    params: BacktestParams,
    ranges: PerturbationRanges
  ): BacktestParams

  // 归因分析
  attributePnl(events: BacktestEvent[]): AttributionResult

  // 报告生成
  generateReport(result: BacktestResultEnhanced): BacktestReport
}

export class QueueSimulator {
  constructor(config: QueueSimulationConfig)
  simulateQueuePosition(order: OrderIntent, book: BookState): number
  simulateConsume(queuePos: number, trades: TradeEvent[]): number
}

export class DelayInjector {
  constructor(config: DelayDistribution)
  injectDelay(): number // 返回注入的延迟毫秒数
}
```

## 文件结构

```
bot/
├── backtest/
│   ├── engine-enhanced.ts        # 增强版回测引擎
│   ├── replay.ts                 # 保留并增强
│   ├── queue-simulator.ts        # 排队模拟
│   ├── depth-simulator.ts        # 盘口深度模拟
│   ├── delay-injector.ts         # 延迟注入
│   ├── attribution.ts            # 归因分析
│   ├── report-generator.ts       # 报告生成
│   └── historical-loader.ts      # 历史数据加载
├── montecarlo/
│   ├── sim.ts                    # 保留并增强
│   ├── perturbation.ts           # 参数扰动
│   ├── sensitivity.ts            # 敏感性分析
│   └── lhs-sampler.ts            # Latin Hypercube Sampler
├── config/
│   └── backtest-config.ts        # 回测配置
└── data/
    └── backtest-results/         # 回测结果存储
```

## 验收标准

1. **功能测试**
   - [ ] 盘口深度模拟与历史数据对比正确
   - [ ] 排队位置模拟与实际对比
   - [ ] 延迟注入分布符合配置
   - [ ] Monte Carlo 参数扰动范围正确
   - [ ] 归因分析计算正确

2. **集成测试**
   - [ ] 与 `run-engine.ts` 集成
   - [ ] 与 `execution/orchestrator.ts` 集成（使用排队模拟）
   - [ ] 与 `risk/engine-enhanced.ts` 集成（使用风控配置）

3. **性能要求**
   - [ ] 单次回测（1个月数据）耗时 < 60 秒
   - [ ] Monte Carlo 10000 次耗时 < 5 分钟
   - [ ] 内存使用可控（历史数据流式处理）

4. **数据格式**
   - [ ] 支持标准历史数据格式（待定义）
   - [ ] 支持自定义数据加载器

5. **报告输出**
   - [ ] 输出 JSON 格式报告
   - [ ] 支持导出到文件
   - [ ] 可视化脚本（可选）

## 依赖关系

- 依赖所有策略模块
- 依赖 `execution/orchestrator.ts`（排队模拟）
- 依赖 `risk/engine-enhanced.ts`（风控配置）
- 与所有任务集成验证

## 参考现有代码

- `bot/backtest/replay.ts` - 当前回放逻辑
- `bot/montecarlo/sim.ts` - 当前 Monte Carlo
- `bot/core/run-engine.ts` - 当前回测入口

## 数据需求

- 需要历史盘口快照数据
- 需要历史成交数据
- 需要历史订单状态数据（如有）
- 数据格式规范待定义

## 风险与缓解

| 风险           | 缓解措施                       |
| -------------- | ------------------------------ |
| 历史数据不完整 | 支持部分数据回测，标记缺失时段 |
| 回测速度慢     | 流式处理、并行 Monte Carlo     |
| 参数扰动不全面 | 系统化扰动框架，支持扩展       |

## 预计工作量

6-8 天

## 建议子Agent提示词

```
你是回测框架增强模块开发者。请实现真实盘口模拟、排队模拟、延迟注入、Monte Carlo 参数扰动。

核心任务：
1. 在 bot/backtest/engine-enhanced.ts 中实现 BacktestEngineEnhanced 类
2. 在 bot/backtest/queue-simulator.ts 中实现 QueueSimulator 类
3. 在 bot/backtest/depth-simulator.ts 中实现盘口深度模拟
4. 在 bot/backtest/delay-injector.ts 中实现 DelayInjector 类
5. 在 bot/backtest/attribution.ts 中实现 PnL 归因分析
6. 在 bot/backtest/report-generator.ts 中实现报告生成
7. 在 bot/montecarlo/perturbation.ts 中实现参数扰动框架
8. 在 bot/montecarlo/sensitivity.ts 中实现敏感性分析
9. 在 bot/montecarlo/lhs-sampler.ts 中实现 Latin Hypercube Sampler
10. 在 bot/config/backtest-config.ts 中定义回测配置
11. 扩展 bot/contracts/types.ts 添加 BacktestConfigEnhanced、BacktestResultEnhanced、BacktestReport、DelayDistribution、PerturbationRanges 类型

实现要求：
- 盘口深度模拟支持 L1-L5，基于历史快照
- 排队位置根据挂单价格和盘口深度计算
- 延迟注入：均值 50ms、标准差 30ms、P99 200ms、尖峰概率 1%
- Monte Carlo 扰动维度：滑点、延迟、成交率、概率误差、相关性漂移、波动率
- 参数扰动使用 Latin Hypercube Sampling 优化
- 归因分析：信号贡献、执行损耗、库存损失、风控损失分离
- Monte Carlo 默认 10000 次
- 提供 BacktestEngineEnhanced、QueueSimulator、DelayInjector 类

验收标准：
- 单元测试覆盖排队模拟、延迟注入、参数扰动
- 性能：单月回测 < 60秒，10000次 Monte Carlo < 5分钟
- 输出完整回测报告（JSON 格式）

请先阅读 bot/backtest/replay.ts、bot/montecarlo/sim.ts、bot/core/run-engine.ts 理解现有回测逻辑。
```
