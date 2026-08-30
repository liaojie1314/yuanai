import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from 'node:crypto'
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto'

/** 执行节点协议的当前版本，与后端 execution_node_protocol_version 保持一致。 */
export const EXECUTION_NODE_PROTOCOL_VERSION = '1'

/** 服务端下发的挑战消息。 */
export interface ServerChallengeMessage {
  type: 'challenge'
  challenge: string
  protocol_version: string
}

/** 服务端投递的节点任务，参数与有效期由服务端签名保护。 */
export interface ServerJobOfferMessage {
  type: 'job_offer'
  protocol_version: string
  execution_id: string
  tool_name: string
  tool_version: string
  arguments: Record<string, unknown>
  arguments_preview: string
  policy: Record<string, unknown>
  expires_at: string
  signature: string
}

/** 服务端同步的任务状态。 */
export interface ServerJobStatusMessage {
  type: 'job_status'
  execution_id: string
  status: string
}

/** 服务端请求节点取消正在执行的任务。 */
export interface ServerCancelRequestMessage {
  type: 'cancel_request'
  execution_id: string
}

/** 服务端要求节点重发尚未被确认的终态结果。 */
export interface ServerResultReplayRequestMessage {
  type: 'result_replay_request'
  execution_id: string
  status: string
}

/** 服务端对节点心跳的确认。 */
export interface ServerHeartbeatAckMessage {
  type: 'heartbeat_ack'
  timestamp: string
}

/** 服务端对节点接受任务的确认。 */
export interface ServerAcceptedAckMessage {
  type: 'accepted_ack'
  execution_id: string
}

/** 服务端对节点拒绝任务的确认。 */
export interface ServerRejectedAckMessage {
  type: 'rejected_ack'
  execution_id: string
}

/** 服务端对节点进度上报的确认。 */
export interface ServerProgressAckMessage {
  type: 'progress_ack'
  execution_id: string
  progress: number
}

/** 服务端确认已收到节点终态，等待节点回 ACK。 */
export interface ServerAckMessage {
  type: 'ack'
  execution_id: string
}

/** 服务端确认节点的 ACK，节点此时可以清除离线暂存。 */
export interface ServerAcknowledgedMessage {
  type: 'acknowledged'
  execution_id: string
}

/** 服务端推送的全部已知消息类型。 */
export type ServerMessage =
  | ServerChallengeMessage
  | ServerJobOfferMessage
  | ServerJobStatusMessage
  | ServerCancelRequestMessage
  | ServerResultReplayRequestMessage
  | ServerHeartbeatAckMessage
  | ServerAcceptedAckMessage
  | ServerRejectedAckMessage
  | ServerProgressAckMessage
  | ServerAckMessage
  | ServerAcknowledgedMessage

/** 节点对挑战的签名应答。 */
export interface NodeChallengeResponseMessage {
  type: 'challenge_response'
  signature: string
}

/** 节点心跳。 */
export interface NodeHeartbeatMessage {
  type: 'heartbeat'
}

/** 节点接受任务。 */
export interface NodeAcceptedMessage {
  type: 'accepted'
  execution_id: string
}

/** 节点拒绝任务。 */
export interface NodeRejectedMessage {
  type: 'rejected'
  execution_id: string
}

/** 节点上报执行进度。 */
export interface NodeProgressMessage {
  type: 'progress'
  execution_id: string
  progress: number
}

/** 节点终态消息；result、error_code、error_message、progress 必须同时存在。 */
export interface NodeTerminalMessage {
  type: 'completed' | 'failed' | 'cancelled'
  execution_id: string
  result: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
  progress: number | null
  signature: string
}

/** 节点对服务端 ACK 的确认。 */
export interface NodeAckMessage {
  type: 'ack'
  execution_id: string
}

/** 节点发送的全部消息类型。 */
export type NodeMessage =
  | NodeChallengeResponseMessage
  | NodeHeartbeatMessage
  | NodeAcceptedMessage
  | NodeRejectedMessage
  | NodeProgressMessage
  | NodeTerminalMessage
  | NodeAckMessage

/** 节点私钥在协议层的表达；JWK 便于持久化，KeyObject 便于直接签名。 */
export type NodePrivateKey = CryptoJsonWebKey | KeyObject

/** 节点公钥在协议层的表达。 */
export type NodePublicKey = Exclude<CryptoJsonWebKey, never> | KeyObject

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const textEncoder = new TextEncoder()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left)
  const rightPoints = Array.from(right)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const leftCode = leftPoints[index]?.codePointAt(0) ?? 0
    const rightCode = rightPoints[index]?.codePointAt(0) ?? 0
    if (leftCode !== rightCode) return leftCode - rightCode
  }
  return leftPoints.length - rightPoints.length
}

