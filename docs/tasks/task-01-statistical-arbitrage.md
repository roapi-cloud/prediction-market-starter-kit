# Task-01: 统计套利模块开发

## 任务ID

`TASK-01-STAT-ARB`

## 任务目标

实现相关市场价差均值回归套利策略，用于识别两个相关预测市场之间的定价偏差，并在价差偏离历史均值时进行统计套利。

## 详细实现要求

### 1. 市场配对识别

- 支持手动配置相关市场对（如：同一事件的不同表述问题）
- 支持基于历史价格相关性的自动配对发现（可选，v2）
- 维护市场配对表：`{ pairId, marketA, marketB, hedgeRatio, lookbackWindow }`

### 2. 价差计算与监控

- 计算配对市场的价差序列：`spread = priceA - beta * priceB`
- 实现滚动窗口统计：均值、标准差、半衰期
- 计算实时 Z-Score：`Z = (spread - mean) / std`
- 支持多时间窗口：30s、1min、5min

### 3. 进场与出场信号

- 进场阈值：`|Z| >= 2.0`（可配置）
- 出场阈值：`|Z| < 0.5`（可配置）
- 最大持仓时间：`ttlMs`
- 支持止损：价差反向扩大超过阈值时强制退出

### 4. 与现有系统集成

- 输出 `Opportunity` 类型，`strategy: 'stat_arb'`
- 接收 `FeatureSnapshot` 作为输入
- 与 `Edge` 模块协同计算净EV

## 接口契约

### 输入类型

```typescript
type StatArbConfig = {
  pairId: string
  marketA: string
  marketB: string
  hedgeRatio: number
  lookbackWindow: number
  entryZThreshold: number // 默认 2.0
  exitZThreshold: number // 默认 0.5
  maxHoldingMs: number // 默认 300000 (5min)
  stopLossZThreshold: number // 默认 3.0
}

type SpreadSnapshot = {
  pairId: string
  ts: number
  spread: number
  mean: number
  std: number
  zScore: number
  halfLife?: number
}
```

### 输出类型

```typescript
type StatArbSignal = {
  pairId: string
  zScore: number
  direction: "long_spread" | "short_spread" | "neutral"
  evBps: number
  confidence: number
  ttlMs: number
}
```

### 主函数签名

```typescript
export function computeStatArb(
  marketPrices: Map<string, number>,
  history: SpreadHistory,
  config: StatArbConfig
): StatArbSignal | null

export function generateStatArbOpportunity(
  signal: StatArbSignal,
  config: StatArbConfig,
  now: number
): Opportunity | null
```

## 文件结构

```
bot/
├── signal/
│   └── stat-arb.ts          # 主逻辑
├── config/
│   └── stat-arb-pairs.ts     # 配置
├── data/
│   └── spread-history.ts     # 历史存储
└── contracts/
    └── types.ts              # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 价差计算正确性：单元测试覆盖
   - [ ] Z-Score 在边界值正确触发进场/出场
   - [ ] 半衰期估算与均值回归速度匹配

2. **集成测试**
   - [ ] 输出符合 `Opportunity` 类型约束
   - [ ] 与 `signal/index.ts` 集成无类型错误
   - [ ] 在 `run-engine.ts` 中可被调用

3. **性能要求**
   - [ ] 单次计算耗时 < 1ms
   - [ ] 内存增长可控（滚动窗口固定大小）

4. **回测验证**
   - [ ] 提供模拟数据回测脚本
   - [ ] 输出：信号数、平均EV、持仓时间分布

## 依赖关系

- 依赖 `bot/contracts/types.ts` 的类型定义
- 依赖 `bot/features/engine.ts` 的特征输入
- 依赖 `bot/signal/edge.ts` 的EV计算
- 与 `TASK-09-STRATEGY-ROUTER` 集成

## 参考现有代码

- `bot/signal/edge.ts` - EV计算模式
- `bot/features/engine.ts` - 滚动窗口统计
- `bot/signal/index.ts` - 信号生成入口

## 数据需求

- 需要历史价差数据用于初始化均值/方差
- 建议预加载至少 `lookbackWindow` 个数据点

## 风险与缓解

| 风险                | 缓解措施                       |
| ------------------- | ------------------------------ |
| 配对市场相关性失效  | 设置最小相关系数阈值，动态降权 |
| 价差不收敛          | 止损机制 + 最大持仓时间        |
| hedgeRatio 估计错误 | 支持在线校准                   |

## 预计工作量

3-5 天

## 建议子Agent提示词

```
你是统计套利模块开发者。请实现 Polymarket 相关市场价差均值回归策略。

核心任务：
1. 在 bot/signal/stat-arb.ts 中实现价差计算、Z-Score 监控、进场出场信号生成
2. 在 bot/config/stat-arb-pairs.ts 中定义市场配对配置
3. 扩展 bot/contracts/types.ts 添加 StatArbConfig、SpreadSnapshot、StatArbSignal 类型
4. 在 bot/data/spread-history.ts 中实现价差历史存储（内存滚动窗口）

实现要求：
- 使用滚动窗口计算均值、标准差
- Z-Score = (spread - mean) / std
- 当 |Z| >= 2.0 时生成进场信号，|Z| < 0.5 时生成出场信号
- 输出必须符合 Opportunity 类型，strategy 为 'stat_arb'
- 提供 computeStatArb() 和 generateStatArbOpportunity() 两个公开函数

验收标准：
- 单元测试覆盖价差计算、Z-Score 触发逻辑
- 与现有 signal/index.ts 集成无类型错误
- 提供模拟数据回测脚本

请先阅读 bot/contracts/types.ts、bot/signal/edge.ts、bot/features/engine.ts 理解现有代码结构。
```
