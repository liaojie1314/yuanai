import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactElement } from 'react'

import { parseCsv } from '@yuanai/core/utils'

/** Artifact 数据预览所需的语言与原始文本。 */
export interface DataPreviewProps {
  /** 当前数据语言，仅支持 JSON 或 CSV。 */
  lang: string
  /** 原始 JSON 或 CSV 内容。 */
  code: string
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 递归显示 JSON 节点，并允许折叠对象和数组。 */
function JsonNode({ name, value }: { name?: string; value: unknown }): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const isArray = Array.isArray(value)
  const isBranch = isArray || isRecord(value)

  if (!isBranch) {
    const valueClass =
      value === null
        ? 'artifact-data__value artifact-data__value--null'
        : typeof value === 'string'
          ? 'artifact-data__value artifact-data__value--string'
          : typeof value === 'number'
            ? 'artifact-data__value artifact-data__value--number'
            : typeof value === 'boolean'
              ? 'artifact-data__value artifact-data__value--boolean'
              : 'artifact-data__value'
    const text = typeof value === 'string' ? `"${value}"` : String(value)

    return (
      <div className="artifact-data__json-row">
        {name === undefined ? null : <span className="artifact-data__key">{name}: </span>}
        <span className={valueClass}>{text}</span>
      </div>
    )
  }

  const entries: Array<[string, unknown]> = isArray
    ? value.map((entry, index) => [String(index), entry])
    : Object.entries(value)
  const openSymbol = isArray ? '[' : '{'
  const closeSymbol = isArray ? ']' : '}'

  return (
    <div className="artifact-data__json-node">
      <button
        type="button"
        className="artifact-data__json-row artifact-data__branch"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed ? (
          <ChevronRight size={13} aria-hidden="true" />
        ) : (
          <ChevronDown size={13} aria-hidden="true" />
        )}
        {name === undefined ? null : <span className="artifact-data__key">{name}: </span>}
        <span className="artifact-data__value">
          {openSymbol}
          {collapsed ? ` ... ${entries.length} ${closeSymbol}` : ''}
        </span>
      </button>
      {collapsed ? null : (
        <div className="artifact-data__json-children">
          {entries.map(([entryName, entryValue]) => (
            <JsonNode key={entryName} name={entryName} value={entryValue} />
          ))}
          <div className="artifact-data__json-row artifact-data__value">{closeSymbol}</div>
        </div>
      )}
    </div>
  )
}

/**
 * 在独立 Artifact 窗口中预览 JSON 树或 CSV 表格。
 * @param props 数据语言和原始文本。
 * @returns JSON 树、CSV 表格或可读的解析错误。
 */
export function DataPreview({ lang, code }: DataPreviewProps): ReactElement {
  if (lang.trim().toLowerCase() === 'csv') {
    const rows = parseCsv(code)
    if (rows.length === 0) {
      return <div className="artifact-data artifact-data__empty">CSV 没有可预览的数据</div>
    }

    const [header, ...body] = rows
    return (
      <div className="artifact-data">
        <div className="artifact-data__table-scroll">
          <table className="artifact-data__table">
            <thead>
              <tr>
                {(header ?? []).map((cell, index) => (
                  <th key={`${cell}-${index}`}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cell}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  try {
    const value: unknown = JSON.parse(code)
    return (
      <div className="artifact-data artifact-data__json">
        <JsonNode value={value} />
      </div>
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '无法解析 JSON 数据'
    return <div className="artifact-data artifact-data__error">JSON 解析失败：{message}</div>
  }
}
