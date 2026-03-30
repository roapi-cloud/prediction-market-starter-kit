# Task-09: 多策略路由与组合分配

## 任务ID

`TASK-09-STRATEGY-ROUTER`

## 任务目标

实现多策略路由系统，支持 static_arb、stat_arb、microstructure、term_structure 等策略的统一路由、竞争仲裁、组合分配。

## 详细实现要求

### 1. 当前实现分析

当前 `signal/index.ts` 仅支持 `static_arb`：

```typescript
return {
  strategy: 'static_arb',
  ...
}
```

缺少：

- 多策略并存
- 策略优先级
- 资源竞争仲裁
- 组合分配

### 2. 策略注册中心

- 支持策略注册：名称、类型、优先级、权重
- 策略启用/禁用开关
- 策略健康状态监控
- 策略性能统计

### 3. 策略路由逻辑

- 接收市场数据，分发到各策略模块
- 每个策略独立生成机会信号
- 支持并行计算（提高吞吐）
- 路由延迟控制

### 4. 机会竞争仲裁

当多个策略同时识别到机会：

- 优先级仲裁：高优先级策略优先
- EV 比较：选择 EV 最高的机会
- 资源冲突检查：同一市场不能同时被多个策略占用
- 支持机会合并（如多个策略指向同一交易）

### 5. 组合分配

- 资金分配：按策略权重分配可用资金
- 风险预算分配：每个策略独立风险限额
- 敞口分配：避免同一市场被多策略过度占用
- 动态调整：根据策略表现调整权重

### 6. 策略状态管理

- 活跃策略列表
- 各策略当前敞口
- 各策略日内 PnL
- 各策略连续失败计数
- 策略限流状态

## 接口契约

### 输入类型

```typescript
type StrategyConfig = {
  name: string // 策略名称
  type: StrategyType // 策略类型
  enabled: boolean // 是否启用
  priority: number // 优先级，默认 0
  weight: number // 组合权重，默认 0.25
  maxCapitalAllocation: number // 最大资金分配比例
  maxExposurePerMarket: number // 单市场最大敞口
  riskBudgetPct: number // 风险预算比例
  cooldownAfterFailMs: number // 失败后冷却时间
}

type StrategyType =
  | "static_arb"
  | "stat_arb"
  | "microstructure"
  | "term_structure"

type StrategyState = {
  name: string
  type: StrategyType
  status: "active" | "paused" | "disabled" | "cooldown"
  currentExposure: number
  intradayPnl: number
  opportunitiesFound: number // 今日发现机会数
  opportunitiesExecuted: number // 今日执行数
  consecutiveFails: number
  lastFailTime?: number
  lastOpportunityTime?: number
  avgEvBps: number // 平均 EV
  winRate: number // 胜率
}

type StrategyRegistry = {
  strategies: Map<string, StrategyConfig>
  states: Map<string, StrategyState>
}
```

### 输出类型

```typescript
type RoutedOpportunity = {
  opportunity: Opportunity
  sourceStrategy: string
  priority: number
  resourceClaim: ResourceClaim // 资源占用声明
}

type ResourceClaim = {
  marketIds: string[]
  estimatedExposure: number
  estimatedDurationMs: number
}

type ArbitrationResult = {
  selected: RoutedOpportunity | null
  rejected: RoutedOpportunity[] // 被拒绝的机会及原因
  reason: string // 选择原因
}

type AllocationDecision = {
  strategyAllocations: Map<string, number> // 各策略可用资金
  totalAvailable: number
  constraints: AllocationConstraint[]
}

type AllocationConstraint = {
  type: "capital" | "exposure" | "risk_budget"
  strategy?: string
  market?: string
  limit: number
  current: number
  available: number
}
```

### 主函数签名

```typescript
export class StrategyRouter {
  constructor(registry: StrategyRegistry)

  // 策略管理
  registerStrategy(config: StrategyConfig): void
  unregisterStrategy(name: string): void
  enableStrategy(name: string): void
  disableStrategy(name: string): void
  updateStrategyWeight(name: string, weight: number): void

  // 状态管理
  getStrategyState(name: string): StrategyState
  updateStrategyState(name: string, result: ExecutionResult): void
  checkCooldown(name: string, now: number): boolean

  // 路由
  route(feature: FeatureSnapshot, book: BookState): RoutedOpportunity[]

  // 仲裁
  arbitrate(
    opportunities: RoutedOpportunity[],
    state: RouterState
  ): ArbitrationResult

  // 分配
  allocateCapital(totalEquity: number, state: RouterState): AllocationDecision
  checkResourceConflict(claim1: ResourceClaim, claim2: ResourceClaim): boolean

  // 统计
  getStrategyStats(name: string): StrategyStats
  getAllStrategyStats(): Map<string, StrategyStats>
}

export function generateStaticArbOpportunity(
  feature: FeatureSnapshot,
  book: BookState
): Opportunity | null
export function generateStatArbOpportunity(
  signal: StatArbSignal,
  config: StatArbConfig
): Opportunity | null
export function generateMicrostructureOpportunity(
  signal: MicrostructureSignal
): Opportunity | null
export function generateTermOpportunity(
  spread: TermSpreadSnapshot,
  config: TermStructureConfig
): Opportunity | null
```

