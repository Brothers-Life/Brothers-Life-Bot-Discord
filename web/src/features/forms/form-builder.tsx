import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import type { FormDef, FormField, FormFieldType, FormStep } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'short', label: 'Texte court' },
  { value: 'paragraph', label: 'Paragraphe' },
  { value: 'select', label: 'Choix dans une liste' },
  { value: 'user', label: 'Choix de membre' },
  { value: 'role', label: 'Choix de rôle' },
  { value: 'channel', label: 'Choix de salon' },
  { value: 'file', label: 'Fichier ou capture' },
]

function slug(label: string, taken: Set<string>) {
  let id = label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'champ'
  while (taken.has(id)) id = `${id}_`
  return id
}

function newField(taken: Set<string>): FormField {
  return { id: slug('question', taken), type: 'paragraph', label: '', description: '', required: true, placeholder: '', minLength: 0, maxLength: 1000, defaultValue: '' }
}

function move<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// Editor of a Discord form: up to 5 steps (one modal each) of up to 5 fields, optional condition per step
export function FormBuilder({ value, onChange, disabled, allowEmpty = true }: {
  value: FormDef
  onChange: (form: FormDef) => void
  disabled?: boolean
  allowEmpty?: boolean
}) {
  const steps = value.steps
  const allIds = () => new Set(steps.flatMap((s) => s.questions.map((q) => q.id)))
  const setSteps = (next: FormStep[]) => onChange({ steps: next })
  const patchStep = (i: number, patch: Partial<FormStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const patchField = (si: number, qi: number, patch: Partial<FormField>) =>
    patchStep(si, { questions: steps[si].questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) })

  return (
    <div className='grid gap-4'>
      {!steps.length && (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          Pas de formulaire : le ticket s’ouvre directement au clic.
        </p>
      )}
      {steps.map((step, si) => {
        // Condition: a choice question of an earlier step
        const earlier = steps.slice(0, si).flatMap((s) => s.questions).filter((q) => q.type === 'select')
        const conditionField = earlier.find((q) => q.id === step.when?.field)
        return (
          <fieldset key={si} className='grid gap-3 rounded-lg border p-3'>
            <legend className='px-1 text-sm font-semibold'>Étape {si + 1} · fenêtre {si + 1}/{steps.length}</legend>
            <div className='flex flex-wrap items-end gap-2'>
              <div className='grid min-w-48 flex-1 gap-1.5'>
                <Label htmlFor={`step-${si}-title`}>Titre de la fenêtre (45 max, facultatif)</Label>
                <Input id={`step-${si}-title`} value={step.title} maxLength={45} disabled={disabled} onChange={(e) => patchStep(si, { title: e.target.value })} />
              </div>
              <Button type='button' size='icon' variant='ghost' aria-label='Monter l’étape' disabled={disabled || si === 0} onClick={() => setSteps(move(steps, si, si - 1))}><ArrowUp /></Button>
              <Button type='button' size='icon' variant='ghost' aria-label='Descendre l’étape' disabled={disabled || si === steps.length - 1} onClick={() => setSteps(move(steps, si, si + 1))}><ArrowDown /></Button>
              <Button type='button' size='icon' variant='ghost' className='text-destructive' aria-label='Supprimer l’étape' disabled={disabled || (!allowEmpty && steps.length === 1)} onClick={() => setSteps(steps.filter((_, j) => j !== si))}><Trash2 /></Button>
            </div>
            {si > 0 && earlier.length > 0 && (
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span className='text-muted-foreground'>Afficher seulement si</span>
                <Select value={step.when?.field ?? '__always'} disabled={disabled} onValueChange={(v) => patchStep(si, { when: v === '__always' ? null : { field: v, equals: earlier.find((q) => q.id === v)?.options?.[0]?.value ?? '' } })}>
                  <SelectTrigger className='h-8 w-52' aria-label='Question de la condition'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__always'>(toujours afficher)</SelectItem>
                    {earlier.map((q) => <SelectItem key={q.id} value={q.id}>{q.label || q.id}</SelectItem>)}
                  </SelectContent>
                </Select>
                {conditionField && (
                  <>
                    <span className='text-muted-foreground'>vaut</span>
                    <Select value={step.when!.equals} disabled={disabled} onValueChange={(v) => patchStep(si, { when: { field: conditionField.id, equals: v } })}>
                      <SelectTrigger className='h-8 w-44' aria-label='Valeur de la condition'><SelectValue /></SelectTrigger>
                      <SelectContent>{conditionField.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </>
                )}
              </div>
            )}

            <ol className='grid gap-2'>
              {step.questions.map((q, qi) => (
                <li key={qi} className='grid gap-3 rounded-md border bg-muted/30 p-3'>
                  <div className='flex flex-wrap items-end gap-2'>
                    <div className='grid min-w-48 flex-1 gap-1.5'>
                      <Label htmlFor={`q-${si}-${qi}-label`}>Question {qi + 1} (45 max)</Label>
                      <Input id={`q-${si}-${qi}-label`} value={q.label} maxLength={45} disabled={disabled} placeholder='Ton pseudo en jeu' onChange={(e) => patchField(si, qi, { label: e.target.value })} />
                    </div>
                    <div className='grid gap-1.5'>
                      <Label>Type</Label>
                      <Select value={q.type} disabled={disabled} onValueChange={(v) => patchField(si, qi, {
                        type: v as FormFieldType,
                        ...(v === 'select' && !q.options?.length ? { options: [{ label: 'Choix 1', value: 'Choix 1', description: '', emoji: '' }], minValues: 1, maxValues: 1 } : {}),
                        ...((v === 'short' || v === 'paragraph') ? { maxLength: v === 'short' ? 100 : 1000 } : {}),
                        ...((v === 'user' || v === 'role' || v === 'channel' || v === 'file') ? { maxValues: 1 } : {}),
                      })}>
                        <SelectTrigger className='w-48' aria-label={`Type de la question ${qi + 1}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <label className='flex h-9 items-center gap-1.5 text-sm'>
                      <Checkbox checked={q.required} disabled={disabled} onCheckedChange={(v) => patchField(si, qi, { required: v === true })} /> Obligatoire
                    </label>
                    <Button type='button' size='icon' variant='ghost' aria-label='Monter la question' disabled={disabled || qi === 0} onClick={() => patchStep(si, { questions: move(step.questions, qi, qi - 1) })}><ArrowUp /></Button>
                    <Button type='button' size='icon' variant='ghost' aria-label='Descendre la question' disabled={disabled || qi === step.questions.length - 1} onClick={() => patchStep(si, { questions: move(step.questions, qi, qi + 1) })}><ArrowDown /></Button>
                    <Button type='button' size='icon' variant='ghost' className='text-destructive' aria-label='Supprimer la question' disabled={disabled || step.questions.length === 1} onClick={() => patchStep(si, { questions: step.questions.filter((_, j) => j !== qi) })}><X /></Button>
                  </div>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='grid gap-1.5'>
                      <Label htmlFor={`q-${si}-${qi}-desc`}>Aide sous la question (100 max)</Label>
                      <Input id={`q-${si}-${qi}-desc`} value={q.description} maxLength={100} disabled={disabled} onChange={(e) => patchField(si, qi, { description: e.target.value })} />
                    </div>
                    {q.type !== 'file' && (
                      <div className='grid gap-1.5'>
                        <Label htmlFor={`q-${si}-${qi}-ph`}>Texte d’exemple</Label>
                        <Input id={`q-${si}-${qi}-ph`} value={q.placeholder ?? ''} maxLength={q.type === 'short' || q.type === 'paragraph' ? 100 : 150} disabled={disabled} onChange={(e) => patchField(si, qi, { placeholder: e.target.value })} />
                      </div>
                    )}
                    {(q.type === 'short' || q.type === 'paragraph') && (
                      <>
                        <div className='grid grid-cols-2 gap-2'>
                          <div className='grid gap-1.5'>
                            <Label htmlFor={`q-${si}-${qi}-min`}>Longueur min.</Label>
                            <Input id={`q-${si}-${qi}-min`} type='number' min={0} max={4000} value={q.minLength ?? 0} disabled={disabled} onChange={(e) => patchField(si, qi, { minLength: Number(e.target.value) })} />
                          </div>
                          <div className='grid gap-1.5'>
                            <Label htmlFor={`q-${si}-${qi}-max`}>Longueur max.</Label>
                            <Input id={`q-${si}-${qi}-max`} type='number' min={1} max={4000} value={q.maxLength ?? 1000} disabled={disabled} onChange={(e) => patchField(si, qi, { maxLength: Number(e.target.value) })} />
                          </div>
                        </div>
                        <div className='grid gap-1.5'>
                          <Label htmlFor={`q-${si}-${qi}-def`}>Valeur pré-remplie</Label>
                          <Input id={`q-${si}-${qi}-def`} value={q.defaultValue ?? ''} disabled={disabled} onChange={(e) => patchField(si, qi, { defaultValue: e.target.value })} />
                        </div>
                      </>
                    )}
                    {q.type !== 'short' && q.type !== 'paragraph' && (
                      <div className='grid gap-1.5'>
                        <Label htmlFor={`q-${si}-${qi}-maxv`}>Nombre de choix maximum</Label>
                        <Input id={`q-${si}-${qi}-maxv`} type='number' min={1} max={q.type === 'file' ? 10 : 25} value={q.maxValues ?? 1} disabled={disabled} onChange={(e) => patchField(si, qi, { maxValues: Number(e.target.value) })} />
                      </div>
                    )}
                  </div>
                  {q.type === 'select' && (
                    <div className='grid gap-2'>
                      <span className='text-sm font-medium'>Choix ({q.options?.length ?? 0}/25)</span>
                      {q.options?.map((o, oi) => (
                        <div key={oi} className='grid gap-2 sm:grid-cols-[4rem_1fr_1.5fr_auto]'>
                          <Input value={o.emoji} maxLength={64} placeholder='🙂' aria-label={`Émoji du choix ${oi + 1}`} disabled={disabled} onChange={(e) => patchField(si, qi, { options: q.options!.map((x, j) => (j === oi ? { ...x, emoji: e.target.value } : x)) })} />
                          <Input value={o.label} maxLength={100} placeholder='Libellé' aria-label={`Libellé du choix ${oi + 1}`} disabled={disabled} onChange={(e) => patchField(si, qi, { options: q.options!.map((x, j) => (j === oi ? { ...x, label: e.target.value, value: e.target.value.slice(0, 100) } : x)) })} />
                          <Input value={o.description} maxLength={100} placeholder='Description (facultatif)' aria-label={`Description du choix ${oi + 1}`} disabled={disabled} onChange={(e) => patchField(si, qi, { options: q.options!.map((x, j) => (j === oi ? { ...x, description: e.target.value } : x)) })} />
                          <Button type='button' size='icon' variant='ghost' aria-label={`Supprimer le choix ${oi + 1}`} disabled={disabled || q.options!.length === 1} onClick={() => patchField(si, qi, { options: q.options!.filter((_, j) => j !== oi) })}><X /></Button>
                        </div>
                      ))}
                      {!disabled && (q.options?.length ?? 0) < 25 && (
                        <Button type='button' size='sm' variant='outline' className='justify-self-start' onClick={() => patchField(si, qi, { options: [...(q.options ?? []), { label: `Choix ${(q.options?.length ?? 0) + 1}`, value: `Choix ${(q.options?.length ?? 0) + 1}`, description: '', emoji: '' }] })}>
                          <Plus /> Ajouter un choix
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {!disabled && step.questions.length < 5 && (
              <Button type='button' size='sm' variant='outline' className='justify-self-start' onClick={() => patchStep(si, { questions: [...step.questions, newField(allIds())] })}>
                <Plus /> Ajouter une question ({step.questions.length}/5)
              </Button>
            )}
          </fieldset>
        )
      })}
      {!disabled && steps.length < 5 && (
        <Button type='button' variant='outline' className='justify-self-start' onClick={() => setSteps([...steps, { title: '', when: null, questions: [newField(allIds())] }])}>
          <Plus /> Ajouter une étape ({steps.length}/5)
        </Button>
      )}
    </div>
  )
}
