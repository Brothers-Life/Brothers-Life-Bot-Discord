import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { EmptyState, Notice, Page, Pill, Section, StatCards } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { dt, fmt, rel } from '@/features/telemetry/format'
import { Mono, QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/ingest')({
  component: TelemetryIngest,
})

type Line = { key: string; label?: string | null; n: number; last: string | number | null; expected: boolean }
type Table = { key: string; mode: string | null; rows: number; last: number | null; expected: boolean }
type Problem = { source: 'mirror' | 'batch'; name: string; error: string; firstAt: string; lastAt: string; count: number }
type Report = { at: number; readings: Line[]; types: Line[]; subtypes: Line[]; gameLogs: Line[]; cards: Line[]; mirror: Table[]; problems: Problem[] }

const MODES: Record<string, string> = { append: 'journal', updated: 'modifications', hash: 'empreinte', replace: 'copie entière', count: 'comptée seulement' }

function State({ last, expected }: { last: unknown; expected: boolean }) {
  if (!last) return <Pill tone='warning'>jamais reçu</Pill>
  if (!expected) return <Pill tone='info'>hors note 1.6</Pill>
  return <Pill tone='success'>reçu</Pill>
}

// One kind of data: what it is, how many in 24 h (or rows), when it last arrived
function Lines({ title, description, lines, unit, missingOnly }: { title: string; description: string; lines: Line[]; unit: string; missingOnly: boolean }) {
  const missing = lines.filter((l) => !l.last).length
  const shown = missingOnly ? lines.filter((l) => !l.last) : lines
  return (
    <Section title={`${title} · ${lines.length - missing} sur ${lines.length}`} description={description}>
      {shown.length === 0 ? <p className='px-4 py-3 text-sm text-muted-foreground'>Rien ne manque ici.</p> : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[520px] text-sm'>
            <thead className='text-xs text-muted-foreground'>
              <tr className='border-b'><th className='px-4 py-2 text-start font-medium'>Nom</th><th className='px-2 text-end font-medium'>{unit}</th><th className='px-2 text-start font-medium'>Dernière réception</th><th className='px-4 text-end font-medium'>État</th></tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.key} className='border-b last:border-0'>
                  <td className='px-4 py-1.5'><Mono>{l.key}</Mono>{l.label && <span className='ms-2 text-muted-foreground'>{l.label}</span>}</td>
                  <td className='px-2 text-end tabular-nums'>{l.n ? fmt(l.n) : '–'}</td>
                  <td className='px-2 text-muted-foreground' title={l.last ? dt(l.last) : undefined}>{l.last ? rel(l.last) : '–'}</td>
                  <td className='px-4 text-end'><State last={l.last} expected={l.expected} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function TelemetryIngest() {
  const [missingOnly, setMissingOnly] = useState(false)
  const q = useQuery({ queryKey: ['telemetry', 'ingest'], queryFn: () => api<Report>('/telemetry/ingest'), refetchInterval: 60_000 })
  const d = q.data
  const all = d ? [...d.readings, ...d.types, ...d.subtypes, ...d.gameLogs, ...d.cards] : []
  const tables = d?.mirror ?? []
  const missingTables = tables.filter((t) => !t.last)
  const shownTables = missingOnly ? missingTables : tables

  return (
    <Page
      title='Télémétrie · Réception des données'
      description='Tout ce que le serveur de jeu envoie au panel (ressource bl_telemetry), comparé à ce que sa version 1.6 annonce : ce qui arrive, ce qui n’est jamais arrivé, et ce que le panel n’a pas pu enregistrer.'
      actions={
        <div className='flex items-center gap-2'>
          <Switch id='missing-only' checked={missingOnly} onCheckedChange={setMissingOnly} />
          <Label htmlFor='missing-only'>Seulement ce qui manque</Label>
        </div>
      }
    >
      {q.isError && <QueryError error={q.error} />}
      {q.isPending && <Skeleton className='h-64' />}
      {d && (
        <>
          <StatCards items={[
            { label: 'Types de données reçus', value: `${all.filter((l) => l.last).length} / ${all.length}`, tone: 'success' },
            { label: 'Tables du jeu copiées', value: `${tables.length - missingTables.length} / ${tables.length}`, tone: 'success' },
            { label: 'Jamais reçus', value: all.filter((l) => !l.last).length + missingTables.length, tone: 'warning' },
            { label: 'Non enregistrés', value: d.problems.length, tone: d.problems.length ? 'danger' : 'neutral' },
          ]} />

          {d.problems.length > 0 ? (
            <Section title='Envoyé par le jeu mais non enregistré' description='Chaque ligne est une donnée perdue tant que la cause n’est pas corrigée. Une table qui se synchronise à nouveau disparaît de cette liste.'>
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[640px] text-sm'>
                  <thead className='text-xs text-muted-foreground'>
                    <tr className='border-b'><th className='px-4 py-2 text-start font-medium'>Quoi</th><th className='px-2 text-start font-medium'>Raison</th><th className='px-2 text-end font-medium'>Fois</th><th className='px-4 text-start font-medium'>Dernière fois</th></tr>
                  </thead>
                  <tbody>
                    {d.problems.map((p) => (
                      <tr key={`${p.source}:${p.name}`} className='border-b align-top last:border-0'>
                        <td className='px-4 py-1.5'><Pill tone='neutral' className='me-2'>{p.source === 'mirror' ? 'table' : 'événement'}</Pill><Mono>{p.name}</Mono></td>
                        <td className='px-2 py-1.5 text-destructive'>{p.error}</td>
                        <td className='px-2 py-1.5 text-end tabular-nums'>{fmt(p.count)}</td>
                        <td className='px-4 py-1.5 text-muted-foreground' title={dt(p.lastAt)}>{rel(p.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : <Notice tone='success' title='Rien de perdu'>Tout ce que le jeu a envoyé ces 7 derniers jours a été enregistré.</Notice>}

          <Notice tone='info'>
            « Jamais reçu » ne veut pas forcément dire panne : une table absente du serveur de jeu n’est jamais envoyée, et un événement rare (braquage, mise en prison) peut ne pas s’être produit depuis 24 h.
          </Notice>

          <Lines title='Relevés périodiques' description='Photos envoyées toutes les 5 minutes.' unit='Reçus en 24 h' lines={d.readings} missingOnly={missingOnly} />
          <Lines title='Types d’événements' description='Champ « type » des envois.' unit='Reçus en 24 h' lines={d.types} missingOnly={missingOnly} />
          <Lines title='Événements de jeu' description='Sous-types de « event » ajoutés par la 1.6 (service, métier, argent, objets, prison…).' unit='Reçus en 24 h' lines={d.subtypes} missingOnly={missingOnly} />
          <Lines title='Journaux du jeu' description='Tables suivies ligne à ligne (« game_log »).' unit='Reçus en 24 h' lines={d.gameLogs} missingOnly={missingOnly} />
          <Lines title='Cartes de la base du jeu' description='Résultats calculés par le jeu toutes les 15 minutes, affichés dans Activités et Base de données.' unit='Lignes' lines={d.cards} missingOnly={missingOnly} />

          <Section title={`Copie de la base du jeu · ${tables.length - missingTables.length} sur ${tables.length}`} description='Tables recopiées dans le panel (miroir). Les contenus privés sont seulement comptés.'>
            {shownTables.length === 0 ? <EmptyState title='Rien ne manque ici' /> : (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[560px] text-sm'>
                  <thead className='text-xs text-muted-foreground'>
                    <tr className='border-b'><th className='px-4 py-2 text-start font-medium'>Table</th><th className='px-2 text-start font-medium'>Copie</th><th className='px-2 text-end font-medium'>Lignes</th><th className='px-2 text-start font-medium'>Dernière synchro</th><th className='px-4 text-end font-medium'>État</th></tr>
                  </thead>
                  <tbody>
                    {shownTables.map((t) => (
                      <tr key={t.key} className='border-b last:border-0'>
                        <td className='px-4 py-1.5'><Mono>{t.key}</Mono></td>
                        <td className='px-2 text-muted-foreground'>{t.mode ? MODES[t.mode] ?? t.mode : '–'}</td>
                        <td className='px-2 text-end tabular-nums'>{t.last ? fmt(t.rows) : '–'}</td>
                        <td className='px-2 text-muted-foreground' title={t.last ? dt(t.last) : undefined}>{t.last ? rel(t.last) : '–'}</td>
                        <td className='px-4 text-end'><State last={t.last} expected={t.expected} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </Page>
  )
}
