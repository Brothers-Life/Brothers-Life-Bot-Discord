import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, RefreshCw, ShieldCheck, Trash2, UserMinus, UserPlus, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Notice, Pill, Section, StatCards, UserAvatar } from '@/components/app/ui'
import { useConfirm } from '@/components/app/confirm'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

type Kind = 'job' | 'gang' | 'staff'
type RoleLink = { id?: string; kind: Kind; name: string; minGrade: number; guildId: string; roleId: string }
type DiscordRole = { id: string; name: string; color: string; editable: boolean }
type Setup = {
  links: RoleLink[]
  catalog: { jobs: { name: string; label: string; grades: { grade: number; name: string }[] }[]; gangs: { name: string; label: string; grades: { grade: number; name: string }[] }[]; staff: { name: string; label: string }[] }
  guilds: { id: string; name: string; isMain: boolean; roles: DiscordRole[] }[]
}
type Issue = {
  key: string; action: 'add' | 'remove'; guildId: string; userId: string; roleId: string; reason: string
  account: { userId: number; username: string } | null; notMember: boolean; fixable: boolean; discord: { name: string | null; avatar: string | null } | null
}
type Check = {
  issues: Issue[]; unlinked: { userId: number; username: string; groups: string[]; staff: string | null }[]
  guilds: { id: string; name: string; roles: { id: string; name: string | null; color: string | null; editable: boolean }[] }[]
  accounts: number; linked: number; at: number
}

const KIND_LABEL: Record<Kind, string> = { job: 'Métier', gang: 'Gang', staff: 'Rôle staff' }

// Discord roles checked against the game: links, then the report of differences with fix buttons
export function RolesTab({ onOpen }: { onOpen: (userId: number) => void }) {
  const { can } = useMe()
  const setup = useQuery({ queryKey: ['fivem-roles-setup'], queryFn: () => api<Setup>('/fivem-data/roles/setup'), retry: false })
  if (setup.error) return <Notice tone='warning' title='Données indisponibles'>{errorMessage(setup.error)}</Notice>
  if (!setup.data) return <Skeleton className='h-96 w-full' />
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <Links setup={setup.data} editable={can('fivemdata.manage')} />
      {setup.data.links.length > 0 && <Report onOpen={onOpen} />}
    </div>
  )
}

