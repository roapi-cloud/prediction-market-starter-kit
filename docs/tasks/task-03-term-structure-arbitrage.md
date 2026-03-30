# Task-03: 期限结构套利模块开发

## 任务ID

`TASK-03-TERM-STRUCTURE`

## 任务目标

实现同一事件不同到期日合约的期限结构套利，利用短期与长期合约之间的定价偏差进行套利。

## 详细实现要求

### 1. 期限结构识别

- 支持同一事件的多个到期日合约识别
- 维护事件-合约映射表：`{ eventId, marketIds: [{ marketId, expiryTs }] }`
- 按到期时间排序：短期、中期、长期

### 2. 期限价差计算

- 计算短期合约价格 vs 长期合约价格的差异
- 定义价差：`termSpread = priceShort - priceLong`
- 计算价差的理论范围（基于事件确定性）

### 3. 期限溢价分析

- 短期合约价格应高于长期合约（时间价值递减）
- 当短期价格低于长期时，可能存在定价偏差
- 计算理论期限溢价并比较实际价差

### 4. 进场信号

- 当价差偏离理论范围超过阈值时触发
- 支持两种套利方向：
  - 正套：买入短期 + 卖出长期（当短期被低估）
  - 反套：卖出短期 + 买入长期（当短期被高估）

### 5. 到期风险处理

- 短期合约临近到期时需特殊处理
- 计算剩余时间和时间价值衰减
- 在到期前强制平仓或转移

## 接口契约

### 输入类型

```typescript
type TermStructureConfig = {
  eventId: string
  markets: Array<{ marketId: string; expiryTs: number }>
  termSpreadThreshold: number // 价差偏离阈值，默认 0.05
  maxHoldingBeforeExpiryMs: number // 到期前最大持仓，默认 60000
  timeValueDecayRate: number // 时间价值衰减率，默认 0.001
}

type TermSpreadSnapshot = {
  eventId: string
  ts: number
  shortTermPrice: number
  longTermPrice: number
  termSpread: number // 实际价差
  theoreticalSpread: number // 理论价差
  spreadDeviation: number // 偏离程度
  shortExpiryMs: number // 短期剩余时间
  longExpiryMs: number // 长期剩余时间
}
```

### 输出类型

```typescript
type TermStructureSignal = {
  eventId: string
  direction: "long_short" | "short_short" | "neutral" // 正套/反套
  shortMarketId: string
  longMarketId: string
  termSpreadDev: number
  evBps: number
  confidence: number
  urgency: number // 临近到期紧急程度 (0-1)
  ttlMs: number
}
```

### 主函数签名

```typescript
export function identifyTermMarkets(
  eventId: string,
  markets: MarketInfo[]
): TermStructureConfig
export function computeTermSpread(
  config: TermStructureConfig,
  prices: Map<string, number>,
  now: number
): TermSpreadSnapshot
export function generateTermOpportunity(
  spread: TermSpreadSnapshot,
  config: TermStructureConfig
): TermStructureSignal | null
```

## 文件结构

```
bot/
├── signal/
│   └── term-structure.ts         # 主逻辑
├── config/
│   └── term-events.ts            # 事件-合约映射
├── data/
│   └── term-history.ts           # 价差历史
└── contracts/
    └── types.ts                  # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 期限价差计算正确性
   - [ ] 理论价差与实际价差比较正确
   - [ ] 到期时间计算正确

2. **集成测试**
   - [ ] 输出符合扩展后的 `Opportunity` 类型
   - [ ] 新增 `strategy: 'term_structure'` 类型
   - [ ] 与 `run-engine.ts` 集成

3. **边界场景**
   - [ ] 短期合约临近到期时正确处理
   - [ ] 所有合约同一天到期时跳过
   - [ ] 到期时间数据缺失时的降级处理

4. **回测验证**
   - [ ] 提供多到期日合约模拟数据
   - [ ] 输出：套利机会数、平均EV、持仓时长分布

## 依赖关系

- 依赖 Gamma API 获取合约到期时间
- 依赖 `bot/contracts/types.ts` 扩展类型
- 与 `TASK-09-STRATEGY-ROUTER` 集成

## 参考现有代码

- `bot/signal/edge.ts` - EV计算模式
- `lib/gamma.ts` - Gamma API 获取市场信息

## 数据需求

- 需要市场元数据（事件ID、到期时间）
- 需要实时价格数据

## 风险与缓解

| 风险                 | 缓解措施               |
| -------------------- | ---------------------- |
| 到期时间数据不准确   | 多源验证，使用保守估计 |
| 短期合约到期无法平仓 | 到期前强制退出机制     |
| 事件结果影响所有合约 | 这是系统性风险，需限额 |

## 预计工作量

3-4 天

## 建议子Agent提示词

```
你是期限结构套利模块开发者。请实现同事件不同到期日合约的套利策略。

核心任务：
1. 在 bot/signal/term-structure.ts 中实现期限价差计算和套利信号生成
2. 在 bot/config/term-events.ts 中定义事件-合约映射配置
3. 在 bot/data/term-history.ts 中实现价差历史存储
4. 扩展 bot/contracts/types.ts 的 Opportunity 类型，添加 'term_structure' 策略类型
5. 添加 TermStructureConfig、TermSpreadSnapshot、TermStructureSignal 类型

实现要求：
- 计算短期合约价格 vs 长期合约价格的价差
- 理论价差基于时间价值：剩余时间越长，价格越低（对于确定事件）
- 价差偏离阈值默认 0.05
- 当短期价格低于长期时，正套（买短卖长）
- 到期前最大持仓时间默认 60秒
- 提供 identifyTermMarkets()、computeTermSpread()、generateTermOpportunity() 函数

验收标准：
- 单元测试覆盖价差计算、到期时间处理
- 边界场景：临近到期、数据缺失
- 与 Gamma API 或模拟数据集成测试

请先阅读 lib/gamma.ts、bot/signal/edge.ts、bot/contracts/types.ts 理解现有结构。
```
