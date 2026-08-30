import type { IpcMainInvokeEvent } from 'electron'

import type {
  DesktopExecutionNodeGrantView,
  DesktopExecutionNodeStatus,
} from '../../shared/ipc-contract'
import { IPC } from '../../shared/ipc-contract'
import { assertNoIpcPayload, readSingleIpcPayload } from '../../shared/guards'
import type { IpcMainRegistrar } from './auth'
import type { IpcInvocationGuard } from './guards'

/** 执行节点 IPC 所需的最小服务能力，便于测试替换。 */
export interface ExecutionNodeServiceIpc {
  /** 读取净化状态快照。 */
  getStatus(): Promise<DesktopExecutionNodeStatus>
  /** 使用配对码注册节点。 */
  register(input: {
    pairingCode: string
    name: string
    capabilities?: string[]
  }): Promise<DesktopExecutionNodeStatus>
  /** 断开连接但保留身份。 */
  disconnect(): Promise<void>
  /** 注销节点并清除全部本地数据。 */
  removeNode(): Promise<void>
  /** 转发用户对任务的决定。 */
  respondJob(input: { executionId: string; decision: 'accept' | 'reject' }): Promise<void>
  /** 通过原生选择器授予资源。 */
  createGrant(input: { kind: 'file' | 'directory' }): Promise<DesktopExecutionNodeGrantView | null>
  /** 撤销资源授权。 */
  revokeGrant(input: { resourceId: string }): Promise<void>
}

const MAX_PAIRING_CODE_LENGTH = 100
const MAX_NAME_LENGTH = 120
const MAX_EXECUTION_ID_LENGTH = 64
const MAX_RESOURCE_ID_LENGTH = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  return value
}

function readRegisterPayload(args: readonly unknown[]): {
  pairingCode: string
  name: string
  capabilities?: string[]
} {
  const payload = readSingleIpcPayload(args)
  if (!isRecord(payload)) throw new Error('IPC_PAYLOAD_INVALID')
  for (const key of Object.keys(payload)) {
    if (key !== 'pairingCode' && key !== 'name' && key !== 'capabilities') {
      throw new Error('IPC_PAYLOAD_INVALID')
    }
  }
  const pairingCode = readBoundedString(payload['pairingCode'], MAX_PAIRING_CODE_LENGTH)
  const name = readBoundedString(payload['name'], MAX_NAME_LENGTH)
  if (payload['capabilities'] === undefined) {
    return { pairingCode, name }
  }
  const capabilities = payload['capabilities']
  if (
    !Array.isArray(capabilities) ||
    capabilities.some((item) => typeof item !== 'string' || item.length === 0) ||
    capabilities.length > 8
  ) {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  return { pairingCode, name, capabilities: [...capabilities] }
}

function readRespondJobPayload(args: readonly unknown[]): {
  executionId: string
  decision: 'accept' | 'reject'
} {
  const payload = readSingleIpcPayload(args)
  if (!isRecord(payload)) throw new Error('IPC_PAYLOAD_INVALID')
  for (const key of Object.keys(payload)) {
    if (key !== 'executionId' && key !== 'decision') throw new Error('IPC_PAYLOAD_INVALID')
  }
  const executionId = readBoundedString(payload['executionId'], MAX_EXECUTION_ID_LENGTH)
  if (payload['decision'] !== 'accept' && payload['decision'] !== 'reject') {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  return { executionId, decision: payload['decision'] }
}

function readGrantKindPayload(args: readonly unknown[]): 'file' | 'directory' {
  const payload = readSingleIpcPayload(args)
  if (!isRecord(payload)) throw new Error('IPC_PAYLOAD_INVALID')
  for (const key of Object.keys(payload)) {
    if (key !== 'kind') throw new Error('IPC_PAYLOAD_INVALID')
  }
  if (payload['kind'] !== 'file' && payload['kind'] !== 'directory') {
    throw new Error('IPC_PAYLOAD_INVALID')
  }
  return payload['kind']
}

function readResourceIdPayload(args: readonly unknown[]): string {
  const payload = readSingleIpcPayload(args)
  if (!isRecord(payload)) throw new Error('IPC_PAYLOAD_INVALID')
  for (const key of Object.keys(payload)) {
    if (key !== 'resourceId') throw new Error('IPC_PAYLOAD_INVALID')
  }
  return readBoundedString(payload['resourceId'], MAX_RESOURCE_ID_LENGTH)
}

/** 注册只暴露固定受限动作的执行节点 IPC 处理器。 */
export function registerExecutionNodeIpcHandlers(options: {
  ipcMain: IpcMainRegistrar
  guard: IpcInvocationGuard
  executionNodeService: ExecutionNodeServiceIpc
}): void {
  options.ipcMain.handle(
    IPC.executionNode.getStatus,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      return options.executionNodeService.getStatus()
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.register,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      return options.executionNodeService.register(readRegisterPayload(args))
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.disconnect,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      await options.executionNodeService.disconnect()
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.removeNode,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      assertNoIpcPayload(args)
      await options.executionNodeService.removeNode()
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.respondJob,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      await options.executionNodeService.respondJob(readRespondJobPayload(args))
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.createGrant,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      return options.executionNodeService.createGrant({ kind: readGrantKindPayload(args) })
    }
  )
  options.ipcMain.handle(
    IPC.executionNode.revokeGrant,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      options.guard.assertTrusted(event)
      await options.executionNodeService.revokeGrant({ resourceId: readResourceIdPayload(args) })
    }
  )
}
