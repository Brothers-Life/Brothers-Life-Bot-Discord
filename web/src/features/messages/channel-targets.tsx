import type { AnnouncementTargetsPayload } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export type ChannelTarget = { guildId: string; channelId: string }

// Channels of several servers of the network, grouped by server
export function ChannelTargets({ guilds, value, onChange, disabled }: {
  guilds: AnnouncementTargetsPayload
  value: ChannelTarget[]
  onChange: (targets: ChannelTarget[]) => void
  disabled?: boolean
}) {
  const toggle = (guildId: string, channelId: string) => onChange(
    value.some((t) => t.channelId === channelId) ? value.filter((t) => t.channelId !== channelId) : [...value, { guildId, channelId }],
  )
  return (
    <div className='grid gap-2'>
      {guilds.map((guild) => {
        const selected = value.filter((t) => t.guildId === guild.id)
        return (
          <div key={guild.id} className='flex flex-wrap items-center gap-2 rounded-md border px-3 py-2'>
            <span className='min-w-32 flex-1 text-sm font-medium'>{guild.name}</span>
            <span className='text-xs text-muted-foreground'>{selected.map((t) => `#${guild.channels.find((c) => c.id === t.channelId)?.name ?? '?'}`).join(', ')}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button type='button' size='sm' variant='outline' disabled={disabled}>{selected.length ? 'Modifier' : 'Choisir des salons'}</Button>
              </PopoverTrigger>
              <PopoverContent align='end' className='max-h-80 w-72 overflow-y-auto p-1'>
                {guild.channels.map((c) => (
                  <label key={c.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent has-disabled:opacity-50'>
                    <Checkbox checked={selected.some((t) => t.channelId === c.id)} disabled={!c.canSend} onCheckedChange={() => toggle(guild.id, c.id)} />
                    <span className='truncate'>#{c.name}</span>
                    {c.parent && <span className='ms-auto truncate text-xs text-muted-foreground'>{c.parent}</span>}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )
      })}
    </div>
  )
}
