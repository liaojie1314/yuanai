import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopExecutionNodeStatus } from '../../../shared/ipc-contract'
import '../../shared/i18n'
import { ExecutionNodeSection } from './ExecutionNodeSection'

vi.mock('@yuanai/core/api', () => ({
  pairExecutionNode: vi.fn(),
  createResourceGrant: vi.fn(),
}))

import { createResourceGrant, pairExecutionNode } from '@yuanai/core/api'

const getStatus = vi.fn()
const register = vi.fn()
const disconnect = vi.fn()
const removeNode = vi.fn()
const respondJob = vi.fn()
const createGrant = vi.fn()
const revokeGrant = vi.fn()

let statusListener: ((status: DesktopExecutionNodeStatus) => void) | null = null

const onlineStatus: DesktopExecutionNodeStatus = {
  state: 'online',
  nodeId: 'node-1',
  name: '测试节点',
  capabilities: ['browser_open_url', 'read_granted_file'],
  currentJob: null,
  pendingJob: null,
  lastError: null,
  tokenExpiresAt: '2026-08-30T12:00:00Z',
  grants: [],
}

const idleStatus: DesktopExecutionNodeStatus = {
  state: 'idle',
  capabilities: [],
  currentJob: null,
  pendingJob: null,
  lastError: null,
  tokenExpiresAt: null,
  grants: [],
}

beforeEach(() => {
  statusListener = null
  vi.mocked(pairExecutionNode).mockReset()
  vi.mocked(createResourceGrant).mockReset()
  getStatus.mockResolvedValue(idleStatus)
  register.mockResolvedValue(onlineStatus)
  createGrant.mockResolvedValue(null)
  Object.defineProperty(window, 'yuanai', {
    configurable: true,
    value: {
      platform: 'linux',
      system: { getInfo: vi.fn().mockResolvedValue({ version: '0.1.0', platform: 'linux' }) },
      executionNode: {
        getStatus,
        register,
        disconnect,
        removeNode,
        respondJob,
        createGrant,
        revokeGrant,
      },
      events: {
        onExecutionNodeEvent: vi.fn((listener: (status: DesktopExecutionNodeStatus) => void) => {
          statusListener = listener
          return () => {
            statusListener = null
          }
        }),
      },
    },
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExecutionNodeSection', () => {
  it('未启用时展示启用表单并完成自配对', async () => {
    vi.mocked(pairExecutionNode).mockResolvedValue({
      id: 'node-1',
      userId: 'user-1',
      name: '测试节点',
      platform: 'linux',
      appVersion: '0.1.0',
      capabilities: ['browser_open_url'],
      status: 'offline',
      lastSeenAt: null,
      policy: { allowed_tools: [], allowed_resource_ids: [] },
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
      pairingCode: 'pair-code-123',
      expiresAt: '2026-08-30T00:10:00Z',
    })
    const user = userEvent.setup()
    render(<ExecutionNodeSection />)
    expect(await screen.findByLabelText('节点名称')).toBeInTheDocument()
    await user.type(screen.getByLabelText('节点名称'), '测试节点')
    await user.click(screen.getByRole('button', { name: '启用执行节点' }))
    await waitFor(() => {
      expect(pairExecutionNode).toHaveBeenCalledWith(
        expect.objectContaining({ name: '测试节点', platform: 'linux', appVersion: '0.1.0' })
      )
    })
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ pairingCode: 'pair-code-123', name: '测试节点' })
    )
  })

  it('在线时展示状态、断开与移除入口', async () => {
    getStatus.mockResolvedValue(onlineStatus)
    render(<ExecutionNodeSection />)
    expect(await screen.findByText('测试节点')).toBeInTheDocument()
    expect(screen.getByText(/在线/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '断开连接' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移除本机节点' })).toBeInTheDocument()
  })

  it('在应用内确认移除节点，不调用浏览器原生弹窗', async () => {
    getStatus.mockResolvedValue(onlineStatus)
    removeNode.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ExecutionNodeSection />)

    await user.click(await screen.findByRole('button', { name: '移除本机节点' }))
    expect(screen.getByRole('alertdialog', { name: '移除本机节点' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认操作' }))

    await waitFor(() => expect(removeNode).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alertdialog', { name: '移除本机节点' })).not.toBeInTheDocument()
  })

  it('待确认任务展示参数并支持允许与拒绝', async () => {
    getStatus.mockResolvedValue({
      ...onlineStatus,
      pendingJob: {
        executionId: 'exec-9',
        toolName: 'browser_open_url',
        arguments: { url: 'https://example.com' },
        expiresAt: '2026-08-30T12:02:00Z',
      },
    })
    const user = userEvent.setup()
    render(<ExecutionNodeSection />)
    expect(await screen.findByText('待确认任务')).toBeInTheDocument()
    expect(screen.getByText(/参数: \{"url"/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '允许本次执行' }))
    await waitFor(() => {
      expect(respondJob).toHaveBeenCalledWith({ executionId: 'exec-9', decision: 'accept' })
    })
    await user.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() => {
      expect(respondJob).toHaveBeenCalledWith({ executionId: 'exec-9', decision: 'reject' })
    })
  })

  it('创建本地授权后注册云端元数据', async () => {
    getStatus.mockResolvedValue(onlineStatus)
    createGrant.mockResolvedValue({
      resourceId: 'res-1',
      kind: 'directory',
      displayName: '项目资料',
      createdAt: '2026-08-30T00:00:00Z',
    })
    vi.mocked(createResourceGrant).mockResolvedValue({
      id: 'grant-1',
      userId: 'user-1',
      nodeId: 'node-1',
      kind: 'directory',
      resourceId: 'res-1',
      displayName: '项目资料',
      scopes: [],
      revokedAt: null,
      createdAt: '2026-08-30T00:00:00Z',
    })
    const user = userEvent.setup()
    render(<ExecutionNodeSection />)
    await screen.findByText('测试节点')
    await user.click(screen.getByRole('button', { name: '授权文件夹…' }))
    await waitFor(() => {
      expect(createResourceGrant).toHaveBeenCalledWith({
        nodeId: 'node-1',
        kind: 'directory',
        resourceId: 'res-1',
        displayName: '项目资料',
      })
    })
  })

  it('事件推送刷新节点状态', async () => {
    getStatus.mockResolvedValue(idleStatus)
    render(<ExecutionNodeSection />)
    await screen.findByLabelText('节点名称')
    await act(async () => {
      statusListener?.(onlineStatus)
    })
    expect(await screen.findByText('测试节点')).toBeInTheDocument()
  })
})
