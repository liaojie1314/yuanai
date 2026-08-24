'use client'

import { useEffect, useState, type JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Check, Save } from 'lucide-react'
import { listAssistants } from '@yuanai/core/api'
import './agent.css'

/** Agent 默认助理和功能开关设置页。 */
export default function AgentSettings(): JSX.Element {
  const query = useQuery({ queryKey: ['assistants'], queryFn: listAssistants })
  const [selected, setSelected] = useState('')
  const [enabled, setEnabled] = useState(false)
  const assistant = query.data?.find((item) => item.id === selected) ?? query.data?.[0]
  const save = (): void => {
    if (!assistant) return
    window.localStorage.setItem('yuanai-agent-enabled', enabled ? '1' : '0')
    void query.refetch()
  }
  useEffect(() => {
    setEnabled(window.localStorage.getItem('yuanai-agent-enabled') === '1')
  }, [])
  return (
    <main className="agent-shell">
      <section className="agent-settings-page">
        <header className="agent-page-header">
          <div>
            <span className="agent-eyebrow">Preferences</span>
            <h1>Agent 设置</h1>
            <p>管理默认助理。Agent 功能默认关闭，开启后仅影响你自己的任务。</p>
          </div>
          <Bot size={28} />
        </header>
        <div className="agent-settings-panel">
          <label htmlFor="agent-assistant">默认助理</label>
          <select
            id="agent-assistant"
            value={assistant?.id ?? ''}
            onChange={(event) => setSelected(event.target.value)}
          >
            {(query.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label className="agent-toggle-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            允许在聊天中显示 Agent 模式
          </label>
          <button
            type="button"
            className="agent-btn agent-btn-primary"
            onClick={save}
            disabled={!assistant}
          >
            <Save size={15} />
            保存设置
          </button>
          {assistant?.isDefault ? (
            <span className="agent-muted">
              <Check size={14} /> 当前助理为默认
            </span>
          ) : null}
        </div>
      </section>
    </main>
  )
}
