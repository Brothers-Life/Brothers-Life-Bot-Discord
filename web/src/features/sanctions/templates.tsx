import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { RestrictionProfile, SanctionType } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export type SanctionTemplate = {
  id: number; name: string; type: SanctionType; reason: string; durationMs: number | null; durationLabel: string | null
  scope: 'network' | 'local'; profile: string | null; deleteMessageSeconds: number
}

export const TEMPLATE_TYPES: Record<SanctionType, { label: string; tone: 'danger' | 'warning' | 'info' | 'accent' }> = {
  warn: { label: 'Avertissement', tone: 'warning' },
  timeout: { label: 'Timeout', tone: 'warning' },
  restrict: { label: 'Restriction', tone: 'accent' },
  kick: { label: 'Expulsion', tone: 'danger' },
  ban: { label: 'Ban', tone: 'danger' },
}

// 90 000 000 -> "1j1h": what the duration fields understand
export function durationInput(ms: number | null) {
  if (!ms) return ''
  const units: [string, number][] = [['j', 86_400_000], ['h', 3_600_000], ['m', 60_000]]
  let rest = ms
  return units.map(([u, size]) => {
    const n = Math.floor(rest / size)
    rest -= n * size
    return n ? `${n}${u}` : ''
  }).join('')
}

export function useSanctionTemplates() {
  return useQuery({ queryKey: ['sanction-templates'], queryFn: () => api<SanctionTemplate[]>('/sanction-templates') })
}

export function SanctionTemplates() {
  const { can } = useMe()
  const manage = can('sanctions.templates')
  const qc = useQueryClient()
  const { data } = useSanctionTemplates()
  const [editing, setEditing] = useState<Partial<SanctionTemplate> | null>(null)
  const [deleting, setDeleting] = useState<SanctionTemplate | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['sanction-templates'] })
  const remove = useMutation({ mutationFn: (id: number) => api(`/sanction-templates/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Modèle supprimé'); setDeleting(null); refresh() } })
  const order = useMutation({ mutationFn: (ids: number[]) => api('/sanction-templates/order', { method: 'PUT', body: { ids } }), onSuccess: refresh })
  const move = (i: number, by: number) => {
    if (!data) return
    const ids = data.map((t) => t.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    order.mutate(ids)
  }

  if (!data || (!manage && !data.length)) return null
  return (
    <Section
      title='Modèles de sanctions'
      description='Des bases toutes prêtes (type, raison, durée, portée). Elles remplissent le formulaire « Nouvelle sanction » et la commande /sanctionner, et restent modifiables à chaque fois.'
      actions={manage && <Button size='sm' onClick={() => setEditing({ type: 'warn', scope: 'network', deleteMessageSeconds: 0 })}><Plus /> Nouveau modèle</Button>}
    >
      {!data.length ? <EmptyState title='Aucun modèle' icon={FileText}>Crée par exemple « Insultes » (timeout 1 h), « Pub » (avertissement) ou « Triche » (ban définitif).</EmptyState> : (
        <ul className='divide-y'>
          {data.map((t, i) => (
            <li key={t.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
              <div className='min-w-0 flex-1 basis-60'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{t.name}</span>
                  <Pill tone={TEMPLATE_TYPES[t.type].tone}>{TEMPLATE_TYPES[t.type].label}</Pill>
                  {t.type !== 'kick' && t.type !== 'warn' && <Pill tone='neutral'>{t.durationLabel ?? 'définitif'}</Pill>}
                  {t.scope === 'local' && <Pill tone='info'>ce serveur</Pill>}
                </div>
                {t.reason && <p className='mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]'>{t.reason}</p>}
              </div>
              {manage && (
                <div className='flex gap-1'>
                  <Button size='icon' variant='ghost' aria-label='Monter' disabled={i === 0 || order.isPending} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size='icon' variant='ghost' aria-label='Descendre' disabled={i === data.length - 1 || order.isPending} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size='icon' variant='ghost' aria-label={`Modifier ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button>
                  <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${t.name}`} onClick={() => setDeleting(t)}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <TemplateDialog template={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer « ${deleting?.name ?? ''} » ?`} desc='Les sanctions déjà données avec ce modèle ne changent pas.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting.id)} />
    </Section>
  )
}