function serializeString(value: string): string {
  return JSON.stringify(value)
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('CANONICAL_JSON_VALUE_INVALID')
  return JSON.stringify(value)
}

function serializeCanonical(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return serializeNumber(value)
    case 'string':
      return serializeString(value)
    case 'object':
      break
    default:
      throw new Error('CANONICAL_JSON_VALUE_INVALID')
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined
  )
  entries.sort(([left], [right]) => compareCodePoints(left, right))
  return `{${entries
    .map(([key, item]) => `${serializeString(key)}:${serializeCanonical(item)}`)
    .join(',')}}`
}

/**
 * 生成与后端 json.dumps(ensure_ascii=False, sort_keys=True, separators=(',',':'))
 * 字节级一致的规范化 JSON 文本。
 * @param value 限定为 JSON 可序列化值；undefined、函数、BigInt、NaN 等非法值抛错
 * @returns 紧凑、键按 Unicode 码点排序的 JSON 字符串
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value)
}

/**
 * 计算规范化 JSON 序列化后的 UTF-8 字节数，用于发送前的大小限制检查。
 * @param value 待测量的 JSON 可序列化值
 * @returns 规范化 JSON 的 UTF-8 字节长度
 */
export function canonicalJsonByteLength(value: unknown): number {
  return textEncoder.encode(canonicalJson(value)).byteLength
}

/**
 * 把任意二进制编码为无填充 Base64URL，与后端 base64url 编码一致。
 * @param bytes 原始字节
 * @returns 无填充 Base64URL 字符串
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] ?? 0
    const byte1 = bytes[index + 1]
    const byte2 = bytes[index + 2]
    output += BASE64URL_ALPHABET[byte0 >> 2]
    output += BASE64URL_ALPHABET[((byte0 & 0x03) << 4) | ((byte1 ?? 0) >> 4)]
    if (byte1 === undefined) break
    output += BASE64URL_ALPHABET[((byte1 & 0x0f) << 2) | ((byte2 ?? 0) >> 6)]
    if (byte2 === undefined) break
    output += BASE64URL_ALPHABET[byte2 & 0x3f]
  }
  return output
}

/** encodeBase64Url 的语义别名，便于调用方按习惯命名。 */
export const toBase64Url = encodeBase64Url

function toKeyObject(privateKey: NodePrivateKey): KeyObject {
  if (privateKey instanceof KeyObject) return privateKey
  return createPrivateKey({ key: privateKey, format: 'jwk' })
}

/**
 * 生成一对新的 Ed25519 密钥，公钥按协议格式编码。
 * @returns 无填充 Base64URL 公钥与可持久化的 JWK 私钥
 */
export function generateEd25519KeyPair(): {
  publicKeyBase64Url: string
  privateKeyJwk: CryptoJsonWebKey
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyJwk = publicKey.export({ format: 'jwk' })
  const rawPublicKey = Buffer.from(publicKeyJwk.x ?? '', 'base64url')
  return {
    publicKeyBase64Url: encodeBase64Url(rawPublicKey),
    privateKeyJwk: privateKey.export({ format: 'jwk' }),
  }
}

/**
 * 使用节点私钥对任意字节签名，返回原始签名字节。
 * @param privateKey JWK 或 KeyObject 形式的 Ed25519 私钥
 * @param data 待签名的 UTF-8 或二进制数据
 * @returns 64 字节 Ed25519 签名
 */
export function signBytes(privateKey: NodePrivateKey, data: Uint8Array): Uint8Array {
  return sign(null, Buffer.from(data), toKeyObject(privateKey))
}

/**
 * 使用节点公钥验证签名，主要供跨语言测试向量与调试使用。
 * @param publicKey JWK 或 KeyObject 形式的 Ed25519 公钥
 * @param data 被签名的原始数据
 * @param signature 待验证的签名字节
 * @returns 签名是否有效
 */
export function verifyBytes(
  publicKey: NodePublicKey,
  data: Uint8Array,
  signature: Uint8Array
): boolean {
  const key =
    publicKey instanceof KeyObject ? publicKey : createPublicKey({ key: publicKey, format: 'jwk' })
  try {
    return verify(null, Buffer.from(data), key, Buffer.from(signature))
  } catch {
    return false
  }
}

/** 构造签名终态消息所需的字段。 */
export interface TerminalMessageInput {
  /** 终态类型。 */
  type: 'completed' | 'failed' | 'cancelled'
  /** 服务端执行 ID。 */
  executionId: string
  /** 成功结果；失败或取消时为 null。 */
  result: Record<string, unknown> | null
  /** 稳定错误码；无错误时为 null。 */
  errorCode: string | null
  /** 人类可读错误说明；无错误时为 null。 */
  errorMessage: string | null
  /** 最近一次进度；无进度时为 null。 */
  progress: number | null
}

