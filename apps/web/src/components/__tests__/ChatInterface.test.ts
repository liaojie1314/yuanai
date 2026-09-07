import { describe, expect, it } from 'vitest'

import { clampCvMenuPosition } from '../ChatInterface'

describe('clampCvMenuPosition', () => {
  it('keeps the menu inside all viewport edges', () => {
    expect(
      clampCvMenuPosition(
        { top: 790, left: 1190 },
        { width: 180, height: 160 },
        { width: 1280, height: 800 }
      )
    ).toEqual({ top: 632, left: 1092 })
  })

  it('keeps a menu usable in a viewport smaller than the menu', () => {
    expect(
      clampCvMenuPosition(
        { top: -20, left: -20 },
        { width: 400, height: 500 },
        { width: 240, height: 320 }
      )
    ).toEqual({ top: 8, left: 8 })
  })
})
