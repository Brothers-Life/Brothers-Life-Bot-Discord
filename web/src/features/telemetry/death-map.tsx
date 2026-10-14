import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dt } from './format'
import { WORLD as B, ZONES } from './zones'

// Zoomable canvas of the GTA V world: heat map or points of the deaths, zone names, a 1000-unit grid.
// No background image (nothing fetched from outside the panel): the world is drawn as a plain frame.
export type MapPoint = { x: number; y: number; z?: number | null; cause: string | null; player_name: string | null; citizenid: string | null; killer_name: string | null; killer_cid?: string | null; weapon?: string | null; ts: string; screenshot_url: string | null }
export type DeathMapHandle = { focus: (x: number, y: number, scale?: number) => void; fit: () => void }

const PALETTE = ['#ff9628', '#3dd6c6', '#ff4d6d', '#8b7bff', '#ffd166', '#34d399']
const colorFor = (s: string | null) => {
  let h = 0
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const isDark = () => document.documentElement.classList.contains('dark')

export function DeathMapCanvas({ points, mode, selected, onSelect, ref }: {
  points: MapPoint[]
  mode: 'heat' | 'points'
  selected: MapPoint | null
  onSelect: (p: MapPoint) => void
  ref?: React.Ref<DeathMapHandle>
}) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef({ cx: 200, cy: 2000, scale: 0.05 })
  const size = useRef({ W: 0, H: 0, dpr: 1 })
  const hovered = useRef<MapPoint | null>(null)
  const brush = useRef<{ img: HTMLCanvasElement; lut: Uint8ClampedArray } | null>(null)
  const raf = useRef(0)
  const state = useRef({ points, mode, selected })
  const [tip, setTip] = useState<{ p: MapPoint; x: number; y: number; w: number } | null>(null)

  const toScreen = (x: number, y: number): [number, number] => {
    const { cx, cy, scale } = view.current
    const { W, H } = size.current
    return [(x - cx) * scale + W / 2, (cy - y) * scale + H / 2]
  }
  const toWorld = (sx: number, sy: number): [number, number] => {
    const { cx, cy, scale } = view.current
    const { W, H } = size.current
    return [(sx - W / 2) / scale + cx, cy - (sy - H / 2) / scale]
  }
  const minScale = () => Math.min(size.current.W / (B.xMax - B.xMin), size.current.H / (B.yMax - B.yMin))

  function makeBrush() {
    const img = document.createElement('canvas')
    img.width = img.height = 64
    const g = img.getContext('2d')!
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    rg.addColorStop(0, 'rgba(0,0,0,1)')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = rg
    g.fillRect(0, 0, 64, 64)
    const l = document.createElement('canvas')
    l.width = 256
    l.height = 1
    const lg = l.getContext('2d')!
    const gr = lg.createLinearGradient(0, 0, 256, 0)
    gr.addColorStop(0, 'rgba(80,60,255,0)')
    gr.addColorStop(0.25, 'rgba(139,123,255,.8)')
    gr.addColorStop(0.55, '#ff4d6d')
    gr.addColorStop(0.8, '#ff9628')
    gr.addColorStop(1, '#ffe08a')
    lg.fillStyle = gr
    lg.fillRect(0, 0, 256, 1)
    brush.current = { img, lut: lg.getImageData(0, 0, 256, 1).data }
  }

  function draw() {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const ctx = canvas.current?.getContext('2d')
      const { W, H, dpr } = size.current
      if (!ctx || !W || !H) return
      const dark = isDark()
      const { points: pts, mode: m, selected: sel } = state.current
      // Base: sea, playable world, grid, zone names
      ctx.fillStyle = dark ? '#0b1622' : '#dfe9f1'
      ctx.fillRect(0, 0, W, H)
      const [x0, y0] = toScreen(B.xMin, B.yMax)
      const [x1, y1] = toScreen(B.xMax, B.yMin)
      ctx.fillStyle = dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.6)'
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(20,14,8,.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 18 * dpr)
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(20,14,8,.06)'
      ctx.beginPath()
      for (let x = Math.ceil(B.xMin / 1000) * 1000; x <= B.xMax; x += 1000) {
        const [sx] = toScreen(x, 0)
        ctx.moveTo(sx, y0)
        ctx.lineTo(sx, y1)
      }
      for (let y = Math.ceil(B.yMin / 1000) * 1000; y <= B.yMax; y += 1000) {
        const [, sy] = toScreen(0, y)
        ctx.moveTo(x0, sy)
        ctx.lineTo(x1, sy)
      }
      ctx.stroke()
      const font = Math.max(10, Math.min(15, view.current.scale * 160)) * dpr
      ctx.font = `600 ${font}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = dark ? 'rgba(255,255,255,.32)' : 'rgba(20,14,8,.42)'
      for (const [name, x, y] of ZONES) {
        const [sx, sy] = toScreen(x, y)
        ctx.fillText(name.toUpperCase(), sx, sy)
      }

      // Heat: alpha accumulated with a radial brush, then coloured through a gradient table
      if (m === 'heat' && pts.length) {
        if (!brush.current) makeBrush()
        const { img, lut } = brush.current!
        const off = document.createElement('canvas')
        off.width = W
        off.height = H
        const o = off.getContext('2d', { willReadFrequently: true })!
        const r = Math.max(10 * dpr, Math.min(90 * dpr, 140 * view.current.scale))
        o.globalAlpha = Math.min(0.5, Math.max(0.08, 6 / Math.sqrt(pts.length)))
        for (const p of pts) {
          const [sx, sy] = toScreen(p.x, p.y)
          if (sx < -r || sy < -r || sx > W + r || sy > H + r) continue
          o.drawImage(img, sx - r, sy - r, r * 2, r * 2)
        }
        const data = o.getImageData(0, 0, W, H)
        const px = data.data
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]
          if (!a) continue
          const k = a * 4
          px[i] = lut[k]
          px[i + 1] = lut[k + 1]
          px[i + 2] = lut[k + 2]
          px[i + 3] = Math.min(255, a * 1.6)
        }
        o.putImageData(data, 0, 0)
        ctx.drawImage(off, 0, 0)
      }

      // Points (all of them, or only the hovered / selected one over the heat)
      const r = Math.max(2.5, Math.min(6, view.current.scale * 40)) * dpr
      for (const p of pts) {
        const focused = p === hovered.current || p === sel
        if (m === 'heat' && !focused) continue
        const [sx, sy] = toScreen(p.x, p.y)
        if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fillStyle = colorFor(p.cause)
        ctx.globalAlpha = m === 'points' ? 0.85 : 1
        ctx.fill()
        ctx.globalAlpha = 1
        if (focused) {
          ctx.lineWidth = 2 * dpr
          ctx.strokeStyle = dark ? '#fff' : '#17120e'
          ctx.beginPath()
          ctx.arc(sx, sy, r + 4 * dpr, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    })
  }

  function fit() {
    view.current.scale = minScale() * 0.95
    view.current.cx = (B.xMin + B.xMax) / 2
    view.current.cy = (B.yMin + B.yMax) / 2
    draw()
  }
  function zoomAt(factor: number, sx = size.current.W / 2, sy = size.current.H / 2) {
    const [wx, wy] = toWorld(sx, sy)
    view.current.scale = Math.min(Math.max(view.current.scale * factor, minScale() * 0.6), 4)
    const [nx, ny] = toWorld(sx, sy)
    view.current.cx += wx - nx
    view.current.cy += wy - ny
    draw()
  }

  useImperativeHandle(ref, () => ({
    focus: (x, y, scale = 0.6) => {
      view.current = { cx: x, cy: y, scale }
      draw()
    },
    fit,
  }))

  useEffect(() => {
    state.current = { points, mode, selected }
    draw()
  })

  // Size of the canvas follows its box (device pixels); fitted to the world the first time
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height || !canvas.current) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const first = !size.current.W
      size.current = { W: Math.round(rect.width * dpr), H: Math.round(rect.height * dpr), dpr }
      canvas.current.width = size.current.W
      canvas.current.height = size.current.H
      if (first) fit()
      else draw()
    })
    observer.observe(el)
    // Wheel: not passive, so the page does not scroll while zooming
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, (e.clientX - rect.left) * size.current.dpr, (e.clientY - rect.top) * size.current.dpr)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    // Theme switch: redraw with the other colours
    const theme = new MutationObserver(() => draw())
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      observer.disconnect()
      theme.disconnect()
      el.removeEventListener('wheel', wheel)
      cancelAnimationFrame(raf.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nearest = (sx: number, sy: number, max = 12) => {
    let best: MapPoint | null = null
    let bd = (max * size.current.dpr) ** 2
    for (const p of state.current.points) {
      const [x, y] = toScreen(p.x, p.y)
      const dd = (x - sx) ** 2 + (y - sy) ** 2
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    return best
  }
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = stage.current!.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top] as const
  }

  return (
    <div
      ref={stage}
      className='relative h-[28rem] touch-none overflow-hidden rounded-lg border select-none sm:h-[34rem]'
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-map-ctrl]')) return
        stage.current!.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cy: view.current.cy, moved: false }
      }}
      onPointerMove={(e) => {
        const [x, y] = local(e)
        const g = drag.current
        if (g) {
          const dx = e.clientX - g.x
          const dy = e.clientY - g.y
          if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
          view.current.cx = g.cx - (dx * size.current.dpr) / view.current.scale
          view.current.cy = g.cy + (dy * size.current.dpr) / view.current.scale
          setTip(null)
          draw()
          return
        }
        const p = nearest(x * size.current.dpr, y * size.current.dpr)
        if (p !== hovered.current) {
          hovered.current = p
          draw()
        }
        setTip(p ? { p, x, y, w: stage.current?.clientWidth ?? 300 } : null)
      }}
      onPointerUp={(e) => {
        if (drag.current && !drag.current.moved) {
          const [x, y] = local(e)
          const p = nearest(x * size.current.dpr, y * size.current.dpr, 16)
          if (p) onSelect(p)
        }
        drag.current = null
      }}
      onPointerCancel={() => { drag.current = null }}
      onPointerLeave={() => {
        if (!drag.current) {
          hovered.current = null
          setTip(null)
          draw()
        }
      }}
      onDoubleClick={(e) => {
        const [x, y] = local(e)
        zoomAt(2, x * size.current.dpr, y * size.current.dpr)
      }}
      style={{ cursor: tip ? 'pointer' : 'grab' }}
    >
      <canvas ref={canvas} className='absolute inset-0 size-full' aria-label='Carte des morts' role='img' />
      <div data-map-ctrl className='absolute end-2 top-2 grid gap-1'>
        <Button variant='secondary' size='icon' className='size-8' onClick={() => zoomAt(1.5)} aria-label='Zoomer'><Plus /></Button>
        <Button variant='secondary' size='icon' className='size-8' onClick={() => zoomAt(1 / 1.5)} aria-label='Dézoomer'><Minus /></Button>
        <Button variant='secondary' size='icon' className='size-8' onClick={fit} aria-label='Voir toute la carte'><Maximize2 /></Button>
      </div>
      {tip && (
        <div className='pointer-events-none absolute z-10 max-w-60 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md' style={{ left: Math.max(4, Math.min(tip.x + 14, tip.w - 244)), top: tip.y + 14 }}>
          <b>{tip.p.player_name || tip.p.citizenid || 'Inconnu'}</b>
          <div className='text-muted-foreground'>{tip.p.cause || '?'}{tip.p.killer_name ? ` · par ${tip.p.killer_name}` : ''}</div>
          <div className='text-muted-foreground'>{dt(tip.p.ts)}{tip.p.screenshot_url ? ' · capture dispo' : ''}</div>
        </div>
      )}
    </div>
  )
}