function Links({ setup, editable }: { setup: Setup; editable: boolean }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<RoleLink[] | null>(null)
  const links = draft ?? setup.links
  const main = setup.guilds.find((g) => g.isMain) ?? setup.guilds[0]
  const save = useMutation({
    mutationFn: () => api<RoleLink[]>('/fivem-data/roles/links', { method: 'PUT', body: links }),
    onSuccess: () => { toast.success('Liaisons enregistrées'); setDraft(null); qc.invalidateQueries({ queryKey: ['fivem-roles-setup'] }); qc.invalidateQueries({ queryKey: ['fivem-roles-check'] }) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const update = (i: number, patch: Partial<RoleLink>) => setDraft(links.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const options = (kind: Kind) => (kind === 'staff' ? setup.catalog.staff.map((s) => ({ name: s.name, label: s.label, grades: [] as { grade: number; name: string }[] })) : kind === 'gang' ? setup.catalog.gangs : setup.catalog.jobs)

  return (
    <Section
      title='Liaisons jeu → Discord'
      description='Chaque ligne dit : ce métier (à partir de ce grade), ce gang ou ce rôle staff en jeu donne ce rôle Discord. Le jeu fait foi.'
      actions={editable && (
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' disabled={!main} onClick={() => setDraft([...links, { kind: 'job', name: setup.catalog.jobs[0]?.name ?? '', minGrade: 0, guildId: main?.id ?? '', roleId: '' }])}><Plus /> Ajouter</Button>
          {draft && <Button size='sm' loading={save.isPending} disabled={links.some((l) => !l.name || !l.roleId)} onClick={() => save.mutate()}>Enregistrer</Button>}
        </div>
      )}
    >
      {!links.length ? (
        <EmptyState title='Aucune liaison' icon={Link2}>{editable ? 'Ajoute une ligne, par exemple « Métier police → @LSPD ».' : 'Un responsable doit d’abord lier les métiers aux rôles Discord.'}</EmptyState>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[52rem] text-sm'>
            <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Type</th><th className='px-2 text-start font-medium'>En jeu</th><th className='px-2 text-start font-medium'>À partir du grade</th><th className='px-2 text-start font-medium'>Serveur</th><th className='px-2 text-start font-medium'>Rôle Discord</th><th className='w-12' /></tr></thead>
            <tbody className='divide-y'>
              {links.map((l, i) => {
                const list = options(l.kind)
                const grades = list.find((o) => o.name === l.name)?.grades ?? []
                const guild = setup.guilds.find((g) => g.id === l.guildId)
                return (
                  <tr key={l.id ?? `new-${i}`}>
                    <td className='px-4 py-2'>
                      <Select value={l.kind} disabled={!editable} onValueChange={(v) => update(i, { kind: v as Kind, name: options(v as Kind)[0]?.name ?? '', minGrade: 0 })}>
                        <SelectTrigger aria-label='Type' className='w-32'><SelectValue /></SelectTrigger>
                        <SelectContent>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      <Select value={l.name || undefined} disabled={!editable} onValueChange={(v) => update(i, { name: v, minGrade: 0 })}>
                        <SelectTrigger aria-label='Métier, gang ou rôle staff' className='w-52'><SelectValue placeholder='Choisir' /></SelectTrigger>
                        <SelectContent>{list.map((o) => <SelectItem key={o.name} value={o.name}>{o.label} <span className='text-muted-foreground'>({o.name})</span></SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      {l.kind === 'staff' ? <span className='text-muted-foreground'>—</span> : (
                        <Select value={String(l.minGrade)} disabled={!editable} onValueChange={(v) => update(i, { minGrade: Number(v) })}>
                          <SelectTrigger aria-label='Grade minimum' className='w-40'><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value='0'>Tous les grades</SelectItem>
                            {grades.filter((g) => g.grade > 0).map((g) => <SelectItem key={g.grade} value={String(g.grade)}>{g.grade} · {g.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className='px-2'>
                      <Select value={l.guildId || undefined} disabled={!editable} onValueChange={(v) => update(i, { guildId: v, roleId: '' })}>
                        <SelectTrigger aria-label='Serveur' className='w-40'><SelectValue placeholder='Serveur' /></SelectTrigger>
                        <SelectContent>{setup.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      <Select value={l.roleId || undefined} disabled={!editable} onValueChange={(v) => update(i, { roleId: v })}>
                        <SelectTrigger aria-label='Rôle Discord' className='w-44'><SelectValue placeholder='Rôle' /></SelectTrigger>
                        <SelectContent>
                          {(guild?.roles ?? []).map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              <span className='size-2 rounded-full' style={{ background: r.color === '#000000' ? 'var(--muted-foreground)' : r.color }} aria-hidden />@{r.name}{!r.editable && ' (au-dessus du bot)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className='pe-3 text-end'>{editable && <Button variant='ghost' size='icon' aria-label='Retirer la liaison' onClick={() => setDraft(links.filter((_, k) => k !== i))}><Trash2 /></Button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Report({ onOpen }: { onOpen: (userId: number) => void }) {
  const qc = useQueryClient()
  const check = useQuery({ queryKey: ['fivem-roles-check'], queryFn: () => api<Check>('/fivem-data/roles/check'), retry: false })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const { confirm, dialog } = useConfirm()
  const fix = useMutation({
    mutationFn: (keys: string[]) => api<{ done: number; failed: { key: string; error: string }[] }>('/fivem-data/roles/fix', { method: 'POST', body: { keys } }),
    onSuccess: (r) => {
      if (r.done) toast.success(`${r.done} rôle${r.done > 1 ? 's' : ''} corrigé${r.done > 1 ? 's' : ''}`)
      if (r.failed.length) toast.error(`${r.failed.length} non corrigé${r.failed.length > 1 ? 's' : ''} : ${[...new Set(r.failed.map((f) => f.error))].join(', ')}`)
      setPicked(new Set())
      qc.invalidateQueries({ queryKey: ['fivem-roles-check'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (check.error) return <Notice tone='warning' title='Check impossible'>{errorMessage(check.error)}</Notice>
  if (!check.data) return <Skeleton className='h-64 w-full' />
  const c = check.data
  const roleOf = (guildId: string, roleId: string) => c.guilds.find((g) => g.id === guildId)?.roles.find((r) => r.id === roleId)
  const guildName = (guildId: string) => c.guilds.find((g) => g.id === guildId)?.name ?? guildId
  const fixable = c.issues.filter((i) => i.fixable)
  const add = c.issues.filter((i) => i.action === 'add')
  const remove = c.issues.filter((i) => i.action === 'remove')
  const toggle = (key: string) => setPicked((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const multiGuild = c.guilds.length > 1
  // Several roles at once: say how many are given and taken before doing it
  const fixMany = async (keys: string[]) => {
    const list = c.issues.filter((i) => keys.includes(i.key))
    const adds = list.filter((i) => i.action === 'add').length
    const removes = list.length - adds
    const members = new Set(list.map((i) => i.userId)).size
    const ok = await confirm({
      title: `Corriger ${list.length} rôle${list.length > 1 ? 's' : ''} ?`,
      desc: `Le bot va ajouter ${adds} rôle${adds > 1 ? 's' : ''} et en retirer ${removes} sur Discord, pour ${members} membre${members > 1 ? 's' : ''}.`,
      confirmText: 'Corriger',
      destructive: removes > 0,
    })
    if (ok) fix.mutate(keys)
  }

  const rows = (list: Issue[]) => (
    <ul className='divide-y'>
      {list.map((i) => {
        const role = roleOf(i.guildId, i.roleId)
        return (
          <li key={i.key} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm', !i.fixable && 'opacity-70')}>
            <Checkbox checked={picked.has(i.key)} disabled={!i.fixable} onCheckedChange={() => toggle(i.key)} aria-label='Sélectionner' />
            <UserAvatar src={i.discord?.avatar} name={i.discord?.name ?? i.userId} className='size-7' />
            <div className='min-w-0 flex-1 basis-48'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>{i.discord?.name ?? i.userId}</span>
                {i.account && <button type='button' className='text-xs text-primary hover:underline' onClick={() => onOpen(i.account!.userId)}>{i.account.username} en jeu</button>}
              </div>
              <div className='text-xs text-muted-foreground'>{i.reason}</div>
            </div>
            <Pill tone={i.action === 'add' ? 'success' : 'danger'} style={role?.color && role.color !== '#000000' ? { borderColor: role.color } : undefined}>
              {i.action === 'add' ? '+' : '−'} @{role?.name ?? 'rôle supprimé'}{multiGuild ? ` · ${guildName(i.guildId)}` : ''}
            </Pill>
            {i.notMember && <Pill tone='neutral'>pas sur le serveur</Pill>}
            {!i.notMember && !i.fixable && <Pill tone='warning'>rôle au-dessus du bot</Pill>}
            {i.fixable && <Button size='sm' variant='ghost' loading={fix.isPending && fix.variables?.length === 1 && fix.variables[0] === i.key} onClick={() => fix.mutate([i.key])}>Corriger</Button>}
          </li>
        )
      })}
    </ul>
  )

  return (
    <>
      <StatCards items={[
        { label: 'Comptes liés à Discord', value: `${c.linked} / ${c.accounts}`, icon: Link2, tone: 'info' },
        { label: 'Rôles à ajouter', value: add.length, icon: UserPlus, tone: 'success' },
        { label: 'Rôles à retirer', value: remove.length, icon: UserMinus, tone: 'danger' },
        { label: 'Corrigeables par le bot', value: fixable.length, icon: Wand2, tone: 'accent' },
      ]} />
      <Section
        title={c.issues.length ? 'Écarts entre le jeu et Discord' : 'Tout est en ordre'}
        description={`Vérifié à ${new Date(c.at).toLocaleTimeString('fr-FR')}. Le rôle staff est celui vu à la dernière prise de service dans le menu admin (60 derniers jours).`}
        actions={
          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' loading={check.isFetching} onClick={() => check.refetch()}><RefreshCw /> Revérifier</Button>
            {picked.size > 0 && <Button size='sm' variant='outline' loading={fix.isPending} onClick={() => void fixMany([...picked])}>Corriger la sélection ({picked.size})</Button>}
            {fixable.length > 0 && <Button size='sm' loading={fix.isPending} onClick={() => void fixMany(fixable.map((i) => i.key))}><Wand2 /> Tout corriger ({fixable.length})</Button>}
          </div>
        }
      >
        {!c.issues.length ? <EmptyState title='Chaque rôle Discord lié correspond au jeu' icon={ShieldCheck} /> : (
          <div className='grid divide-y'>
            {add.length > 0 && <div><h3 className='bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground'>À ajouter : le jeu le justifie, Discord ne l’a pas</h3>{rows(add)}</div>}
            {remove.length > 0 && <div><h3 className='bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground'>À retirer : Discord le donne, le jeu ne le justifie plus</h3>{rows(remove)}</div>}
          </div>
        )}
      </Section>
      {c.unlinked.length > 0 && (
        <Section title='Joueurs sans Discord lié' description='Ils ont un métier, un gang ou un rôle staff lié en jeu, mais aucun compte Discord n’est associé à leur compte FiveM : impossible de leur donner le rôle.'>
          <ul className='divide-y'>
            {c.unlinked.map((u) => (
              <li key={u.userId}>
                <button type='button' onClick={() => onOpen(u.userId)} className='flex w-full flex-wrap items-center gap-2 px-4 py-2 text-start text-sm hover:bg-accent/40'>
                  <span className='font-medium'>{u.username}</span>
                  {u.groups.map((g) => <Pill key={g} tone='neutral'>{g}</Pill>)}
                  {u.staff && <Pill tone='accent'>staff {u.staff}</Pill>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {dialog}
    </>
  )
}
