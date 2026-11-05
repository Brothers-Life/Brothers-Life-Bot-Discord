import { useState, type ReactNode } from 'react'

// Discord-style markdown rendered as React nodes (never as raw HTML, so user text cannot inject markup).
// `leaf` draws the plain text pieces (server emojis, ...); code is always left untouched.
export type Leaf = (text: string) => ReactNode

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <span role='button' tabIndex={0} title={shown ? undefined : 'Cliquer pour révéler'} onClick={() => setShown(true)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShown(true) }}
      className={shown ? 'rounded bg-white/10 px-0.5' : 'cursor-pointer rounded bg-[#1e1f22] px-0.5 text-transparent select-none [&_*]:text-transparent'}>
      {children}
    </span>
  )
}

const RULES: { re: RegExp; render: (m: RegExpExecArray, inner: (s: string) => ReactNode, key: string) => ReactNode }[] = [
  { re: /``([\s\S]+?)``|`([^`\n]+)`/, render: (m, _i, key) => <code key={key} className='rounded bg-[#1e1f22] px-1 py-px font-mono text-[0.85em]'>{m[1] ?? m[2]}</code> },
  { re: /\*\*([\s\S]+?)\*\*(?!\*)/, render: (m, inner, key) => <strong key={key} className='font-bold'>{inner(m[1])}</strong> },
  { re: /__([\s\S]+?)__(?!_)/, render: (m, inner, key) => <u key={key}>{inner(m[1])}</u> },
  { re: /~~([\s\S]+?)~~/, render: (m, inner, key) => <s key={key}>{inner(m[1])}</s> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, inner, key) => <Spoiler key={key}>{inner(m[1])}</Spoiler> },
  { re: /\*(?!\s)([^*\n]+?)\*(?!\*)/, render: (m, inner, key) => <em key={key} className='italic'>{inner(m[1])}</em> },
  { re: /(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])/, render: (m, inner, key) => <em key={key} className='italic'>{inner(m[1])}</em> },
  { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, render: (m, inner, key) => <a key={key} href={m[2]} target='_blank' rel='noreferrer noopener' className='text-[#00a8fc] hover:underline'>{inner(m[1])}</a> },
  { re: /https?:\/\/[^\s<>]+/, render: (m, _i, key) => <a key={key} href={m[0]} target='_blank' rel='noreferrer noopener' className='text-[#00a8fc] hover:underline'>{m[0]}</a> },
]

function renderInline(text: string, leaf: Leaf, prefix = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    let best: { m: RegExpExecArray; rule: (typeof RULES)[number] } | null = null
    for (const rule of RULES) {
      const m = rule.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { m, rule }
    }
    if (!best) { out.push(<span key={`${prefix}${n}`}>{leaf(rest)}</span>); break }
    if (best.m.index > 0) out.push(<span key={`${prefix}${n++}`}>{leaf(rest.slice(0, best.m.index))}</span>)
    const key = `${prefix}${n++}`
    out.push(best.rule.render(best.m, (s) => renderInline(s, leaf, `${key}-`), key))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return out
}

export function DiscordMarkdown({ text, leaf = (s) => s }: { text: string; leaf?: Leaf }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0
  const flushText: string[] = []
  const flush = () => {
    if (!flushText.length) return
    blocks.push(<div key={`t${k++}`} className='whitespace-pre-wrap break-words'>{renderInline(flushText.join('\n'), leaf, `t${k}-`)}</div>)
    flushText.length = 0
  }
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      let j = i + 1
      while (j < lines.length && !lines[j].trimEnd().endsWith('```')) j++
      const closed = j < lines.length
      if (closed) {
        flush()
        const body = [line.slice(3), ...lines.slice(i + 1, j), lines[j].trimEnd().slice(0, -3)]
        // an optional language name sits right after the opening fence
        if (body.length > 1 && /^[\w+-]*$/.test(body[0].trim())) body.shift()
        blocks.push(<pre key={`c${k++}`} className='my-1 overflow-x-auto rounded border border-[#1e1f22] bg-[#2b2d31] p-2 font-mono text-[0.85em] whitespace-pre-wrap break-words'>{body.join('\n').replace(/^\n|\n$/g, '')}</pre>)
        i = j + 1
        continue
      }
    }
    const quote = /^>>> ?([\s\S]*)$/.exec(line)
    if (quote) {
      flush()
      const body = [quote[1], ...lines.slice(i + 1)].join('\n')
      blocks.push(<blockquote key={`q${k++}`} className='my-0.5 border-s-4 border-[#4e5058] ps-3 whitespace-pre-wrap break-words'>{renderInline(body, leaf, `q${k}-`)}</blockquote>)
      i = lines.length
      continue
    }
    if (/^> /.test(line) || line === '>') {
      flush()
      const body: string[] = []
      while (i < lines.length && (/^> /.test(lines[i]) || lines[i] === '>')) body.push(lines[i++].slice(2))
      blocks.push(<blockquote key={`q${k++}`} className='my-0.5 border-s-4 border-[#4e5058] ps-3 whitespace-pre-wrap break-words'>{renderInline(body.join('\n'), leaf, `q${k}-`)}</blockquote>)
      continue
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      flush()
      const size = ['text-2xl', 'text-xl', 'text-base'][heading[1].length - 1]
      blocks.push(<div key={`h${k++}`} className={`${size} mt-1 font-bold break-words text-white`}>{renderInline(heading[2], leaf, `h${k}-`)}</div>)
      i++
      continue
    }
    if (/^\s*[-*] /.test(line)) {
      flush()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''))
      blocks.push(<ul key={`l${k++}`} className='my-0.5 list-disc ps-6 break-words'>{items.map((it, x) => <li key={x}>{renderInline(it, leaf, `l${k}-${x}-`)}</li>)}</ul>)
      continue
    }
    flushText.push(line)
    i++
  }
  flush()
  return <>{blocks}</>
}
