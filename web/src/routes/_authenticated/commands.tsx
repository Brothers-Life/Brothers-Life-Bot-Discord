import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { api } from '@/lib/api'
import type { CommandInfo } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/commands')({
  component: CommandsPage,
})

function CommandsPage() {
  const { can } = useMe()
  const commands = useQuery({ queryKey: ['commands'], queryFn: () => api<CommandInfo[]>('/commands') })

  if (!commands.data) return <Page title='Commandes'><Skeleton className='h-96 w-full' /></Page>
  const categories = [...new Set(commands.data.map((c) => c.category))]

  return (
    <Page
      title='Commandes'
      description='Les commandes du bot et la permission de rang que chacune vérifie. Les permissions se donnent dans « Rangs ». La colonne de droite montre ce que tu peux faire toi-même.'
    >
      <div className='grid gap-6'>
        {categories.map((category) => (
          <Section key={category} title={category}>
            <ul className='divide-y'>
              {commands.data.filter((c) => c.category === category).map((c) => {
                const allowed = !c.permissions.length || c.permissions.some((p) => can(p.key))
                return (
                  <li key={c.name} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <code className='min-w-32 rounded bg-muted px-2 py-1 font-mono text-sm'>/{c.name}</code>
                    <div className='min-w-56 flex-1'>
                      <div className='text-sm'>{c.description}</div>
                      <div className='mt-1 flex flex-wrap gap-1'>
                        {c.permissions.length ? c.permissions.map((p) => <Pill key={p.key}>{p.label}</Pill>) : <Pill>Tout le monde</Pill>}
                      </div>
                    </div>
                    {allowed
                      ? <Pill tone='success'><Check className='size-3' /> Autorisé</Pill>
                      : <Pill><Minus className='size-3' /> Pas pour toi</Pill>}
                  </li>
                )
              })}
            </ul>
          </Section>
        ))}
      </div>
    </Page>
  )
}
