# Task-02: 微观结构套利模块开发

## 任务ID

`TASK-02-MICROSTRUCTURE`

## 任务目标

实现基于订单流微观结构的套利策略，识别盘口失衡、队列坍塌、大单异动等信号，在短线价格压力下获取微优势。

## 详细实现要求

### 1. 盘口失衡检测

- 计算 L1/L5/L10 深度失衡比率
- 定义失衡阈值：`|imbalance| >= 0.6` 触发信号
- 跟踪失衡持续时间和变化速率

### 2. 微价格偏移

- 实现微价格公式：`MicroPrice = (Ask * Q_bid + Bid * Q_ask) / (Q_bid + Q_ask)`
- 计算微价格与中间价的偏离程度
- 定义偏离阈值：`|microPrice - mid| >= 0.01` 触发信号

### 3. 大单异动检测

- 监控单笔成交超过平均成交量 N 倍的订单
- 判断大单方向（主动买/主动卖）
- 统计大单累积效果

### 4. 队列坍塌预测

- 监控最优价位挂单消失速率
- 计算队列消耗时间估计
- 预测价格跳变可能性

### 5. 成交稀疏度

- 计算最近 N 秒内成交笔数与成交量
- 成交稀疏时调整策略激进程度

## 接口契约

### 输入类型

```typescript
type MicrostructureConfig = {
  imbalanceThreshold: number // 默认 0.6
  microPriceDevThreshold: number // 默认 0.01
  largeTradeMultiplier: number // 默认 3.0
  queueCollapseWindowMs: number // 默认 500
  sparseTradeThreshold: number // 默认 5
}

type BookMetrics = {
  imbalanceL1: number
  imbalanceL5: number
  imbalanceL10: number
  microPrice: number
  microPriceDev: number // 微价格偏离
  queueDepthBid: number
  queueDepthAsk: number
  queueConsumptionRate: number // 队列消耗速率
}

type TradeMetrics = {
  largeTradeCount: number // 大单数量
  largeTradeVolume: number // 大单成交量
  largeTradeDirection: "buy" | "sell" | "neutral"
  tradeFrequency: number // 成交频率 (笔/秒)
  avgTradeSize: number // 平均成交量
}
```

### 输出类型

```typescript
type MicrostructureSignal = {
  marketId: string
  ts: number
  signals: {
    imbalance: boolean
    microPriceDev: boolean
    largeTrade: boolean
    queueCollapse: boolean
    sparseTrade: boolean
  }
  combinedScore: number // 综合信号强度 (0-1)
  evBps: number
  direction: "buy" | "sell" | "neutral"
  confidence: number
}
```

### 主函数签名

```typescript
export function computeBookMetrics(book: BookState): BookMetrics
export function computeTradeMetrics(
  trades: MarketEvent[],
  windowMs: number
): TradeMetrics
export function detectMicrostructureOpportunity(
  bookMetrics: BookMetrics,
  tradeMetrics: TradeMetrics,
  config: MicrostructureConfig
): MicrostructureSignal | null
```

## 文件结构

```
bot/
├── signal/
│   ├── microstructure.ts          # 主逻辑
│   ├── book-metrics.ts            # 盘口指标
│   └── trade-metrics.ts           # 成交指标
├── config/
│   └── microstructure-config.ts   # 配置
└── contracts/
    └── types.ts                   # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 盘口失衡计算正确性
   - [ ] 微价格公式正确性（对比手算结果）
   - [ ] 大单识别阈值生效
   - [ ] 综合信号评分计算正确

2. **集成测试**
   - [ ] 输出符合 `Opportunity` 类型，`strategy: 'microstructure'`
   - [ ] 与 `FeatureEngine` 集成获取输入
   - [ ] 在 `run-engine.ts` 中可被调用

3. **性能要求**
   - [ ] 盘口指标计算 < 0.5ms
   - [ ] 成交指标计算 < 1ms
   - [ ] 不阻塞主事件循环

4. **回测验证**
   - [ ] 提供模拟盘口数据测试脚本
   - [ ] 输出：信号触发频率、平均EV

## 依赖关系

- 依赖 `bot/ingest/orderbook.ts` 的 `BookState`
- 依赖 `bot/contracts/types.ts` 的 `MarketEvent`
- 依赖 `bot/features/engine.ts` 的特征
- 与 `TASK-09-STRATEGY-ROUTER` 集成

## 参考现有代码

- `bot/features/engine.ts` - 已有 `imbalanceL1` 计算
- `bot/ingest/orderbook.ts` - 盘口状态结构
- `bot/signal/bayesian.ts` - 信号计算模式

## 数据需求

- 需要实时盘口快照
- 需要最近 N 秒成交数据

## 风险与缓解

| 风险               | 缓解措施                         |
| ------------------ | -------------------------------- |
| 微优势太小无法兑现 | 设置最小 EV 阈值，低于阈值不交易 |
| 信号噪音过多       | 综合评分机制，多信号叠加时才交易 |
| 市场波动加大时失效 | 动态调整阈值，波动大时放宽       |

## 预计工作量

4-6 天

## 建议子Agent提示词

```
你是微观结构套利模块开发者。请实现 Polymarket 盘口失衡和订单流异动检测策略。

核心任务：
1. 在 bot/signal/microstructure.ts 中实现综合信号检测和机会生成
2. 在 bot/signal/book-metrics.ts 中实现盘口指标：L1/L5/L10 失衡、微价格偏离、队列消耗
3. 在 bot/signal/trade-metrics.ts 中实现成交指标：大单检测、成交频率、平均量
4. 在 bot/config/microstructure-config.ts 中定义阈值配置
5. 扩展 bot/contracts/types.ts 添加 MicrostructureConfig、BookMetrics、TradeMetrics、MicrostructureSignal 类型

实现要求：
- 微价格 = (Ask * Q_bid + Bid * Q_ask) / (Q_bid + Q_ask)
- 盘口失衡阈值默认 0.6，微价格偏离阈值默认 0.01
- 大单定义：单笔成交超过平均量的 3 倍
- 综合信号评分 = 各信号权重加权和，权重可配置
- 输出必须符合 Opportunity 类型，strategy 为 'microstructure'
- 提供 computeBookMetrics()、computeTradeMetrics()、detectMicrostructureOpportunity() 函数

验收标准：
- 单元测试覆盖微价格计算、失衡检测、大单识别
- 与 features/engine.ts 和 ingest/orderbook.ts 集成无类型错误
- 提供模拟盘口和成交数据测试脚本

请先阅读 bot/ingest/orderbook.ts、bot/features/engine.ts、bot/signal/bayesian.ts 理解现有结构。
```
