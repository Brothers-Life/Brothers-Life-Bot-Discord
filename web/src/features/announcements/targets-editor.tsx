import type { AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Servers -> channels to post in, and for each channel whom to ping
export function TargetsEditor({ guilds, targets, onChange, disabled }: {
  guilds: AnnouncementTargetsPayload
  targets: AnnouncementTarget[]
  onChange: (targets: AnnouncementTarget[]) => void
  disabled: boolean
}) {
  const { can } = useMe()
  const canEveryone = can('announcements.everyone')

  const toggleChannel = (guildId: string, channelId: string) => {
    const exists = targets.some((t) => t.channelId === channelId)
    onChange(exists
      ? targets.filter((t) => t.channelId !== channelId)
      : [...targets, { guildId, channelId, ping: 'none', roleIds: [], publish: false }])
  }
  const patch = (channelId: string, value: Partial<AnnouncementTarget>) =>
    onChange(targets.map((t) => (t.channelId === channelId ? { ...t, ...value } : t)))

  return (
    <div className='grid gap-4'>
      {guilds.map((guild) => {
        const selected = targets.filter((t) => t.guildId === guild.id)
        return (
          <div key={guild.id} className='rounded-md border'>
            <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
              <span className='font-medium'>{guild.name}</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type='button' size='sm' variant='outline' disabled={disabled}>
                    {selected.length ? `${selected.length} salon${selected.length > 1 ? 's' : ''}` : 'Choisir des salons'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' className='max-h-80 w-72 overflow-y-auto p-1'>
                  {guild.channels.map((c) => (
                    <label key={c.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent has-disabled:opacity-50'>
                      <Checkbox checked={selected.some((t) => t.channelId === c.id)} disabled={!c.canSend} onCheckedChange={() => toggleChannel(guild.id, c.id)} />
                      <span className='truncate'>#{c.name}</span>
                      {c.parent && <span className='ms-auto truncate text-xs text-muted-foreground'>{c.parent}</span>}
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            {selected.length > 0 && (
              <ul className='divide-y'>
                {selected.map((t) => {
                  const channel = guild.channels.find((c) => c.id === t.channelId)
                  return (
                    <li key={t.channelId} className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'>
                      <span className='min-w-32 flex-1 truncate'>#{channel?.name ?? 'salon supprimé'}</span>
                      <Select value={t.ping} onValueChange={(v) => patch(t.channelId, { ping: v as AnnouncementTarget['ping'], roleIds: v === 'roles' ? t.roleIds : [] })} disabled={disabled}>
                        <SelectTrigger className='h-8 w-40' aria-label={`Ping dans #${channel?.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>Pas de ping</SelectItem>
                          <SelectItem value='everyone' disabled={!canEveryone}>@everyone</SelectItem>
                          <SelectItem value='here' disabled={!canEveryone}>@here</SelectItem>
                          <SelectItem value='roles'>Des rôles…</SelectItem>
                        </SelectContent>
                      </Select>
                      {t.ping === 'roles' && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type='button' size='sm' variant='outline' className='h-8' disabled={disabled}>
                              {t.roleIds.length ? t.roleIds.map((id) => `@${guild.roles.find((r) => r.id === id)?.name ?? '?'}`).join(', ') : 'Choisir les rôles'}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className='max-h-72 w-64 overflow-y-auto p-1'>
                            {guild.roles.map((role) => (
                              <label key={role.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent'>
                                <Checkbox
                                  checked={t.roleIds.includes(role.id)}
                                  onCheckedChange={() => patch(t.channelId, { roleIds: t.roleIds.includes(role.id) ? t.roleIds.filter((r) => r !== role.id) : [...t.roleIds, role.id] })}
                                />
                                <span aria-hidden className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                                <span className='truncate'>{role.name}</span>
                              </label>
                            ))}
                          </PopoverContent>
                        </Popover>
                      )}
                      {channel?.announcement && (
                        <label className='flex items-center gap-1.5 text-xs'>
                          <Checkbox checked={t.publish} onCheckedChange={(v) => patch(t.channelId, { publish: v === true })} disabled={disabled} />
                          Publier aux abonnés
                        </label>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
