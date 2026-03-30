# Task-10: 监控运维体系完善

## 任务ID

`TASK-10-MONITORING`

## 任务目标

完善监控运维体系，包括指标看板、告警规则、交易日报、纸交易→灰度→放量流程管理。

## 详细实现要求

### 1. 当前实现分析

现有监控较简单：

- `metrics/collector.ts`: 基础指标收集
- 缺少：
  - 实时看板
  - 告警系统
  - 日报生成
  - 灰度流程管理

### 2. 指标体系

定义完整指标体系：

**收益与风险指标**

- 日内 PnL（绝对值、百分比）
- 累计 PnL
- 最大回撤
- Sharpe Ratio
- Win Rate

**执行质量指标**

- 双腿完成率
- 平均滑点
- 平均执行延迟
- 订单成交率
- 补腿成功率

**系统健康指标**

- 数据流延迟
- 事件处理吞吐
- 策略状态（活跃/暂停）
- 风控状态（正常/熔断）

**策略指标**

- 各策略机会数
- 各策略执行数
- 各策略 PnL
- 各策略平均 EV

### 3. 指标收集器增强

- 支持多维度指标（按策略、市场、时间段）
- 支持指标聚合（分钟、小时、日）
- 支持指标持久化（写入文件或数据库）
- 支持实时推送（WebSocket）

### 4. 告警系统

告警规则：

- 日内亏损超阈值
- 回撤超阈值
- 连续失败超阈值
- 双腿完成率低于阈值
- 数据流中断
- 系统异常（进程崩溃、内存溢出）
- 滑点异常

告警通道：

- 日志文件
- Webhook（Slack/Telegram）
- 邮件（可选）

### 5. 交易日报

每日自动生成报告：

- PnL 汇总
- 分策略表现
- 分市场表现
- 执行质量统计
- 风控事件统计
- 异常事件列表
- 历史对比（与昨日、本周平均）

### 6. 灰度流程管理

定义三阶段流程：

**阶段 1: 纸交易（Paper Trading）**

- 模拟下单，不真实成交
- 验证信号和执行逻辑
- 持续 7-14 天
- 通过标准：双腿完成率 >= 95%，平均 EV > 0

**阶段 2: 灰度（Grayscale）**

- 小资金真实交易
- 资金限额：如总资金的 5%
- 持续 7-14 天
- 通过标准：无风控穿透，MDD 在预算内

**阶段 3: 放量（Production）**

- 逐步增加资金
- 监控指标，随时可回退
- 支持一键回退到灰度/纸交易

阶段控制：

- 配置开关
- 资金限额调整
- 信心评分触发自动晋级

### 7. 运维工具

- 启动/停止脚本
- 状态检查脚本
- 日志查看工具
- 参数热更新接口
- 一键熔断接口

## 接口契约

### 输入类型

```typescript
type MetricsConfig = {
  collectionIntervalMs: number // 收集间隔，默认 1000
  persistenceEnabled: boolean // 是否持久化
  persistencePath: string // 持久化路径
  pushEnabled: boolean // 是否实时推送
  pushEndpoint?: string // WebSocket endpoint
}

type AlertConfig = {
  rules: AlertRule[]
  channels: AlertChannel[]
  cooldownMs: number // 同类告警冷却期
}

type AlertRule = {
  name: string
  metric: string // 指标名称
  condition: "gt" | "lt" | "eq" // 条件
  threshold: number // 阈值
  severity: "info" | "warning" | "critical"
  message: string // 告警消息模板
}

type AlertChannel = {
  type: "log" | "webhook" | "email"
  endpoint?: string
  enabled: boolean
}

type DeploymentStage = "paper" | "grayscale" | "production"

type DeploymentConfig = {
  stage: DeploymentStage
  capitalLimitPct: number // 资金限额百分比
  grayscalePct: number // 灰度资金比例，默认 0.05
  passCriteria: PassCriteria
}

type PassCriteria = {
  minLegCompletionRate: number // 最低双腿完成率，默认 0.95
  minAvgEvBps: number // 最低平均 EV
  maxDrawdownPct: number // 最大回撤
  maxKillSwitchTriggers: number // 最大熔断次数
  minDurationDays: number // 最短持续时间
}
```

### 输出类型

