import { useCallback, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CircleCheck, Compass, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

export type ConfirmOptions = {
  title: React.ReactNode
  desc: React.JSX.Element | string
  confirmText?: React.ReactNode
  cancelText?: string
  destructive?: boolean
}

// Imperative confirmation: `if (await confirm({...})) doIt()`. Render `dialog` once in the component.
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setOptions(opts)
  }), [])

  const close = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }

  const dialog = (
    <ConfirmDialog
      open={options !== null}
      onOpenChange={(o) => { if (!o) close(false) }}
      title={options?.title ?? ''}
      desc={options?.desc ?? ''}
      confirmText={options?.confirmText ?? 'Confirmer'}
      cancelBtnText={options?.cancelText}
      destructive={options?.destructive}
      handleConfirm={() => close(true)}
    />
  )
  return { confirm, dialog }
}

// Asks before throwing away an unsaved draft (switching item, server…)
export function useDiscardGuard(dirty: boolean) {
  const { confirm, dialog } = useConfirm()
  const guard = useCallback(async (action: () => void) => {
    if (!dirty) return action()
    const ok = await confirm({
      title: 'Abandonner les modifications ?',
      desc: 'Des changements ne sont pas enregistrés. Ils seront perdus si tu continues.',
      confirmText: 'Abandonner les changements',
      cancelText: 'Rester ici',
      destructive: true,
    })
    if (ok) action()
  }, [dirty, confirm])
  return { guard, dialog }
}

// Sticky bar shown while a form has unsaved changes
export function SaveBar({ dirty, onSave, onCancel, saving, saveLabel = 'Enregistrer', message = 'Des changements ne sont pas enregistrés.' }: {
  dirty: boolean
  onSave: () => void
  onCancel: () => void
  saving?: boolean
  saveLabel?: string
  message?: string
}) {
  if (!dirty) return null
  return (
    <div className='sticky bottom-4 z-10 flex animate-in flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur fade-in-0 slide-in-from-bottom-2'>
      <span className='text-sm'>{message}</span>
      <div className='ms-auto flex gap-2'>
        <Button variant='ghost' onClick={onCancel} disabled={saving}>Annuler</Button>
        <Button onClick={onSave} disabled={saving}><Save /> {saveLabel}</Button>
      </div>
    </div>
  )
}

// Small label for sections whose changes apply immediately
export function AutoSaved({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <CircleCheck className='size-3.5' aria-hidden /> Enregistré automatiquement
    </span>
  )
}

export type SeeAlsoLink = { to: string; label: string; hint?: string }

// "What this page is for / see also" strip with real links
export function SeeAlso({ children, links, className }: { children?: React.ReactNode; links: SeeAlsoLink[]; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-lg border border-dashed px-4 py-3 text-sm', className)}>
      <Compass className='mt-0.5 size-4 shrink-0 text-brand' aria-hidden />
      <div className='grid min-w-0 gap-1 text-muted-foreground'>
        {children && <p>{children}</p>}
        <p className='flex flex-wrap gap-x-3 gap-y-1'>
          <span>Voir aussi :</span>
          {links.map((l) => (
            <span key={l.to}>
              <Link to={l.to} className='font-medium text-foreground underline-offset-4 hover:text-brand hover:underline'>{l.label}</Link>
              {l.hint && <span> ({l.hint})</span>}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
