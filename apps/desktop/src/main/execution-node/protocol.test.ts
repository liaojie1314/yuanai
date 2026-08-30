import { createPublicKey } from 'node:crypto'
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  buildSignedTerminalMessage,
  canonicalJson,
  canonicalJsonByteLength,
  encodeBase64Url,
  generateEd25519KeyPair,
  parseServerMessage,
  signBytes,
  toBase64Url,
  verifyBytes,
  verifyTerminalMessageSignature,
} from './protocol'

// 由 Python cryptography 生成并固定的跨语言测试向量，禁止改动。
const VECTOR_SEED_BASE64URL = 'K7UdX5qy6toGrZnZ0tCs6QJqpKmQMihqUisoHCKgBNk'
const VECTOR_PUBLIC_KEY_BASE64URL = 'BB63q62_mY8pgtSP4uUz6I5XZvGjbxIGBMrigxi97Iw'
const VECTOR_MESSAGE_HEX =
  '7b2261223a22e580bc222c2262223a312c226e6573746564223a7b2261223a6e756c6c2c227a223a747275657d7d'
const VECTOR_SIGNATURE_BASE64URL =
  'UjWn28H5qeZyMo3-gqHWlDddhga5RcfWe24CstWkIebTE3fo41ODzjVwx6vbns2Q95mVWfnfrGGMOfgx-gV7CA'

function loadVectorPrivateJwk(): CryptoJsonWebKey {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    d: VECTOR_SEED_BASE64URL,
    x: VECTOR_PUBLIC_KEY_BASE64URL,
  }
}

describe('canonicalJson', () => {
  it('matches the Python cryptography cross-language vector byte for byte', () => {
    const canonical = canonicalJson({ a: '值', b: 1, nested: { a: null, z: true } })

    expect(Buffer.from(canonical, 'utf8').toString('hex')).toBe(VECTOR_MESSAGE_HEX)
    expect(canonical).toBe('{"a":"值","b":1,"nested":{"a":null,"z":true}}')
  })

  it('sorts object keys recursively by code point and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,1,2]},"b":1}'
    )
  })

  it('orders astral-plane keys by code point like Python does', () => {
    const canonical = canonicalJson({ '￿': 1, '𐀀': 2 })

    expect(canonical).toBe('{"￿":1,"𐀀":2}')
  })

  it('escapes control characters without escaping non-ASCII text', () => {
    expect(canonicalJson({ text: 'a\nb"\\值' })).toBe('{"text":"a\\nb\\"\\\\值"}')
  })

  it('rejects values that are not JSON serializable', () => {
    expect(() => canonicalJson(undefined)).toThrow('CANONICAL_JSON_VALUE_INVALID')
    expect(() => canonicalJson(Number.NaN)).toThrow('CANONICAL_JSON_VALUE_INVALID')
    expect(() => canonicalJson(() => 'x')).toThrow('CANONICAL_JSON_VALUE_INVALID')
    expect(() => canonicalJson({ bad: BigInt(1) })).toThrow()
  })

  it('measures canonical UTF-8 byte length', () => {
    expect(canonicalJsonByteLength({ a: '值' })).toBe(11)
  })
})

describe('base64url', () => {
  it('encodes without padding and agrees on the reference message', () => {
    const bytes = new Uint8Array(Buffer.from(VECTOR_PUBLIC_KEY_BASE64URL, 'base64url'))

    expect(encodeBase64Url(bytes)).toBe(VECTOR_PUBLIC_KEY_BASE64URL)
    expect(toBase64Url(new Uint8Array([251]))).toBe('-w')
  })
})

describe('ed25519 signing', () => {
  it('reproduces the Python-generated signature for the fixed vector', () => {
    const privateKeyJwk = loadVectorPrivateJwk()
    const message = new Uint8Array(Buffer.from(VECTOR_MESSAGE_HEX, 'hex'))

    const signature = signBytes(privateKeyJwk, message)

    expect(encodeBase64Url(signature)).toBe(VECTOR_SIGNATURE_BASE64URL)
  })

  it('verifies the vector signature with the paired public key', () => {
    const message = new Uint8Array(Buffer.from(VECTOR_MESSAGE_HEX, 'hex'))
    const signature = Buffer.from(VECTOR_SIGNATURE_BASE64URL, 'base64url')
    const publicKeyJwk: CryptoJsonWebKey = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: VECTOR_PUBLIC_KEY_BASE64URL,
    }

    expect(verifyBytes(publicKeyJwk, message, signature)).toBe(true)
    expect(
      verifyBytes(createPublicKey({ key: publicKeyJwk, format: 'jwk' }), message, signature)
    ).toBe(true)
    expect(verifyBytes(publicKeyJwk, message, Buffer.from('broken'.repeat(10)))).toBe(false)
  })

  it('generates working key pairs in the protocol wire format', () => {
    const { publicKeyBase64Url, privateKeyJwk } = generateEd25519KeyPair()

    expect(publicKeyBase64Url).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(privateKeyJwk.kty).toBe('OKP')
    const signature = signBytes(privateKeyJwk, new TextEncoder().encode('challenge'))
    expect(
      verifyBytes(
        { kty: 'OKP', crv: 'Ed25519', x: publicKeyBase64Url },
        new TextEncoder().encode('challenge'),
        signature
      )
    ).toBe(true)
  })
})