```typescript
type MetricsSnapshot = {
  ts: number
  // 收益风险
  pnl: number
  pnlPct: number
  drawdown: number
  drawdownPct: number
  winRate: number

  // 执行质量
  legCompletionRate: number
  avgSlippageBps: number
  avgDelayMs: number
  orderFillRate: number
  hedgeSuccessRate: number

  // 系统健康
  dataLatencyMs: number
  eventThroughput: number // 事件/秒
  activeStrategies: number
  riskState: "normal" | "warning" | "kill_switch"

  // 策略明细
  strategyMetrics: Map<string, StrategyMetrics>
}

type StrategyMetrics = {
  opportunities: number
  executed: number
  pnl: number
  avgEvBps: number
  winRate: number
}

type AlertEvent = {
  id: string
  rule: string
  severity: "info" | "warning" | "critical"
  message: string
  ts: number
  value: number
  threshold: number
  acknowledged: boolean
}

type DailyReport = {
  date: string
  summary: {
    pnl: number
    pnlPct: number
    opportunities: number
    executed: number
    winRate: number
    maxDrawdown: number
  }
  strategyBreakdown: Map<string, StrategyMetrics>
  marketBreakdown: Map<string, MarketMetrics>
  executionQuality: {
    legCompletionRate: number
    avgSlippageBps: number
    avgDelayMs: number
  }
  riskEvents: RiskEventSummary[]
  alerts: AlertEvent[]
  comparison: {
    vsYesterday: number // PnL 变化
    vsWeeklyAvg: number
  }
}

type DeploymentStatus = {
  stage: DeploymentStage
  startTime: number
  durationDays: number
  capitalUsedPct: number
  criteriaMet: boolean // 是否满足晋级条件
  metricsSinceStart: MetricsSnapshot
  canAdvance: boolean // 是否可以晋级
  canRollback: boolean // 是否可以回退
}
```

### 主函数签名

```typescript
export class MetricsCollectorEnhanced {
  constructor(config: MetricsConfig)

  // 收集
  collect(state: EngineState): MetricsSnapshot
  collectStrategyMetrics(
    strategy: string,
    events: StrategyEvent[]
  ): StrategyMetrics

  // 持久化
  persist(snapshot: MetricsSnapshot): void
  loadHistorical(start: number, end: number): MetricsSnapshot[]

  // 推送
  push(snapshot: MetricsSnapshot): void
}

export class AlertSystem {
  constructor(config: AlertConfig)

  // 告警
  check(snapshot: MetricsSnapshot): AlertEvent[]
  emit(alert: AlertEvent): void

  // 通道
  sendToChannel(alert: AlertEvent, channel: AlertChannel): void

  // 管理
  acknowledge(alertId: string): void
  getActiveAlerts(): AlertEvent[]
}

export class ReportGenerator {
  generateDaily(metrics: MetricsSnapshot[], date: string): DailyReport
  generateWeekly(metrics: MetricsSnapshot[]): WeeklyReport
  exportReport(report: DailyReport, format: "json" | "html" | "csv"): string
}

export class DeploymentManager {
  constructor(config: DeploymentConfig)

  // 状态
  getStatus(): DeploymentStatus
  checkCriteria(): boolean

  // 控制
  advanceToGrayscale(): void
  advanceToProduction(): void
  rollbackToGrayscale(): void
  rollbackToPaper(): void

  // 配置
  updateCapitalLimit(pct: number): void
}

export class OpsTools {
  checkHealth(): HealthStatus
  viewLogs(lines: number): string
  hotUpdateParams(params: Partial<StrategyConfig>): void
  triggerKillSwitch(): void
  releaseKillSwitch(): void
}
```

## 文件结构

