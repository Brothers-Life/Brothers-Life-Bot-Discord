import { ExternalLink } from 'lucide-react'
import type { AnnouncementEmbed, AnnouncementTarget } from '@/lib/types'
import { imageUrl } from '@/features/uploads/upload'
import { EmojiView } from '@/components/app/emoji-picker'
import { StickerImage } from '@/components/app/sticker-picker'

export type PreviewExtras = { gallery?: string[]; attachments?: string[]; buttons?: { label: string; url: string; emoji: string | null }[]; reactions?: string[]; stickers?: { id: string; name: string; format: number; description: string }[] }

// Text with the server emojis (<:name:id>) drawn as images, like Discord does
function Rich({ text }: { text: string }) {
  const parts = text.split(/(<a?:\w{2,32}:\d{17,20}>)/g)
  return <>{parts.map((part, i) => (i % 2 ? <EmojiView key={i} value={part} /> : part))}</>
}

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

export function DiscordPreview({ content, embed, target, roles, botName = 'Brothers Life', extras = {} }: {
  content: string
  embed: AnnouncementEmbed
  target?: AnnouncementTarget
  roles: Map<string, string>
  botName?: string
  extras?: PreviewExtras
}) {
  const img = (src: string | null) => imageUrl(src) ?? undefined
  const gallery = [embed.imageUrl, ...(extras.gallery ?? [])].filter(Boolean) as string[]
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
              <Rich text={content} />
            </div>
          )}
          {embed.enabled && (
            <div className='mt-1 grid max-w-[520px] rounded border-l-4 bg-[#2b2d31] p-3 pe-4' style={{ borderColor: embed.color }}>
              <div className='flex gap-4'>
                <div className='min-w-0 flex-1 space-y-1'>
                  {embed.authorName && (
                    <div className='flex items-center gap-2 text-sm font-medium text-white'>
                      {embed.authorIconUrl && <img src={img(embed.authorIconUrl)} alt='' className='size-6 rounded-full' />}
                      <Rich text={embed.authorName} />
                    </div>
                  )}
                  {embed.title && (
                    <div className={embed.url ? 'font-semibold text-[#00a8fc] hover:underline' : 'font-semibold text-white'}><Rich text={embed.title} /></div>
                  )}
                  {embed.description && <div className='text-sm whitespace-pre-wrap break-words'><Rich text={embed.description} /></div>}
                  {inline.length > 0 && (
                    <div className='mt-2 grid grid-cols-3 gap-2'>
                      {inline.map((f, i) => (
                        <div key={i} className={f.inline ? 'col-span-1' : 'col-span-3'}>
                          <div className='text-sm font-semibold text-white'><Rich text={f.name} /></div>
                          <div className='text-sm whitespace-pre-wrap break-words'><Rich text={f.value} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {embed.thumbnailUrl && <img src={img(embed.thumbnailUrl)} alt='' className='size-20 shrink-0 rounded object-cover' />}
              </div>
              {gallery.length === 1 && <img src={img(gallery[0])} alt='' className='mt-3 max-h-80 rounded object-cover' />}
              {gallery.length > 1 && (
                <div className='mt-3 grid grid-cols-2 gap-1 overflow-hidden rounded'>
                  {gallery.map((src, i) => <img key={i} src={img(src)} alt='' className={`h-32 w-full object-cover ${gallery.length === 3 && i === 0 ? 'col-span-2' : ''}`} />)}
                </div>
              )}
              {(embed.footerText || embed.timestamp) && (
                <div className='mt-2 flex items-center gap-2 text-xs text-[#b5bac1]'>
                  {embed.footerIconUrl && <img src={img(embed.footerIconUrl)} alt='' className='size-5 rounded-full' />}
                  <Rich text={embed.footerText} />
                  {embed.footerText && embed.timestamp && ' • '}
                  {embed.timestamp && `Aujourd’hui à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                </div>
              )}
            </div>
          )}
          {!!extras.attachments?.length && (
            <div className='mt-2 flex flex-wrap gap-2'>
              {extras.attachments.map((src, i) => <img key={i} src={img(src)} alt='' className='max-h-40 max-w-60 rounded object-cover' />)}
            </div>
          )}
          {!!extras.stickers?.length && (
            <div className='mt-2 flex flex-wrap gap-2'>
              {extras.stickers.map((s) => <StickerImage key={s.id} sticker={s} className='size-40' />)}
            </div>
          )}
          {!!extras.buttons?.length && (
            <div className='mt-2 flex flex-wrap gap-2'>
              {extras.buttons.map((b, i) => (
                <span key={i} className='flex items-center gap-1.5 rounded bg-[#4e5058] px-4 py-1.5 text-sm font-medium text-white'>
                  {b.emoji && <EmojiView value={b.emoji} />}{b.label || 'Bouton'}<ExternalLink className='size-3.5' />
                </span>
              ))}
            </div>
          )}
          {!!extras.reactions?.length && (
            <div className='mt-1.5 flex flex-wrap gap-1'>
              {extras.reactions.map((r) => <span key={r} className='flex items-center gap-1.5 rounded-lg border border-[#5865f2] bg-[#5865f2]/15 px-2 py-0.5 text-sm'><EmojiView value={r} /> <span className='text-xs'>1</span></span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