function TemplateDialog({ template, onClose, onSaved }: { template: Partial<SanctionTemplate>; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState(template)
  const [duration, setDuration] = useState(durationInput(template.durationMs ?? null))
  const set = (patch: Partial<SanctionTemplate>) => setT((prev) => ({ ...prev, ...patch }))
  const profiles = useQuery({ queryKey: ['restrictions'], queryFn: () => api<{ profiles: RestrictionProfile[] }>('/restrictions'), enabled: t.type === 'restrict' })
  const hasDuration = t.type === 'timeout' || t.type === 'ban' || t.type === 'restrict'
  const save = useMutation({
    mutationFn: () => api('/sanction-templates', {
      method: 'POST',
      body: {
        ...(t.id ? { id: t.id } : {}),
        name: t.name ?? '', type: t.type, reason: t.reason ?? '', duration: hasDuration && duration.trim() ? duration.trim() : null,
        scope: t.scope ?? 'network', profile: t.type === 'restrict' ? t.profile ?? null : null, deleteMessageSeconds: t.type === 'ban' ? t.deleteMessageSeconds ?? 0 : 0,
      },
    }),
    onSuccess: () => { toast.success(t.id ? 'Modèle enregistré' : 'Modèle créé'); onSaved(); onClose() },
  })
  const valid = Boolean(t.name?.trim()) && (t.type !== 'warn' || Boolean(t.reason?.trim())) && (t.type !== 'timeout' || Boolean(duration.trim())) && (t.type !== 'restrict' || Boolean(t.profile))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t.id ? `Modifier « ${template.name} »` : 'Nouveau modèle de sanction'}</DialogTitle>
          <DialogDescription>Une base : au moment de sanctionner, tout reste modifiable.</DialogDescription>
        </DialogHeader>
        <form id='template-form' className='grid gap-4' onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }}>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='tpl-name'>Nom</Label>
              <Input id='tpl-name' value={t.name ?? ''} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder='Insultes' autoFocus />
            </div>
            <div className='grid gap-1.5'>
              <Label>Sanction</Label>
              <Select value={t.type} onValueChange={(v) => set({ type: v as SanctionType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TEMPLATE_TYPES) as SanctionType[]).map((k) => <SelectItem key={k} value={k}>{TEMPLATE_TYPES[k].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {t.type === 'restrict' && (
            <div className='grid gap-1.5'>
              <Label>Restriction</Label>
              <Select value={t.profile ?? ''} onValueChange={(profile) => set({ profile })}>
                <SelectTrigger aria-label='Restriction'><SelectValue placeholder='Choisir' /></SelectTrigger>
                <SelectContent>{profiles.data?.profiles.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className='grid gap-1.5'>
            <Label htmlFor='tpl-reason'>Raison {t.type !== 'warn' && <span className='text-muted-foreground'>(conseillée)</span>}</Label>
            <Textarea id='tpl-reason' rows={2} maxLength={500} value={t.reason ?? ''} onChange={(e) => set({ reason: e.target.value })} placeholder='Insultes envers un membre' />
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            {hasDuration && (
              <div className='grid gap-1.5'>
                <Label htmlFor='tpl-duration'>Durée {t.type !== 'timeout' && <span className='text-muted-foreground'>(vide = définitif)</span>}</Label>
                <Input id='tpl-duration' value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={t.type === 'ban' ? '7j' : '1h'} />
              </div>
            )}
            {t.type !== 'warn' && (
              <div className='grid gap-1.5'>
                <Label>Portée</Label>
                <Select value={t.scope ?? 'network'} onValueChange={(v) => set({ scope: v as 'network' | 'local' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='network'>Tout le réseau</SelectItem><SelectItem value='local'>Le serveur où l’on sanctionne</SelectItem></SelectContent>
                </Select>
              </div>
            )}
            {t.type === 'ban' && (
              <div className='grid gap-1.5'>
                <Label>Supprimer ses messages</Label>
                <Select value={String(t.deleteMessageSeconds ?? 0)} onValueChange={(v) => set({ deleteMessageSeconds: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='0'>Rien</SelectItem><SelectItem value='3600'>Dernière heure</SelectItem>
                    <SelectItem value='86400'>24 dernières heures</SelectItem><SelectItem value='604800'>7 derniers jours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='template-form' loading={save.isPending} disabled={!valid || save.isPending}>{t.id ? 'Enregistrer' : 'Créer le modèle'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
