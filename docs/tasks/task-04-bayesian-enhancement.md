# Task-04: Bayesian信号增强 - 粒子滤波与在线学习

## 任务ID

`TASK-04-BAYESIAN-ENHANCE`

## 任务目标

升级现有 Bayesian 模块，引入粒子滤波实现更精确的市场状态估计，支持在线学习动态调整概率参数。

## 详细实现要求

### 1. 当前实现分析

现有 `bayesian.ts` 实现较简单：

```typescript
const raw =
  0.5 + feature.imbalanceL1 * 0.3 + (feature.spreadZScore ?? 0) * -0.05
```

仅使用线性加权，缺乏：

- 状态空间建模
- 时序依赖处理
- 参数自适应学习

### 2. 状态空间定义

定义离散市场状态：

- `regime_up`: 上升趋势
- `regime_down`: 下降趋势
- `regime_range`: 震荡区间
- `regime_volatile`: 高波动

状态转移概率矩阵：`P(S_t | S_{t-1})`

### 3. 粒子滤波实现

- 初始化 N 个粒子（默认 100）
- 每个粒子携带：(state, weight, parameters)
- 预测步骤：按状态转移矩阵传播
- 更新步骤：根据观测数据更新权重
- 重采样：避免权重退化

### 4. 在线学习

- 支持参数在线校准
- 使用增量式贝叶斯更新
- 参数范围约束，避免极端值

### 5. 输出增强

新增输出字段：

- `regime`: 市场状态分类
- `regimeConfidence`: 状态置信度
- `nextRegimeProb`: 状态转移概率
- `predictedPriceMove`: 预测价格变动方向

## 接口契约

### 输入类型

```typescript
type BayesianConfig = {
  particleCount: number // 默认 100
  states: MarketRegime[] // 状态空间
  transitionMatrix: number[][] // 状态转移概率
  observationModel: ObservationModel // 观测似然函数
  resampleThreshold: number // 重采样阈值，默认 0.5
}

type MarketRegime = "up" | "down" | "range" | "volatile"

type ParticleState = {
  regime: MarketRegime
  weight: number
  params: {
    imbalanceWeight: number
    zScoreWeight: number
    volatilityWeight: number
  }
}
```

### 输出类型（增强）

```typescript
type BayesianOutputEnhanced = {
  pUp: number
  pDown: number
  regime: MarketRegime
  regimeConfidence: number
  confidence: number
  nextRegimeProb: Record<MarketRegime, number>
  predictedPriceMove: "up" | "down" | "neutral"
  effectiveParticleCount: number // 有效粒子数
}
```

### 主函数签名

```typescript
export class ParticleFilter {
  constructor(config: BayesianConfig)
  predict(): void
  update(observation: FeatureSnapshot): void
  resample(): void
  getEstimate(): BayesianOutputEnhanced
}

export function computeBayesianEnhanced(
  feature: FeatureSnapshot,
  filter: ParticleFilter
): BayesianOutputEnhanced
```

## 文件结构

```
bot/
├── signal/
│   ├── bayesian.ts               # 保留简单版本作为fallback
│   ├── bayesian-enhanced.ts      # 粒子滤波版本
│   ├── particle-filter.ts        # 粒子滤波核心
│   └── regime-model.ts           # 状态模型定义
├── config/
│   └── bayesian-config.ts        # 配置
└── contracts/
    └── types.ts                  # 扩展类型
```

## 验收标准

1. **功能测试**
   - [ ] 粒子权重更新正确性
   - [ ] 重采样逻辑正确性
   - [ ] 状态估计收敛性
   - [ ] 与简单版本对比精度提升

2. **集成测试**
   - [ ] 输出兼容现有 `BayesianOutput` 基础字段
   - [ ] 在 `signal/index.ts` 中可切换版本
   - [ ] 性能不阻塞主循环

3. **性能要求**
   - [ ] 单次更新耗时 < 5ms（100粒子）
   - [ ] 内存使用可控（粒子数固定）

4. **稳定性测试**
   - [ ] 长时间运行无权重退化
   - [ ] 异常输入不崩溃

5. **对比验证**
   - [ ] 提供历史数据对比脚本
   - [ ] 输出：简单版本 vs 粒子滤波版本的预测准确率

## 依赖关系

- 依赖 `bot/features/engine.ts` 的 `FeatureSnapshot`
- 依赖 `bot/contracts/types.ts` 的类型
- 可替换现有 `bayesian.ts` 作为默认实现

## 参考现有代码

- `bot/signal/bayesian.ts` - 当前实现
- `bot/features/engine.ts` - 特征计算
- `bot/features/windows.ts` - 滚动窗口工具

## 数据需求

- 需要历史特征数据用于初始化参数
- 需要状态转移矩阵的初始估计

## 风险与缓解

| 风险         | 缓解措施                   |
| ------------ | -------------------------- |
| 粒子权重退化 | 定期重采样，监控有效粒子数 |
| 计算开销过大 | 粒子数可配置，提供降级模式 |
| 参数漂移     | 参数范围约束，定期校准     |

## 预计工作量

5-7 天

## 建议子Agent提示词

```
你是 Bayesian 信号增强模块开发者。请实现粒子滤波和在线学习升级。

核心任务：
1. 在 bot/signal/particle-filter.ts 中实现粒子滤波核心类 ParticleFilter
2. 在 bot/signal/regime-model.ts 中定义市场状态空间和转移概率
3. 在 bot/signal/bayesian-enhanced.ts 中实现增强版 Bayesian 计算
4. 在 bot/config/bayesian-config.ts 中定义配置参数
5. 扩展 bot/contracts/types.ts 添加 MarketRegime、ParticleState、BayesianOutputEnhanced 类型

实现要求：
- 状态空间：up, down, range, volatile
- 粒子数默认 100，可配置
- 每个粒子携带：状态、权重、参数
- 实现 predict() -> update() -> resample() 循环
- 输出增强字段：regime、regimeConfidence、nextRegimeProb
- 保留原 bayesian.ts 作为 fallback
- 提供 ParticleFilter 类和 computeBayesianEnhanced() 函数

验收标准：
- 单元测试覆盖粒子权重更新、重采样、状态估计
- 性能：单次更新 < 5ms
- 提供历史数据对比脚本，验证预测准确率提升

请先阅读 bot/signal/bayesian.ts、bot/features/engine.ts、bot/features/windows.ts 理解现有实现。
```
