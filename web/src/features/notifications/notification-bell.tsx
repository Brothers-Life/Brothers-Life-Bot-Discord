import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, CheckCheck, Settings2, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useLive } from '@/hooks/use-live'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'

type PanelNotification = {
  id: number
  type: string
  title: string
  body: string | null
  url: string | null
  guildId: string | null
  createdAt: number
  read: boolean
}
type NotificationList = { items: PanelNotification[]; unread: number }
type Prefs = { disabled: string[]; types: { key: string; label: string }[] }

const KEY = ['notifications']
const DESKTOP_KEY = 'brl.desktopNotifications'

function desktopSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

function readDesktopPref() {
  try {
    return localStorage.getItem(DESKTOP_KEY) === '1'
  } catch {
    return false
  }
}

function writeDesktopPref(on: boolean) {
  try {
    localStorage.setItem(DESKTOP_KEY, on ? '1' : '0')
  } catch {
    // Private mode: the choice lasts until the tab closes
  }
}

// Bell of the panel header: unread count, list, live feed and browser notifications while the panel is open
export function NotificationBell() {
  const qc = useQueryClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'prefs'>('list')
  const [desktop, setDesktop] = useState(() => readDesktopPref() && desktopSupported() && Notification.permission === 'granted')
  const { data } = useQuery({ queryKey: KEY, queryFn: () => api<NotificationList>('/notifications'), refetchInterval: 120_000 })

  const go = (url: string | null) => {
    if (!url) return
    setOpen(false)
    router.history.push(url)
  }

  useLive<{ type: 'notification'; notification: PanelNotification }>('/api/notifications/live', (event) => {
    if (event.type !== 'notification') return
    const n = event.notification
    qc.setQueryData<NotificationList>(KEY, (old) => {
      if (!old || old.items.some((x) => x.id === n.id)) return old
      return { items: [n, ...old.items].slice(0, 100), unread: old.unread + 1 }
    })
    // Desktop notification when the tab is in the background, a toast otherwise
    if (desktop && document.hidden && desktopSupported() && Notification.permission === 'granted') {
      const shown = new Notification(n.title, { body: n.body ?? undefined, icon: '/brand/logo.png', tag: `brl-${n.id}` })
      shown.onclick = () => {
        window.focus()
        go(n.url)
        shown.close()
      }
    } else {
      toast(n.title, { description: n.body ?? undefined, action: n.url ? { label: 'Voir', onClick: () => go(n.url) } : undefined })
    }
  })

  const markRead = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) => api<{ unread: number }>('/notifications/read', { method: 'POST', body }),
    onMutate: (body) => {
      qc.setQueryData<NotificationList>(KEY, (old) => old && {
        items: old.items.map((x) => (body.all || body.ids?.includes(x.id) ? { ...x, read: true } : x)),
        unread: body.all ? 0 : Math.max(old.unread - (body.ids?.filter((id) => old.items.some((x) => x.id === id && !x.read)).length ?? 0), 0),
      })
    },
    onSuccess: ({ unread }) => qc.setQueryData<NotificationList>(KEY, (old) => old && { ...old, unread }),
  })

  const unread = data?.unread ?? 0
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setView('list') }}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='icon' className='relative' aria-label={unread ? `Notifications, ${unread} non lue(s)` : 'Notifications'}>
          <Bell />
          {unread > 0 && (
            <span className='absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-black shadow-[0_0_8px_var(--brand)]'>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[min(24rem,calc(100vw-2rem))] p-0'>
        {view === 'list'
          ? (
            <>
              <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
                <span className='font-display font-semibold tracking-wide'>Notifications</span>
                <div className='flex gap-1'>
                  <Button variant='ghost' size='sm' disabled={!unread} onClick={() => markRead.mutate({ all: true })}><CheckCheck /> Tout lu</Button>
                  <Button variant='ghost' size='icon' className='size-8' aria-label='Préférences des notifications' onClick={() => setView('prefs')}><Settings2 /></Button>
                </div>
              </div>
              <ul className='max-h-[min(28rem,70svh)] overflow-y-auto'>
                {!data?.items.length && (
                  <li className='grid justify-items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground'>
                    <BellOff className='size-5' aria-hidden />
                    Rien de nouveau. Les tickets, candidatures, appels, absences et alertes anti-raid arrivent ici.
                  </li>
                )}
                {data?.items.map((n) => (
                  <li key={n.id} className='border-b last:border-b-0'>
                    <button
                      type='button'
                      className={cn('flex w-full gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', !n.read && 'bg-primary/5')}
                      onClick={() => {
                        if (!n.read) markRead.mutate({ ids: [n.id] })
                        go(n.url)
                      }}
                    >
                      <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand shadow-[0_0_6px_var(--brand)]')} />
                      <span className='grid min-w-0 gap-0.5'>
                        <span className={cn('text-sm', !n.read && 'font-medium')}>{n.title}</span>
                        {n.body && <span className='line-clamp-2 text-xs text-muted-foreground'>{n.body}</span>}
                        <span className='text-xs text-muted-foreground'>{ago(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
          : <NotificationPrefs desktop={desktop} setDesktop={setDesktop} onBack={() => setView('list')} />}
      </PopoverContent>
    </Popover>
  )
}

function NotificationPrefs({ desktop, setDesktop, onBack }: { desktop: boolean; setDesktop: (v: boolean) => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<Prefs>('/notifications/prefs') })
  const save = useMutation({
    mutationFn: (disabled: string[]) => api<Prefs>('/notifications/prefs', { method: 'PUT', body: { disabled } }),
    onSuccess: (prefs) => {
      qc.setQueryData(['notification-prefs'], prefs)
      qc.invalidateQueries({ queryKey: KEY })
    },
  })

  async function toggleDesktop(on: boolean) {
    if (!on) {
      writeDesktopPref(false)
      setDesktop(false)
      return
    }
    if (!desktopSupported()) return toast.error('Ce navigateur ne gère pas les notifications.')
    // Asked on a click: browsers refuse a permission prompt that comes from nowhere
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') return toast.error('Notifications refusées par le navigateur : autorise-les dans les réglages du site.')
    writeDesktopPref(true)
    setDesktop(true)
  }

  return (
    <div>
      <div className='flex items-center gap-2 border-b px-2 py-2'>
        <Button variant='ghost' size='icon' className='size-8' aria-label='Retour aux notifications' onClick={onBack}><ArrowLeft /></Button>
        <span className='font-display font-semibold tracking-wide'>Préférences</span>
      </div>
      <div className='grid gap-4 p-3'>
        <label className='flex items-start gap-3 text-sm'>
          <Switch checked={desktop} onCheckedChange={toggleDesktop} className='mt-0.5' />
          <span>
            Notifications du navigateur
            <span className='block text-xs text-muted-foreground'>Quand l’onglet du panel est ouvert mais en arrière-plan.</span>
          </span>
        </label>
        <div className='grid gap-1.5'>
          <span className='text-xs font-medium text-muted-foreground'>Me prévenir pour</span>
          {data?.types.map((t) => {
            const on = !data.disabled.includes(t.key)
            return (
              <label key={t.key} className='flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent'>
                <Checkbox
                  checked={on}
                  disabled={save.isPending}
                  onCheckedChange={() => save.mutate(on ? [...data.disabled, t.key] : data.disabled.filter((k) => k !== t.key))}
                />
                {t.label}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