describe('buildSignedTerminalMessage', () => {
  it('signs the canonical payload and always includes the four optional keys', () => {
    const { publicKeyBase64Url, privateKeyJwk } = generateEd25519KeyPair()
    const executionId = '0d9d1a2b-0000-4000-8000-000000000001'

    const completed = buildSignedTerminalMessage(
      {
        type: 'completed',
        executionId,
        result: { opened: true },
        errorCode: null,
        errorMessage: null,
        progress: null,
      },
      privateKeyJwk
    )

    expect(completed).toEqual({
      type: 'completed',
      execution_id: executionId,
      result: { opened: true },
      error_code: null,
      error_message: null,
      progress: null,
      signature: expect.any(String),
    })
    expect(
      verifyTerminalMessageSignature(completed, {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKeyBase64Url,
      })
    ).toBe(true)

    const failed = buildSignedTerminalMessage(
      {
        type: 'failed',
        executionId,
        result: null,
        errorCode: 'TOOL_EXECUTION_FAILED',
        errorMessage: '读取失败',
        progress: 40,
      },
      privateKeyJwk
    )

    expect(failed.result).toBeNull()
    expect(failed.error_code).toBe('TOOL_EXECUTION_FAILED')
    expect(failed.progress).toBe(40)
    expect(
      verifyTerminalMessageSignature(failed, {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKeyBase64Url,
      })
    ).toBe(true)

    const tampered = { ...completed, result: { opened: false } }
    expect(
      verifyTerminalMessageSignature(tampered, {
        kty: 'OKP',
        crv: 'Ed25519',
        x: publicKeyBase64Url,
      })
    ).toBe(false)
  })
})

describe('parseServerMessage', () => {
  it('parses every known server message shape', () => {
    expect(
      parseServerMessage({ type: 'challenge', challenge: 'nonce', protocol_version: '1' })
    ).toEqual({ type: 'challenge', challenge: 'nonce', protocol_version: '1' })
    expect(
      parseServerMessage({
        type: 'job_offer',
        protocol_version: '1',
        execution_id: 'exec-1',
        tool_name: 'browser_open_url',
        tool_version: '1.0.0',
        arguments: { url: 'https://example.com' },
        arguments_preview: '{}',
        policy: { allowed_tools: ['browser_open_url'] },
        expires_at: '2026-01-01T00:00:00Z',
        signature: 'sig',
      })
    ).toMatchObject({ type: 'job_offer', execution_id: 'exec-1' })
    expect(
      parseServerMessage({ type: 'job_status', execution_id: 'exec-1', status: 'running' })
    ).toEqual({
      type: 'job_status',
      execution_id: 'exec-1',
      status: 'running',
    })
    expect(parseServerMessage({ type: 'cancel_request', execution_id: 'exec-1' })).toEqual({
      type: 'cancel_request',
      execution_id: 'exec-1',
    })
    expect(
      parseServerMessage({
        type: 'result_replay_request',
        execution_id: 'exec-1',
        status: 'succeeded',
      })
    ).toEqual({ type: 'result_replay_request', execution_id: 'exec-1', status: 'succeeded' })
    expect(
      parseServerMessage({ type: 'heartbeat_ack', timestamp: '2026-01-01T00:00:00Z' })
    ).toEqual({
      type: 'heartbeat_ack',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(parseServerMessage({ type: 'accepted_ack', execution_id: 'exec-1' })).toEqual({
      type: 'accepted_ack',
      execution_id: 'exec-1',
    })
    expect(
      parseServerMessage({ type: 'progress_ack', execution_id: 'exec-1', progress: 50 })
    ).toEqual({
      type: 'progress_ack',
      execution_id: 'exec-1',
      progress: 50,
    })
    expect(parseServerMessage({ type: 'ack', execution_id: 'exec-1' })).toEqual({
      type: 'ack',
      execution_id: 'exec-1',
    })
    expect(parseServerMessage({ type: 'acknowledged', execution_id: 'exec-1' })).toEqual({
      type: 'acknowledged',
      execution_id: 'exec-1',
    })
  })

  it('returns null for malformed or unknown messages instead of throwing', () => {
    expect(parseServerMessage('text')).toBeNull()
    expect(parseServerMessage({ type: 'challenge' })).toBeNull()
    expect(parseServerMessage({ type: 'job_offer', execution_id: 'exec-1' })).toBeNull()
    expect(parseServerMessage({ type: 'mystery', data: 1 })).toBeNull()
    expect(
      parseServerMessage({ type: 'progress_ack', execution_id: 'exec-1', progress: 1.5 })
    ).toBeNull()
  })
})
