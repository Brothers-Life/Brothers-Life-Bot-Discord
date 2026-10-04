import type { Inline, RichBlock } from './types'

// Renders the safe Markdown subset parsed by the server (src/core/richText.js): only elements, never raw HTML
function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((item, i) => {
        if (item.t === 'b') return <strong key={i} className='font-semibold text-[#fff3e6]'>{item.v}</strong>
        if (item.t === 'i') return <em key={i}>{item.v}</em>
        if (item.t === 'link' && /^https?:\/\//i.test(item.href)) {
          return <a key={i} href={item.href} target='_blank' rel='noopener noreferrer nofollow' className='text-[#ffb968] underline decoration-[#ff9628]/50 underline-offset-4 hover:decoration-[#ff9628]'>{item.v}</a>
        }
        return <span key={i}>{item.v}</span>
      })}
    </>
  )
}

export function RichText({ blocks }: { blocks: RichBlock[] }) {
  return (
    <div className='grid max-w-[68ch] gap-4 leading-relaxed text-[rgba(255,243,230,0.78)]'>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h': {
            const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]
            return (
              <Tag key={i} className={block.level === 1
                ? 'mt-4 font-display text-2xl font-semibold tracking-wide text-[#fff3e6] first:mt-0'
                : 'mt-2 font-display text-lg font-semibold tracking-wide text-[#ffb968] first:mt-0'}>
                <Inlines items={block.inline} />
              </Tag>
            )
          }
          case 'p':
            return <p key={i}>{block.lines.map((line, j) => <span key={j}>{j > 0 && <br />}<Inlines items={line} /></span>)}</p>
          case 'ul':
          case 'ol': {
            const List = block.type
            return (
              <List key={i} className={`grid gap-1.5 pl-6 ${block.type === 'ul' ? 'list-disc marker:text-[#ff9628]' : 'list-decimal marker:font-display marker:text-[#ff9628]'}`}>
                {block.items.map((item, j) => <li key={j}><Inlines items={item} /></li>)}
              </List>
            )
          }
          case 'hr':
            return <hr key={i} className='border-[rgba(255,150,40,0.18)]' />
          default:
            return null
        }
      })}
    </div>
  )
}
