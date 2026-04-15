'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type SliderProps = {
  className?: string
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onValueChange?: (value: number[]) => void
}

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  onValueChange,
}: SliderProps) {
  const current = value?.[0] ?? defaultValue?.[0] ?? min

  return (
    <div className={cn('relative flex w-full items-center', disabled && 'opacity-50', className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={current}
        onChange={(e) => onValueChange?.([Number(e.target.value)])}
        className="w-full cursor-pointer accent-primary"
      />
    </div>
  )
}

export { Slider }
