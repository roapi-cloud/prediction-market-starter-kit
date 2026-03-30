import type { IDataSource, DataSourceConfig } from "./types"
import { RestDataSource } from "./rest-source"
import { WebSocketDataSource } from "./websocket-source"

export function createDataSource(config: DataSourceConfig): IDataSource {
  switch (config.type) {
    case "websocket":
      return new WebSocketDataSource(config.websocket)
    case "rest":
    default:
      return new RestDataSource(config.rest)
  }
}

export { RestDataSource } from "./rest-source"
export { WebSocketDataSource } from "./websocket-source"
export type {
  IDataSource,
  DataSourceConfig,
  DataSourceType,
  DataSourceCallbacks,
} from "./types"