/**
 * 按后端 _verify_node_result 的约定构造带签名的终态消息。
 * @param input 终态字段
 * @param privateKey 节点登记私钥
 * @returns 可直接发送的 snake_case 终态消息，四个可选键始终存在
 */
export function buildSignedTerminalMessage(
  input: TerminalMessageInput,
  privateKey: NodePrivateKey
): NodeTerminalMessage {
  const payload = {
    type: input.type,
    execution_id: input.executionId,
    result: input.result,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    progress: input.progress,
  }
  const signature = encodeBase64Url(
    signBytes(privateKey, textEncoder.encode(canonicalJson(payload)))
  )
  return { ...payload, signature }
}

/**
 * 验证一条终态消息的签名是否由给定公钥生成，供测试与调试使用。
 * @param message 待验证的终态消息
 * @param publicKey 节点登记公钥对应的 JWK
 * @returns 签名是否与消息体一致
 */
export function verifyTerminalMessageSignature(
  message: NodeTerminalMessage,
  publicKey: CryptoJsonWebKey
): boolean {
  const payload = {
    type: message.type,
    execution_id: message.execution_id,
    result: message.result,
    error_code: message.error_code,
    error_message: message.error_message,
    progress: message.progress,
  }
  try {
    const signature = Buffer.from(message.signature, 'base64url')
    return verifyBytes(publicKey, textEncoder.encode(canonicalJson(payload)), signature)
  } catch {
    return false
  }
}

function readString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function parseChallenge(value: Record<string, unknown>): ServerChallengeMessage | null {
  const challenge = readString(value['challenge'], 200)
  const protocolVersion = readString(value['protocol_version'], 20)
  return challenge && protocolVersion
    ? { type: 'challenge', challenge, protocol_version: protocolVersion }
    : null
}

function parseJobOffer(value: Record<string, unknown>): ServerJobOfferMessage | null {
  const executionId = readString(value['execution_id'], 64)
  const toolName = readString(value['tool_name'], 120)
  const toolVersion = readString(value['tool_version'], 40)
  const protocolVersion = readString(value['protocol_version'], 20)
  const preview = typeof value['arguments_preview'] === 'string' ? value['arguments_preview'] : ''
  const expiresAt = readString(value['expires_at'], 60)
  const signature = readString(value['signature'], 200)
  if (!executionId || !toolName || !toolVersion || !protocolVersion || !expiresAt || !signature) {
    return null
  }
  if (!isRecord(value['arguments']) || !isRecord(value['policy'])) return null
  return {
    type: 'job_offer',
    protocol_version: protocolVersion,
    execution_id: executionId,
    tool_name: toolName,
    tool_version: toolVersion,
    arguments: value['arguments'],
    arguments_preview: preview,
    policy: value['policy'],
    expires_at: expiresAt,
    signature,
  }
}

function parseExecutionRef(value: Record<string, unknown>): string | null {
  return readString(value['execution_id'], 64)
}

/**
 * 解析并校验服务端推送的一条 JSON 消息；形状不符或类型未知时返回 null。
 * @param raw WebSocket 文本帧内容
 * @returns 强类型的消息对象；无法识别时为 null
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isRecord(raw)) return null
  const type = raw['type']
  switch (type) {
    case 'challenge':
      return parseChallenge(raw)
    case 'job_offer':
      return parseJobOffer(raw)
    case 'job_status': {
      const executionId = parseExecutionRef(raw)
      const status = readString(raw['status'], 40)
      return executionId && status
        ? { type: 'job_status', execution_id: executionId, status }
        : null
    }
    case 'cancel_request': {
      const executionId = parseExecutionRef(raw)
      return executionId ? { type: 'cancel_request', execution_id: executionId } : null
    }
    case 'result_replay_request': {
      const executionId = parseExecutionRef(raw)
      const status = readString(raw['status'], 40)
      return executionId && status
        ? { type: 'result_replay_request', execution_id: executionId, status }
        : null
    }
    case 'heartbeat_ack': {
      const timestamp = readString(raw['timestamp'], 60)
      return timestamp ? { type: 'heartbeat_ack', timestamp } : null
    }
    case 'accepted_ack':
    case 'rejected_ack':
    case 'ack':
    case 'acknowledged': {
      const executionId = parseExecutionRef(raw)
      return executionId ? ({ type, execution_id: executionId } as ServerMessage) : null
    }
    case 'progress_ack': {
      const executionId = parseExecutionRef(raw)
      const progress = raw['progress']
      if (!executionId || typeof progress !== 'number' || !Number.isInteger(progress)) return null
      return { type: 'progress_ack', execution_id: executionId, progress }
    }
    default:
      return null
  }
}
