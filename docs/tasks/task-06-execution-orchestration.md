# Task-06: 双腿执行编排优化

## 任务ID

`TASK-06-EXECUTION-ORCHESTRATION`

## 任务目标

优化双腿套利的执行编排，实现被动挂单 + IOC 补腿的完整流程，包括超时处理、排队位置模拟、部分成交处理。

## 详细实现要求

### 1. 当前实现分析

现有 `execution/` 模块较简单：

- `stoikov.ts`: 仅价格调整
- `kelly.ts`: 仅仓位计算
- 缺少双腿编排逻辑
- 缺少补腿和超时处理

### 2. 双腿编排策略

实现 `passive_then_ioc` 策略：

1. 先挂被动单在流动性较好的一腿
2. 等待成交（设置 TTL）
3. 成交后立即 IOC 补另一腿
4. 超时未补则降价补腿（受最大滑点约束）
5. 补腿失败达到阈值则强制平衡/止损

### 3. 排队位置模拟

- 模拟订单在盘口队列中的位置
- 估算成交等待时间
- 跟踪队列前撤单对成交的影响
- 动态调整挂单价格以改善位置

### 4. 部分成交处理

- 部分成交时记录已成交量
- 补腿时只补剩余量
- 支持分批补腿（多次 IOC）
- 部分成交超过阈值时重新评估策略

### 5. 超时与止损机制

- 双腿 TTL：默认 30 秒
- 补腿超时：默认 5 秒
- 补腿最大滑点：可配置
- 补腿失败次数阈值：默认 3 次
- 失败后处理：平仓或等待

### 6. 执行状态跟踪

维护执行状态：

- `legs`: 两腿订单状态
- `filled`: 已成交量
- `remaining`: 待补量
- `elapsed`: 已耗时
- `phase`: 执行阶段

## 接口契约

### 输入类型

```typescript
type ExecutionConfig = {
  strategy: "passive_then_ioc" | "simultaneous" | "ioc_both"
  legsTTLMs: number // 双腿总时限，默认 30000
  hedgeTTLMs: number // 补腿时限，默认 5000
  maxSlippageBps: number // 最大补腿滑点，默认 50
  maxHedgeAttempts: number // 最大补腿次数，默认 3
  partialFillThreshold: number // 部分成交阈值，默认 0.5
  queuePositionSimulation: boolean // 是否模拟排队
}

type Leg = {
  marketId: string
  side: "buy" | "sell"
  targetPrice: number
  targetSize: number
  filledSize: number
  avgPrice: number
  orderId?: string
  status: "pending" | "submitted" | "partial" | "filled" | "failed"
}

type ExecutionState = {
  opportunityId: string
  legs: Leg[]
  phase:
    | "init"
    | "passive_wait"
    | "hedge_active"
    | "completed"
    | "failed"
    | "aborted"
  startTime: number
  elapsedMs: number
  remainingSize: number
  hedgeAttempts: number
  totalPnl: number // 实际执行 PnL
}
```

### 输出类型

```typescript
type ExecutionPlan = {
  opportunityId: string
  legs: Leg[]
  config: ExecutionConfig
  estimatedFillTime: number // 估算成交时间
  queuePositions: number[] // 排队位置估计
}

type ExecutionResult = {
  opportunityId: string
  success: boolean
  legsFilled: number[] // 各腿成交量
  avgPrices: number[] // 各腿平均价
  actualSlippageBps: number // 实际滑点
  executionTimeMs: number // 执行耗时
  pnlBps: number // 实际 PnL
  phaseReached: ExecutionState["phase"]
  hedgeAttemptsUsed: number
}

type OrderAction = {
  type: "submit" | "cancel" | "modify"
  orderId?: string
  legIndex: number
  order: OrderIntent
}
```

### 主函数签名

```typescript
export class ExecutionOrchestrator {
  constructor(config: ExecutionConfig)
  createPlan(
    opportunity: Opportunity,
    bookStates: Map<string, BookState>
  ): ExecutionPlan
  startExecution(plan: ExecutionPlan): ExecutionState
  onOrderUpdate(update: OrderUpdate, state: ExecutionState): ExecutionState
  checkTimeout(state: ExecutionState, now: number): ExecutionState
  hedgeLeg(state: ExecutionState, book: BookState): OrderAction | null
  abort(state: ExecutionState): OrderAction[]
}

export function simulateQueuePosition(price: number, book: BookState): number
export function estimateFillTime(queuePos: number, tradeRate: number): number
```

