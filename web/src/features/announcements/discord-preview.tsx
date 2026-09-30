import type { AnnouncementEmbed, AnnouncementTarget } from '@/lib/types'

// Rough rendering of the Discord message, to check the look before sending.
// Discord's own colors on purpose: this is what members will see.
const mention = 'rounded bg-[#5865f2]/30 px-0.5 font-medium text-[#c9cdfb]'

function Pings({ target, roles }: { target?: AnnouncementTarget; roles: Map<string, string> }) {
  if (!target || target.ping === 'none') return null
  if (target.ping === 'everyone' || target.ping === 'here') return <span className={mention}>@{target.ping}</span>
  return (
    <>
      {target.roleIds.map((id) => <span key={id} className={`${mention} me-1`}>@{roles.get(id) ?? 'rôle'}</span>)}
    </>
  )
}

export function DiscordPreview({ content, embed, target, roles, botName = 'Brothers Life' }: {
  content: string
  embed: AnnouncementEmbed
  target?: AnnouncementTarget
  roles: Map<string, string>
  botName?: string
}) {
  const inline = embed.fields.filter((f) => f.name || f.value)
  return (
    <div className='rounded-lg bg-[#313338] p-4 font-[system-ui] text-[15px] leading-[1.375] text-[#dbdee1]'>
      <div className='flex gap-4'>
        <div className='grid size-10 shrink-0 place-items-center rounded-full bg-[#5865f2] text-sm font-semibold text-white'>BL</div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <span className='font-medium text-white'>{botName}</span>
            <span className='rounded bg-[#5865f2] px-1 text-[10px] font-semibold text-white'>APP</span>
            <span className='text-xs text-[#949ba4]'>Aujourd’hui à {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {(content || (target && target.ping !== 'none')) && (
            <div className='whitespace-pre-wrap break-words'>
              <Pings target={target} roles={roles} />
              {target && target.ping !== 'none' && content ? '\n' : ''}
              {content}
            </div>
          )}
          {embed.enabled && (
            <div className='mt-1 grid max-w-[520px] rounded border-l-4 bg-[#2b2d31] p-3 pe-4' style={{ borderColor: embed.color }}>
              <div className='flex gap-4'>
                <div className='min-w-0 flex-1 space-y-1'>
                  {embed.authorName && (
                    <div className='flex items-center gap-2 text-sm font-medium text-white'>
                      {embed.authorIconUrl && <img src={embed.authorIconUrl} alt='' className='size-6 rounded-full' />}
                      {embed.authorName}
                    </div>
                  )}
                  {embed.title && (
                    <div className={embed.url ? 'font-semibold text-[#00a8fc] hover:underline' : 'font-semibold text-white'}>{embed.title}</div>
                  )}
                  {embed.description && <div className='text-sm whitespace-pre-wrap break-words'>{embed.description}</div>}
                  {inline.length > 0 && (
                    <div className='mt-2 grid grid-cols-3 gap-2'>
                      {inline.map((f, i) => (
                        <div key={i} className={f.inline ? 'col-span-1' : 'col-span-3'}>
                          <div className='text-sm font-semibold text-white'>{f.name}</div>
                          <div className='text-sm whitespace-pre-wrap break-words'>{f.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {embed.thumbnailUrl && <img src={embed.thumbnailUrl} alt='' className='size-20 shrink-0 rounded object-cover' />}
              </div>
              {embed.imageUrl && <img src={embed.imageUrl} alt='' className='mt-3 max-h-80 rounded object-cover' />}
              {(embed.footerText || embed.timestamp) && (
                <div className='mt-2 flex items-center gap-2 text-xs text-[#b5bac1]'>
                  {embed.footerIconUrl && <img src={embed.footerIconUrl} alt='' className='size-5 rounded-full' />}
                  {embed.footerText}
                  {embed.footerText && embed.timestamp && ' • '}
                  {embed.timestamp && `Aujourd’hui à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
