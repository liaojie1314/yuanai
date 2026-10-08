/**
 * 后端 `detail` 码到用户可读文案的唯一出口。
 *
 * 后端的 `HTTPException` 有两种 detail 形状：直接给码（`detail="MEMORY_NOT_FOUND"`）
 * 和包一层（`detail={"code": …, "message": …}`），两种都在本仓真实存在，所以都要认。
 */

/**
 * 有对应文案的 detail 码。
 *
 * 必须与 `i18n/locales/*.json` 的 `errors` 命名空间保持一致，否则用户看到的是键名；
 * `apiError.test.ts` 有一条用例盯住这个一致性。
 */
export const KNOWN_API_ERROR_CODES: ReadonlySet<string> = new Set([
  'ASSISTANT_NOT_FOUND',
  'LOCAL_MEMORY_APPROVAL_TIMEOUT',
  'LOCAL_MEMORY_NODE_UNAVAILABLE',
  'MEMORY_NOT_FOUND',
  'MEMORY_SCOPE_DUPLICATE',
  'PERSONA_CANDIDATE_ALREADY_DECIDED',
  'PERSONA_FIELD_NOT_EDITABLE',
  'PERSONA_VALUE_INVALID',
])

/** 从未知结构里安全取出一个字段，取不到返回 `undefined`。 */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}

/** 取出响应体里的 detail 码，两种 detail 形状都认，取不到返回 `null`。 */
function readDetailCode(error: unknown): string | null {
  const detail = readField(readField(readField(error, 'response'), 'data'), 'detail')
  if (typeof detail === 'string') return detail
  const code = readField(detail, 'code')
  return typeof code === 'string' ? code : null
}

/**
 * 把一个请求错误翻成用户能读懂的一句话。
 *
 * 未知码一律退回 `errors.generic`：把原始码直接显示给用户，只是把「操作失败」
 * 换成另一串看不懂的字，对用户没有任何帮助。
 * @param error 捕获到的错误，通常是 axios 抛出的那个
 * @param t 作用于语言包根的翻译函数（`useTranslations()` 不带命名空间）
 */
export function resolveApiErrorMessage(error: unknown, t: (key: string) => string): string {
  const code = readDetailCode(error)
  return t(code !== null && KNOWN_API_ERROR_CODES.has(code) ? `errors.${code}` : 'errors.generic')
}
