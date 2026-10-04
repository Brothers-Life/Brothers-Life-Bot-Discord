import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Image as ImageIcon, Loader2, Plus, Square, Trash2, Type, UserRound } from 'lucide-react'
import type { CardDesign, CardLayer } from '@/lib/types'
import { cn } from '@/lib/utils'
import { imageUrl } from '@/features/uploads/upload'
import { UploadButton } from '@/features/uploads/image-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ColorPicker } from '@/components/app/color-picker'

const SIZES = [
  { label: 'Bannière 1024 × 450', width: 1024, height: 450 },
  { label: 'Large 1200 × 400', width: 1200, height: 400 },
  { label: 'Carrée 800 × 800', width: 800, height: 800 },
  { label: 'Fine 1000 × 300', width: 1000, height: 300 },
]
const LAYER_LABEL: Record<CardLayer['type'], string> = { avatar: 'Avatar', text: 'Texte', rect: 'Rectangle', image: 'Image' }

// Screen box of a layer, in card pixels (text boxes are an estimate: the real render is the image below)
function boxOf(layer: CardLayer) {
  switch (layer.type) {
    case 'avatar':
      return { left: layer.x - layer.size / 2, top: layer.y - layer.size / 2, width: layer.size, height: layer.size }
    case 'text': {
      const width = Math.min(layer.maxWidth, Math.max(layer.size * 2, layer.text.length * layer.size * 0.5))
      const left = layer.align === 'center' ? layer.x - width / 2 : layer.align === 'right' ? layer.x - width : layer.x
      return { left, top: layer.y - layer.size * 0.65, width, height: layer.size * 1.3 }
    }
    default:
      return { left: layer.x, top: layer.y, width: layer.w, height: layer.h }
  }
}

function newLayer(type: CardLayer['type'], design: CardDesign): CardLayer {
  const id = `${type}${Date.now().toString(36)}`
  const cx = Math.round(design.width / 2)
  const cy = Math.round(design.height / 2)
  switch (type) {
    case 'avatar': return { id, type, x: cx, y: cy, size: 140, shape: 'circle', borderWidth: 6, borderColor: '#ffffff' }
    case 'text': return { id, type, x: cx, y: cy, text: 'Nouveau texte', font: 'Poppins Bold', size: 40, color: '#ffffff', align: 'center', maxWidth: design.width - 80, shadow: true, uppercase: false }
    case 'rect': return { id, type, x: 40, y: 40, w: 300, h: 120, color: '#000000', opacity: 0.4, radius: 16 }
    case 'image': return { id, type, x: 40, y: 40, w: 128, h: 128, src: null, radius: 16 }
  }
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1 text-xs', className)}>
      <span className='font-medium text-muted-foreground'>{label}</span>
      {children}
    </label>
  )
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return <Input type='number' className='h-8' value={value} min={min} max={max} step={step} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
}