## 文件结构

```
bot/
├── execution/
│   ├── orchestrator.ts           # 双腿编排核心
│   ├── queue-simulator.ts        # 排队模拟
│   ├── hedge-handler.ts          # 补腿处理
│   ├── partial-fill.ts           # 部分成交处理
│   ├── stoikov.ts                # 保留
│   ├── kelly.ts                  # 保留
│   └── exit.ts                   # 保留
├── config/
│   └── execution-config.ts       # 执行配置
└── contracts/
    └── types.ts                  # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 双腿编排逻辑正确性
   - [ ] 补腿超时触发正确
   - [ ] 排队位置模拟与实际对比
   - [ ] 部分成交状态更新正确

2. **集成测试**
   - [ ] 与 `run-engine.ts` 集成
   - [ ] 与 `execution/kelly.ts`、`execution/stoikov.ts` 协同
   - [ ] 输出 `OrderAction` 与订单系统对接

3. **边界场景**
   - [ ] 全部成交场景
   - [ ] 部分成交 + 补腿成功
   - [ ] 补腿失败达到阈值
   - [ ] 超时未成交强制退出
   - [ ] 盘口消失时的降级处理

4. **性能要求**
   - [ ] 状态更新耗时 < 1ms
   - [ ] 不阻塞事件循环

5. **回测验证**
   - [ ] 提供模拟订单流测试脚本
   - [ ] 输出：双腿完成率、平均滑点、执行耗时分布

## 依赖关系

- 依赖 `bot/contracts/types.ts` 的 `Opportunity`、`OrderIntent`、`OrderUpdate`
- 依赖 `bot/ingest/orderbook.ts` 的 `BookState`
- 依赖 `bot/execution/kelly.ts`、`execution/stoikov.ts`
- 与 `TASK-08-BACKTEST-ENHANCE` 集成

## 参考现有代码

- `bot/execution/stoikov.ts` - 价格调整
- `bot/execution/kelly.ts` - 仓位计算
- `bot/core/run-engine.ts` - 当前简化执行逻辑
- `bot/execution/exit.ts` - 退出逻辑

## 数据需求

- 需要实时订单状态回报
- 需要盘口深度用于排队模拟
- 需要成交速率估计

## 风险与缓解

| 风险                 | 缓解措施                |
| -------------------- | ----------------------- |
| 补腿失败导致单边敞口 | 最大补腿次数 + 强制平仓 |
| 排队模拟不准确       | 持续校准，保守估计      |
| 盘口瞬间消失         | 超时机制 + IOC fallback |

## 预计工作量

5-7 天

## 建议子Agent提示词

```
你是双腿执行编排优化模块开发者。请实现被动挂单 + IOC 补腿的完整执行流程。

核心任务：
1. 在 bot/execution/orchestrator.ts 中实现 ExecutionOrchestrator 类
2. 在 bot/execution/queue-simulator.ts 中实现排队位置模拟和成交时间估算
3. 在 bot/execution/hedge-handler.ts 中实现补腿策略和滑点控制
4. 在 bot/execution/partial-fill.ts 中实现部分成交处理
5. 在 bot/config/execution-config.ts 中定义执行配置
6. 扩展 bot/contracts/types.ts 添加 ExecutionConfig、Leg、ExecutionState、ExecutionPlan、ExecutionResult、OrderAction 类型

实现要求：
- 策略 passive_then_ioc：先挂被动单，成交后 IOC 补腿
- 双腿 TTL 默认 30 秒，补腿 TTL 默认 5 秒
- 最大补腿滑点 50 bps，最大补腿次数 3 次
- 排队位置模拟：根据挂单价格和盘口深度估算位置
- 部分成交时只补剩余量，支持分批补腿
- 补腿失败达到阈值时强制平衡/止损
- 提供 ExecutionOrchestrator 类、simulateQueuePosition()、estimateFillTime() 函数

验收标准：
- 单元测试覆盖双腿编排、补腿逻辑、部分成交处理
- 边界场景：全部成交、部分成交、补腿失败、超时
- 提供模拟订单流测试脚本，验证双腿完成率

请先阅读 bot/execution/stoikov.ts、bot/execution/kelly.ts、bot/core/run-engine.ts、bot/execution/exit.ts 理解现有执行逻辑。
```