## 文件结构

```
bot/
├── signal/
│   ├── router.ts                  # 策略路由核心
│   ├── registry.ts                # 策略注册中心
│   ├── arbitration.ts             # 机会仲裁
│   ├── allocation.ts              # 组合分配
│   ├── index.ts                   # 保留作为统一入口
│   ├── static-arb.ts              # 静态套利（从 index.ts 拆分）
│   ├── stat-arb.ts                # 统计套利（TASK-01）
│   ├── microstructure.ts          # 微观结构（TASK-02）
│   ├── term-structure.ts          # 期限结构（TASK-03）
├── config/
│   └── strategy-config.ts         # 策略配置
└── contracts/
    └── types.ts                   # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 策略注册和状态管理正确
   - [ ] 路由分发到正确策略模块
   - [ ] 仲裁逻辑正确（优先级、EV、冲突）
   - [ ] 组合分配计算正确

2. **集成测试**
   - [ ] 与各策略模块（TASK-01/02/03）集成
   - [ ] 与 `run-engine.ts` 集成
   - [ ] 与 `risk/engine-enhanced.ts` 协同（风险预算）
   - [ ] 与 `execution/orchestrator.ts` 协同（资源声明）

3. **并发场景**
   - [ ] 多策略同时识别机会时的仲裁
   - [ ] 同一市场被多策略竞争
   - [ ] 策略禁用/启用时的状态切换

4. **性能要求**
   - [ ] 路由延迟 < 5ms（并行计算）
   - [ ] 仲裁决策 < 1ms

5. **动态调整**
   - [ ] 策略权重可动态更新
   - [ ] 根据表现自动调整（可选）

## 依赖关系

- 依赖 TASK-01、TASK-02、TASK-03 的策略模块
- 依赖 `bot/contracts/types.ts` 的类型
- 与 `risk/engine-enhanced.ts` 协同（风险预算）
- 与 `execution/orchestrator.ts` 协同（资源声明）

## 参考现有代码

- `bot/signal/index.ts` - 当前信号入口
- `bot/signal/edge.ts` - EV 计算
- `bot/core/run-engine.ts` - 策略调用方式

## 数据需求

- 需要策略历史表现数据（用于权重调整）
- 需要当前敞口和资金状态

## 风险与缓解

| 风险             | 缓解措施              |
| ---------------- | --------------------- |
| 策略资源竞争死锁 | 冲突检测 + 仲裁优先级 |
| 策略权重失衡     | 动态调整 + 手动干预   |
| 策略失效未感知   | 健康监控 + 自动降权   |

## 预计工作量

4-5 天

## 建议子Agent提示词

```
你是多策略路由模块开发者。请实现策略路由、竞争仲裁、组合分配系统。

核心任务：
1. 在 bot/signal/router.ts 中实现 StrategyRouter 类
2. 在 bot/signal/registry.ts 中实现策略注册中心
3. 在 bot/signal/arbitration.ts 中实现机会竞争仲裁
4. 在 bot/signal/allocation.ts 中实现组合资金/风险分配
5. 将 bot/signal/index.ts 中的静态套利逻辑拆分到 bot/signal/static-arb.ts
6. 更新 bot/signal/index.ts 作为统一入口，调用 Router
7. 在 bot/config/strategy-config.ts 中定义策略配置
8. 扩展 bot/contracts/types.ts 添加 StrategyConfig、StrategyType、StrategyState、StrategyRegistry、RoutedOpportunity、ArbitrationResult、AllocationDecision 类型

实现要求：
- 支持策略注册：名称、类型、优先级、权重、资金上限
- 策略类型：static_arb、stat_arb、microstructure、term_structure
- 路由分发：根据市场数据并行调用各策略模块
- 仲裁逻辑：优先级 > EV > 资源冲突检查
- 组合分配：按权重分配资金和风险预算
- 资源冲突：同一市场不能被多策略同时占用
- 策略状态：敞口、PnL、连续失败、冷却状态
- 提供 StrategyRouter 类和各策略生成函数

验收标准：
- 单元测试覆盖路由分发、仲裁逻辑、分配计算
- 集成测试：与 TASK-01/02/03 策略模块集成
- 边界场景：多策略竞争、资源冲突、策略禁用
- 性能：路由 < 5ms，仲裁 < 1ms

请先阅读 bot/signal/index.ts、bot/signal/edge.ts、bot/core/run-engine.ts 理解现有信号逻辑。

注意：本任务依赖 TASK-01、TASK-02、TASK-03 的策略模块，可先实现 Router 框架和 static_arb 拆分，其他策略模块集成后再联调。
```