```
bot/
├── metrics/
│   ├── collector.ts               # 保留并增强
│   ├── enhanced.ts                # 增强版收集器
│   ├── persistence.ts             # 持久化
│   ├── pusher.ts                  # 实时推送
├── alert/
│   ├── system.ts                  # 告警系统
│   ├── rules.ts                   # 告警规则
│   ├── channels.ts                # 告警通道
├── report/
│   ├── generator.ts               # 报告生成
│   ├── daily.ts                   # 日报
│   ├── weekly.ts                  # 周报
├── deployment/
│   ├── manager.ts                 # 灰度管理
│   ├── criteria.ts                # 通过标准
│   ├── stages.ts                  # 阶段控制
├── ops/
│   ├── health.ts                  # 健康检查
│   ├── tools.ts                   # 运维工具
│   ├── scripts/                   # 启动/停止脚本
├── config/
│   ├── metrics-config.ts          # 指标配置
│   ├── alert-config.ts            # 告警配置
│   └── deployment-config.ts       # 灰度配置
└── contracts/
    └── types.ts                   # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 指标收集正确性
   - [ ] 告警规则触发正确
   - [ ] 报告生成完整
   - [ ] 灰度阶段切换正确

2. **集成测试**
   - [ ] 与 `run-engine.ts` 集成收集指标
   - [ ] 与 `risk/engine-enhanced.ts` 集成告警
   - [ ] 输出可被前端看板使用

3. **运维场景**
   - [ ] 启动脚本正确启动所有模块
   - [ ] 停止脚本正确关闭并保存状态
   - [ ] 健康检查正确返回系统状态
   - [ ] 一键熔断正确触发

4. **性能要求**
   - [ ] 指标收集延迟 < 10ms
   - [ ] 告警发送延迟 < 100ms
   - [ ] 日报生成 < 5 秒

5. **数据格式**
   - [ ] 持久化格式可读（JSON）
   - [ ] 支持历史数据加载
   - [ ] 报告可导出多种格式

## 依赖关系

- 依赖所有模块的指标输出
- 依赖 `risk/engine-enhanced.ts` 的风控状态
- 与前端看板集成（可选）

## 参考现有代码

- `bot/metrics/collector.ts` - 当前指标收集
- `bot/core/run-engine.ts` - 指标调用方式

## 数据需求

- 需要指标持久化存储（文件或数据库）
- 需要历史报告数据（对比分析）

## 风险与缓解

| 风险         | 缓解措施              |
| ------------ | --------------------- |
| 告警噪音过多 | 冷却期 + 告警聚合     |
| 指标数据过大 | 定期清理 + 聚合       |
| 灰度误晋级   | 人工确认 + 多指标验证 |

## 预计工作量

4-5 天

## 建议子Agent提示词

```
你是监控运维体系完善模块开发者。请实现指标看板、告警系统、日报生成、灰度流程管理。

核心任务：
1. 在 bot/metrics/enhanced.ts 中实现 MetricsCollectorEnhanced 类
2. 在 bot/metrics/persistence.ts 中实现指标持久化
3. 在 bot/metrics/pusher.ts 中实现实时推送
4. 在 bot/alert/system.ts 中实现 AlertSystem 类
5. 在 bot/alert/rules.ts 中定义告警规则
6. 在 bot/alert/channels.ts 中实现告警通道（日志、Webhook）
7. 在 bot/report/generator.ts 中实现 ReportGenerator 类
8. 在 bot/report/daily.ts 中实现日报生成
9. 在 bot/deployment/manager.ts 中实现 DeploymentManager 类
10. 在 bot/deployment/criteria.ts 中定义通过标准
11. 在 bot/ops/tools.ts 中实现运维工具（健康检查、一键熔断）
12. 在 bot/config/ 下定义各项配置
13. 扩展 bot/contracts/types.ts 添加所有监控相关类型

实现要求：
- 指标体系：收益风险、执行质量、系统健康、策略明细
- 告警规则：亏损、回撤、连续失败、双腿完成率、数据中断、异常
- 告警通道：日志文件、Webhook（Slack/Telegram）
- 日报：PnL 汇总、分策略/市场表现、执行质量、风控事件、历史对比
- 灰度流程：纸交易 -> 灰度 -> 放量，通过标准可配置
- 运维工具：健康检查、日志查看、参数热更新、一键熔断
- 提供 MetricsCollectorEnhanced、AlertSystem、ReportGenerator、DeploymentManager、OpsTools 类

验收标准：
- 单元测试覆盖指标收集、告警触发、报告生成
- 集成测试：与 run-engine.ts 和 risk 模块集成
- 运维场景：启动/停止脚本、健康检查、熔断
- 性能：指标收集 < 10ms，告警 < 100ms

请先阅读 bot/metrics/collector.ts、bot/core/run-engine.ts 理解现有指标逻辑。
```