// Visual editor: the real render of the server, with draggable handles for each layer
export function CardEditor({ design, onChange, fonts, renderPreview }: {
  design: CardDesign
  onChange: (design: CardDesign) => void
  fonts: string[]
  renderPreview: (design: CardDesign) => Promise<Blob>
}) {
  const [selected, setSelected] = useState<string | null>(design.layers[0]?.id ?? null)
  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number; scale: number } | null>(null)
  const [dragOffset, setDragOffset] = useState<{ id: string; dx: number; dy: number } | null>(null)

  // Real rendering, a moment after the last change
  const key = JSON.stringify(design)
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    const timer = setTimeout(async () => {
      setRendering(true)
      try {
        const blob = await renderPreview(JSON.parse(key))
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old)
          return url
        })
      }
      catch {
        // The last good render stays on screen
      }
      finally {
        if (!cancelled) setRendering(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, renderPreview])

  const layer = design.layers.find((l) => l.id === selected) ?? null
  const setLayers = (layers: CardLayer[]) => onChange({ ...design, layers })
  const patchLayer = (id: string, patch: Partial<CardLayer>) => setLayers(design.layers.map((l) => (l.id === id ? { ...l, ...patch } as CardLayer : l)))
  const setBg = (patch: Partial<CardDesign['background']>) => onChange({ ...design, background: { ...design.background, ...patch } })
  const move = (from: number, to: number) => {
    const next = [...design.layers]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setLayers(next)
  }

  const onPointerDown = (e: React.PointerEvent, l: CardLayer) => {
    e.preventDefault()
    setSelected(l.id)
    const rect = stage.current!.getBoundingClientRect()
    drag.current = { id: l.id, startX: e.clientX, startY: e.clientY, x: l.x, y: l.y, scale: design.width / rect.width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setDragOffset({ id: d.id, dx: (e.clientX - d.startX) * d.scale, dy: (e.clientY - d.startY) * d.scale })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setDragOffset(null)
    const dx = Math.round((e.clientX - d.startX) * d.scale)
    const dy = Math.round((e.clientY - d.startY) * d.scale)
    if (dx || dy) patchLayer(d.id, { x: d.x + dx, y: d.y + dy })
  }
  const nudge = (e: React.KeyboardEvent, l: CardLayer) => {
    const step = e.shiftKey ? 10 : 1
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!delta) return
    e.preventDefault()
    patchLayer(l.id, { x: l.x + delta[0], y: l.y + delta[1] })
  }

  const bg = design.background
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]'>
      <div className='grid min-w-0 content-start gap-3'>
        <div
          ref={stage}
          className='relative w-full overflow-hidden rounded-lg border bg-muted select-none'
          style={{ aspectRatio: `${design.width} / ${design.height}` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {preview && <img src={preview} alt='Rendu de la carte' className='absolute inset-0 size-full' draggable={false} />}
          {rendering && <Loader2 className='absolute end-2 top-2 size-4 animate-spin text-white drop-shadow' aria-label='Rendu en cours' />}
          {design.layers.map((l) => {
            const box = boxOf(l)
            const offset = dragOffset?.id === l.id ? dragOffset : { dx: 0, dy: 0 }
            return (
              <button
                key={l.id}
                type='button'
                aria-label={`${LAYER_LABEL[l.type]} ${l.type === 'text' ? l.text : ''}`}
                onPointerDown={(e) => onPointerDown(e, l)}
                onKeyDown={(e) => nudge(e, l)}
                onFocus={() => setSelected(l.id)}
                className={cn(
                  'absolute cursor-move rounded-sm outline-offset-0 transition-[outline-color]',
                  selected === l.id ? 'outline-2 outline-primary outline-dashed' : 'outline-1 outline-transparent hover:outline-white/60 hover:outline-dashed',
                )}
                style={{
                  left: `${((box.left + offset.dx) / design.width) * 100}%`,
                  top: `${((box.top + offset.dy) / design.height) * 100}%`,
                  width: `${(box.width / design.width) * 100}%`,
                  height: `${(box.height / design.height) * 100}%`,
                }}
              />
            )
          })}
        </div>
        <p className='text-xs text-muted-foreground'>
          C’est le vrai rendu du bot, avec ton avatar. Glisse les éléments à la souris, ou sélectionne-les et utilise les flèches (Maj : 10 px).
          Variables : {'{user.name}'}, {'{server}'}, {'{memberCount}'}, {'{account.age}'}, {'{boosts}'}, {'{date}'}.
        </p>

        <fieldset className='grid gap-3 rounded-lg border p-3'>
          <legend className='px-1 text-sm font-semibold'>Fond</legend>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3'>
            <Field label='Format'>
              <Select value={`${design.width}x${design.height}`} onValueChange={(v) => { const [width, height] = v.split('x').map(Number); onChange({ ...design, width, height }) }}>
                <SelectTrigger className='h-8'><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIZES.map((s) => <SelectItem key={s.label} value={`${s.width}x${s.height}`}>{s.label}</SelectItem>)}
                  {!SIZES.some((s) => s.width === design.width && s.height === design.height) && <SelectItem value={`${design.width}x${design.height}`}>{design.width} × {design.height}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            <Field label='Type'>
              <Select value={bg.type} onValueChange={(v) => setBg({ type: v as CardDesign['background']['type'] })}>
                <SelectTrigger className='h-8'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='color'>Couleur unie</SelectItem>
                  <SelectItem value='gradient'>Dégradé</SelectItem>
                  <SelectItem value='image'>Image</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Assombrir : ${Math.round(bg.overlay * 100)} %`}>
              <input type='range' min={0} max={0.9} step={0.05} value={bg.overlay} onChange={(e) => setBg({ overlay: Number(e.target.value) })} className='h-8 accent-primary' />
            </Field>
          </div>
          <div className='flex flex-wrap items-end gap-3'>
            {bg.type !== 'image' && (
              <Field label={bg.type === 'gradient' ? 'Couleur de départ' : 'Couleur'}>
                <ColorPicker value={bg.color} onChange={(hex) => setBg({ color: hex })} />
              </Field>
            )}
            {bg.type === 'gradient' && (
              <>
                <Field label='Couleur d’arrivée'>
                  <ColorPicker value={bg.color2} onChange={(hex) => setBg({ color2: hex })} />
                </Field>
                <Field label={`Angle : ${bg.angle}°`} className='min-w-40'>
                  <input type='range' min={0} max={360} value={bg.angle} onChange={(e) => setBg({ angle: Number(e.target.value) })} className='h-8 accent-primary' />
                </Field>
              </>
            )}
            {bg.type === 'image' && (
              <>
                <UploadButton onUploaded={(src) => setBg({ image: src })} label='Image de fond' />
                <Field label='…ou une adresse https' className='min-w-64 flex-1'>
                  <Input className='h-8' value={bg.image?.startsWith('upload:') ? '' : bg.image ?? ''} placeholder='https://…' onChange={(e) => setBg({ image: e.target.value || null })} />
                </Field>
                {bg.image && <img src={imageUrl(bg.image) ?? ''} alt='' className='h-10 rounded border object-cover' />}
              </>
            )}
          </div>
        </fieldset>
      </div>

      <div className='grid min-w-0 content-start gap-3'>
        <div className='flex flex-wrap gap-1.5'>
          <Button type='button' size='sm' variant='outline' onClick={() => { const l = newLayer('text', design); setLayers([...design.layers, l]); setSelected(l.id) }} disabled={design.layers.length >= 20}><Type /> Texte</Button>
          <Button type='button' size='sm' variant='outline' onClick={() => { const l = newLayer('avatar', design); setLayers([...design.layers, l]); setSelected(l.id) }} disabled={design.layers.length >= 20}><UserRound /> Avatar</Button>
          <Button type='button' size='sm' variant='outline' onClick={() => { const l = newLayer('rect', design); setLayers([...design.layers, l]); setSelected(l.id) }} disabled={design.layers.length >= 20}><Square /> Forme</Button>
          <Button type='button' size='sm' variant='outline' onClick={() => { const l = newLayer('image', design); setLayers([...design.layers, l]); setSelected(l.id) }} disabled={design.layers.length >= 20}><ImageIcon /> Image</Button>
        </div>
        <ol className='grid min-w-0 gap-1 rounded-lg border p-1'>
          {[...design.layers].map((l, i) => (
            <li key={l.id} className='min-w-0'>
              <div className={cn('flex items-center gap-1 rounded px-2 py-1 text-sm', selected === l.id ? 'bg-primary/15' : 'hover:bg-accent/50')}>
                <button type='button' className='min-w-0 flex-1 truncate text-start' onClick={() => setSelected(l.id)}>
                  <span className='text-muted-foreground'>{LAYER_LABEL[l.type]}</span>{l.type === 'text' ? ` · ${l.text}` : ''}
                </button>
                <Button type='button' size='icon' variant='ghost' className='size-6' aria-label='Monter (au-dessus)' disabled={i === design.layers.length - 1} onClick={() => move(i, i + 1)}><ArrowUp /></Button>
                <Button type='button' size='icon' variant='ghost' className='size-6' aria-label='Descendre (en dessous)' disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowDown /></Button>
                <Button type='button' size='icon' variant='ghost' className='size-6' aria-label='Dupliquer' disabled={design.layers.length >= 20} onClick={() => { const copy = { ...l, id: `${l.type}${Date.now().toString(36)}`, x: l.x + 20, y: l.y + 20 }; setLayers([...design.layers, copy]); setSelected(copy.id) }}><Copy /></Button>
                <Button type='button' size='icon' variant='ghost' className='size-6 text-destructive' aria-label='Supprimer' onClick={() => setLayers(design.layers.filter((x) => x.id !== l.id))}><Trash2 /></Button>
              </div>
            </li>
          ))}
          {!design.layers.length && <li className='p-2 text-xs text-muted-foreground'>Aucun élément : ajoute un texte ou l’avatar.</li>}
        </ol>

        {layer && (
          <div className='grid min-w-0 gap-3 rounded-lg border p-3 [&_input]:min-w-0'>
            <div className='text-sm font-semibold'>{LAYER_LABEL[layer.type]}</div>
            <div className='grid grid-cols-2 gap-2'>
              <Field label={layer.type === 'avatar' ? 'Centre X' : 'X'}><NumberInput value={layer.x} min={-design.width} max={design.width * 2} onChange={(x) => patchLayer(layer.id, { x })} /></Field>
              <Field label={layer.type === 'avatar' || layer.type === 'text' ? 'Centre Y' : 'Y'}><NumberInput value={layer.y} min={-design.height} max={design.height * 2} onChange={(y) => patchLayer(layer.id, { y })} /></Field>
            </div>
            {layer.type === 'text' && (
              <>
                <Field label='Texte'><Input className='h-8' value={layer.text} maxLength={200} onChange={(e) => patchLayer(layer.id, { text: e.target.value })} /></Field>
                <div className='grid grid-cols-[1fr_5rem] gap-2'>
                  <Field label='Police'>
                    <Select value={layer.font} onValueChange={(font) => patchLayer(layer.id, { font })}>
                      <SelectTrigger className='h-8'><SelectValue /></SelectTrigger>
                      <SelectContent>{fonts.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label='Taille'><NumberInput value={layer.size} min={8} max={200} onChange={(size) => patchLayer(layer.id, { size })} /></Field>
                </div>
                <div className='grid grid-cols-[4rem_1fr_6rem] gap-2'>
                  <Field label='Couleur'><ColorPicker value={layer.color} onChange={(hex) => patchLayer(layer.id, { color: hex })} /></Field>
                  <Field label='Alignement'>
                    <Select value={layer.align} onValueChange={(align) => patchLayer(layer.id, { align: align as 'left' | 'center' | 'right' })}>
                      <SelectTrigger className='h-8'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='left'>Gauche</SelectItem>
                        <SelectItem value='center'>Centré</SelectItem>
                        <SelectItem value='right'>Droite</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label='Largeur max'><NumberInput value={layer.maxWidth} min={20} max={4096} onChange={(maxWidth) => patchLayer(layer.id, { maxWidth })} /></Field>
                </div>
                <div className='flex gap-4 text-sm'>
                  <label className='flex items-center gap-2'><Checkbox checked={layer.shadow} onCheckedChange={(v) => patchLayer(layer.id, { shadow: v === true })} /> Ombre</label>
                  <label className='flex items-center gap-2'><Checkbox checked={layer.uppercase} onCheckedChange={(v) => patchLayer(layer.id, { uppercase: v === true })} /> Majuscules</label>
                </div>
              </>
            )}
            {layer.type === 'avatar' && (
              <>
                <div className='grid grid-cols-2 gap-2'>
                  <Field label='Taille'><NumberInput value={layer.size} min={16} max={1024} onChange={(size) => patchLayer(layer.id, { size })} /></Field>
                  <Field label='Forme'>
                    <Select value={layer.shape} onValueChange={(shape) => patchLayer(layer.id, { shape: shape as 'circle' | 'rounded' | 'square' })}>
                      <SelectTrigger className='h-8'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='circle'>Rond</SelectItem>
                        <SelectItem value='rounded'>Arrondi</SelectItem>
                        <SelectItem value='square'>Carré</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <Field label='Bordure'><NumberInput value={layer.borderWidth} min={0} max={40} onChange={(borderWidth) => patchLayer(layer.id, { borderWidth })} /></Field>
                  <Field label='Couleur'><ColorPicker value={layer.borderColor} onChange={(hex) => patchLayer(layer.id, { borderColor: hex })} /></Field>
                </div>
              </>
            )}
            {(layer.type === 'rect' || layer.type === 'image') && (
              <div className='grid grid-cols-3 gap-2'>
                <Field label='Largeur'><NumberInput value={layer.w} min={1} max={4096} onChange={(w) => patchLayer(layer.id, { w })} /></Field>
                <Field label='Hauteur'><NumberInput value={layer.h} min={1} max={4096} onChange={(h) => patchLayer(layer.id, { h })} /></Field>
                <Field label='Arrondi'><NumberInput value={layer.radius} min={0} max={500} onChange={(radius) => patchLayer(layer.id, { radius })} /></Field>
              </div>
            )}
            {layer.type === 'rect' && (
              <div className='grid grid-cols-[4rem_1fr] gap-2'>
                <Field label='Couleur'><ColorPicker value={layer.color} onChange={(hex) => patchLayer(layer.id, { color: hex })} /></Field>
                <Field label={`Opacité : ${Math.round(layer.opacity * 100)} %`}>
                  <input type='range' min={0} max={1} step={0.05} value={layer.opacity} onChange={(e) => patchLayer(layer.id, { opacity: Number(e.target.value) })} className='h-8 accent-primary' />
                </Field>
              </div>
            )}
            {layer.type === 'image' && (
              <div className='grid gap-2'>
                <UploadButton onUploaded={(src) => patchLayer(layer.id, { src })} label='Choisir l’image' />
                <Field label='…ou une adresse https'>
                  <Input className='h-8' value={layer.src?.startsWith('upload:') ? '' : layer.src ?? ''} placeholder='https://…' onChange={(e) => patchLayer(layer.id, { src: e.target.value || null })} />
                </Field>
              </div>
            )}
          </div>
        )}
        <Button type='button' size='sm' variant='ghost' onClick={() => setSelected(null)} className={cn(!layer && 'hidden')}><Plus className='rotate-45' /> Désélectionner</Button>
      </div>
    </div>
  )
}
