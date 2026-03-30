import type {
  DeploymentConfig,
  DeploymentStage,
  PassCriteria,
} from "../contracts/types"
import { DEFAULT_PASS_CRITERIA } from "../deployment/criteria"

export const DEFAULT_DEPLOYMENT_CONFIG: DeploymentConfig = {
  stage: "paper",
  capitalLimitPct: 1.0,
  grayscalePct: 0.05,
  passCriteria: DEFAULT_PASS_CRITERIA,
}

export function createDeploymentConfig(
  overrides: Partial<DeploymentConfig> = {}
): DeploymentConfig {
  return {
    stage: overrides.stage ?? DEFAULT_DEPLOYMENT_CONFIG.stage,
    capitalLimitPct:
      overrides.capitalLimitPct ?? DEFAULT_DEPLOYMENT_CONFIG.capitalLimitPct,
    grayscalePct:
      overrides.grayscalePct ?? DEFAULT_DEPLOYMENT_CONFIG.grayscalePct,
    passCriteria: {
      ...DEFAULT_PASS_CRITERIA,
      ...overrides.passCriteria,
    },
  }
}

export function validateStage(stage: DeploymentStage): boolean {
  return ["paper", "grayscale", "production"].includes(stage)
}

export function getNextStage(current: DeploymentStage): DeploymentStage | null {
  switch (current) {
    case "paper":
      return "grayscale"
    case "grayscale":
      return "production"
    case "production":
      return null
    default:
      return null
  }
}

export function getPreviousStage(
  current: DeploymentStage
): DeploymentStage | null {
  switch (current) {
    case "production":
      return "grayscale"
    case "grayscale":
      return "paper"
    case "paper":
      return null
    default:
      return null
  }
}

export function getCapitalForStage(
  stage: DeploymentStage,
  totalCapital: number,
  grayscalePct: number,
  productionPct: number
): number {
  switch (stage) {
    case "paper":
      return 0
    case "grayscale":
      return totalCapital * grayscalePct
    case "production":
      return totalCapital * productionPct
    default:
      return 0
  }
}

export function loadDeploymentConfig(path: string): DeploymentConfig {
  try {
    const raw = require("node:fs").readFileSync(path, "utf8")
    const config = JSON.parse(raw) as Partial<DeploymentConfig>
    return createDeploymentConfig(config)
  } catch {
    return DEFAULT_DEPLOYMENT_CONFIG
  }
}

export function saveDeploymentConfig(
  config: DeploymentConfig,
  path: string
): void {
  require("node:fs").writeFileSync(
    path,
    JSON.stringify(config, null, 2),
    "utf8"
  )
}
