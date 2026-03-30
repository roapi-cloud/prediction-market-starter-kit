# Task-05: 事件语义信号集成

## 任务ID

`TASK-05-SEMANTIC-SIGNAL`

## 任务目标

将新闻和社交媒体的事件语义信息集成到 Bayesian 模型作为先验输入，提升预测准确率。

## 详细实现要求

### 1. 事件语义数据源

支持以下数据源（可配置开关）：

- 新闻 API（如 NewsAPI、Reddit API）
- 社交媒体（Twitter/X API）
- Polymarket 评论/讨论
- 官方公告

### 2. 语义分析管道

- 文本预处理：清洗、分词、去噪音
- 情感分析：正面/负面/中性分类
- 事件相关性评分：与预测事件的关联程度
- 置信度评估：信息源可信度

### 3. 语义特征提取

输出语义特征向量：

- `sentimentScore`: 情感得分 (-1 到 1)
- `relevanceScore`: 事件相关性 (0 到 1)
- `sourceCredibility`: 信息源可信度 (0 到 1)
- `mentionCount`: 提及次数
- `trendDirection`: 舆论趋势方向

### 4. Bayesian 先验注入

- 将语义特征转换为 Bayesian 先验概率
- 公式：`prior = basePrior + sentimentScore * relevanceScore * credibilityWeight`
- 支持动态更新：新信息到达时调整先验

### 5. 信号时效性管理

- 语义信号有效时间窗口（默认 5 分钟）
- 过期信号自动衰减权重
- 支持信号优先级排序

## 接口契约

### 输入类型

```typescript
type SemanticConfig = {
  sources: SemanticSource[] // 数据源列表
  updateIntervalMs: number // 更新间隔，默认 60000
  signalTTLMs: number // 信号有效期，默认 300000
  credibilityWeights: Record<string, number> // 信息源权重
}

type SemanticSource = {
  type: "news" | "social" | "forum" | "official"
  endpoint: string
  apiKey?: string
  enabled: boolean
}

type SemanticEvent = {
  eventId: string
  ts: number
  source: string
  text: string // 原始文本
  sentiment: "positive" | "negative" | "neutral"
  sentimentScore: number // -1 到 1
  relevance: number // 0 到 1
  credibility: number // 0 到 1
}
```

### 输出类型

```typescript
type SemanticSignal = {
  eventId: string
  ts: number
  aggregatedSentiment: number // 聚合情感得分
  signalStrength: number // 信号强度 (0-1)
  priorAdjustment: number // Bayesian 先验调整量
  direction: "supports_yes" | "supports_no" | "neutral"
  confidence: number
  sourcesUsed: string[]
}

type SemanticSnapshot = {
  eventId: string
  ts: number
  sentimentScore: number
  relevanceScore: number
  sourceCredibility: number
  mentionCount: number
  trendDirection: "up" | "down" | "stable"
}
```

### 主函数签名

```typescript
export class SemanticEngine {
  constructor(config: SemanticConfig)
  fetchSemanticData(eventId: string): Promise<SemanticEvent[]>
  analyzeSentiment(events: SemanticEvent[]): SemanticSignal
  computePriorAdjustment(signal: SemanticSignal, basePrior: number): number
}

export function injectSemanticPrior(
  bayesian: BayesianOutput,
  semantic: SemanticSignal
): BayesianOutputEnhanced
```

## 文件结构

```
bot/
├── signal/
│   ├── semantic-engine.ts        # 主引擎
│   ├── semantic-analyzer.ts      # 语义分析
│   └── semantic-prior.ts         # 先验注入
├── ingest/
│   └── semantic-fetcher.ts       # 数据获取
├── config/
│   └── semantic-config.ts        # 配置
├── data/
│   └── semantic-cache.ts         # 语义数据缓存
└── contracts/
    └── types.ts                  # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 语义数据获取正确性
   - [ ] 情感分析准确性（对比标注数据）
   - [ ] 先验注入计算正确性

2. **集成测试**
   - [ ] 与 `BayesianEngine` 集成无类型错误
   - [ ] 语义信号在 `signal/index.ts` 中可被使用
   - [ ] 支持开关控制（可禁用语义信号）

3. **性能要求**
   - [ ] 语义数据获取不阻塞主循环（异步）
   - [ ] 缓存机制有效减少重复请求
   - [ ] API 请求频率可控（避免被限流）

4. **稳定性测试**
   - [ ] API 失败时降级处理
   - [ ] 数据缺失时使用默认先验
   - [ ] 异常输入不崩溃

5. **效果验证**
   - [ ] 提供对比脚本：有无语义信号的预测准确率
   - [ ] 输出：语义信号贡献度分析

## 依赖关系

- 外部 API（NewsAPI、Reddit、Twitter 等）
- 依赖 `bot/signal/bayesian-enhanced.ts`（或原版）
- 与 `TASK-04-BAYESIAN-ENHANCE` 协同

## 参考现有代码

- `bot/signal/bayesian.ts` - Bayesian 计算入口
- `bot/features/engine.ts` - 特征引擎模式
- `lib/gamma.ts` - 外部 API 调用模式

## 数据需求

- 需要 API Key（用户提供）
- 需要事件 ID 与新闻关键词映射

## 风险与缓解

| 风险           | 缓解措施                 |
| -------------- | ------------------------ |
| API 限流或失效 | 多源备份、缓存、降级处理 |
| 语义噪音       | 相关性过滤、可信度加权   |
| 信号延迟       | 异步处理、过期衰减       |

## 预计工作量

4-6 天

## 建议子Agent提示词

```
你是事件语义信号集成模块开发者。请实现新闻和社交媒体语义分析作为 Bayesian 先验。

核心任务：
1. 在 bot/signal/semantic-engine.ts 中实现 SemanticEngine 类
2. 在 bot/signal/semantic-analyzer.ts 中实现情感分析和相关性评估
3. 在 bot/signal/semantic-prior.ts 中实现 Bayesian 先验注入
4. 在 bot/ingest/semantic-fetcher.ts 中实现多源数据获取（异步）
5. 在 bot/data/semantic-cache.ts 中实现缓存机制
6. 在 bot/config/semantic-config.ts 中定义数据源配置
7. 扩展 bot/contracts/types.ts 添加 SemanticConfig、SemanticEvent、SemanticSignal 类型

实现要求：
- 支持 news、social、forum、official 四种数据源
- 情感分析：正面/负面/中性，得分 -1 到 1
- 事件相关性评分 0-1，信息源可信度 0-1
- 先验调整公式：prior = basePrior + sentiment * relevance * credibility
- 信号有效期默认 5 分钟，过期自动衰减
- 提供 SemanticEngine 类和 injectSemanticPrior() 函数
- 必须支持开关控制，可完全禁用语义信号

验收标准：
- 单元测试覆盖情感分析、相关性评估、先验注入
- API 失败时降级处理，不阻塞主循环
- 提供对比脚本验证语义信号贡献

请先阅读 bot/signal/bayesian.ts、lib/gamma.ts 理解现有 API 调用模式。
```
