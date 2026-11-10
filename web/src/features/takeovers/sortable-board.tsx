import { useState, type ReactNode } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

// One column per category, `id: null` being what has no category (never moved, always last)
export type BoardColumn = { id: number | null; items: number[] }

type HandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'> & { label: string }

const columnKey = (id: number | null) => `column:${id ?? 'none'}`
const dropKey = (id: number | null) => `drop:${id ?? 'none'}`
const itemKey = (id: number) => `item:${id}`
const isItemKey = (key: string) => key.startsWith('item:')
const itemOf = (key: string) => Number(key.slice('item:'.length))

// The column an item, a column or an empty drop zone belongs to
function columnIndex(board: BoardColumn[], key: string) {
  if (isItemKey(key)) return board.findIndex((c) => c.items.includes(itemOf(key)))
  return board.findIndex((c) => columnKey(c.id) === key || dropKey(c.id) === key)
}

// A column only collides with columns, an item with the items and the empty columns
const collision: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => (kind === 'column') === (c.data.current?.kind === 'column')),
  })
}

const accessibility = {
  screenReaderInstructions: { draggable: 'Appuie sur Espace pour saisir cet élément, déplace-le avec les flèches, puis Espace pour le poser ou Échap pour annuler.' },
  announcements: {
    onDragStart: () => 'Élément saisi.',
    onDragOver: () => undefined,
    onDragEnd: () => 'Élément posé.',
    onDragCancel: () => 'Déplacement annulé.',
  },
}

function Handle({ attributes, listeners, setActivatorNodeRef, label }: HandleProps) {
  return (
    <button
      type='button' ref={setActivatorNodeRef} aria-label={label} {...attributes} {...listeners}
      className='flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing'
    >
      <GripVertical className='size-4' />
    </button>
  )
}

function SortableRow({ id, label, disabled, children }: { id: number; label: string; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: itemKey(id), data: { kind: 'item' }, disabled })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('flex items-center gap-1 bg-card pl-2', isDragging && 'relative z-10 opacity-70 shadow-lg')}>
      {!disabled && <Handle attributes={attributes} listeners={listeners} setActivatorNodeRef={setActivatorNodeRef} label={`Déplacer ${label}`} />}
      <div className='min-w-0 flex-1'>{children}</div>
    </li>
  )
}

function ColumnBody({ column, disabled, itemLabel, renderItem, empty }: {
  column: BoardColumn
  disabled: boolean
  itemLabel: (id: number) => string
  renderItem: (id: number) => ReactNode
  empty: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropKey(column.id), data: { kind: 'drop' }, disabled: column.items.length > 0 })
  return (
    <SortableContext items={column.items.map(itemKey)} strategy={verticalListSortingStrategy}>
      {column.items.length > 0
        ? <ul className='divide-y'>{column.items.map((id) => <SortableRow key={id} id={id} label={itemLabel(id)} disabled={disabled}>{renderItem(id)}</SortableRow>)}</ul>
        : <div ref={setNodeRef} className={cn('px-4 py-5 text-center text-sm text-muted-foreground', isOver && 'bg-accent text-foreground')}>{empty}</div>}
    </SortableContext>
  )
}

function SortableColumn({ id, label, disabled, renderHeader, children }: {
  id: number
  label: string
  disabled: boolean
  renderHeader: (handle: ReactNode) => ReactNode
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: columnKey(id), data: { kind: 'column' }, disabled })
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('overflow-hidden rounded-md border bg-card', isDragging && 'relative z-20 opacity-80 shadow-xl')}>
      {renderHeader(!disabled && <Handle attributes={attributes} listeners={listeners} setActivatorNodeRef={setActivatorNodeRef} label={`Déplacer la catégorie ${label}`} />)}
      {children}
    </section>
  )
}

// Categories and their items, both ordered by dragging. `onChange` gets the whole new layout; the board shows it until the promise settles
export function SortableBoard({ columns, editable, onChange, columnLabel, itemLabel, renderHeader, renderItem, empty }: {
  columns: BoardColumn[]
  editable: boolean
  onChange: (columns: BoardColumn[]) => Promise<unknown>
  columnLabel: (id: number) => string
  itemLabel: (id: number) => string
  renderHeader: (id: number | null, handle: ReactNode) => ReactNode
  renderItem: (id: number) => ReactNode
  empty: string
}) {
  const [draft, setDraft] = useState<BoardColumn[] | null>(null)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const board = draft ?? columns
  const disabled = !editable || saving
  const movable = board.filter((c) => c.id !== null)
  const fixed = board.filter((c) => c.id === null)

  // Crossing into another column moves the item right away, so the rows open up under the pointer
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.data.current?.kind !== 'item') return
    const key = String(active.id)
    const overKey = String(over.id)
    const from = columnIndex(board, key)
    const to = columnIndex(board, overKey)
    if (from < 0 || to < 0 || from === to) return
    const item = itemOf(key)
    const translated = active.rect.current.translated
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2
    const index = isItemKey(overKey) ? board[to].items.indexOf(itemOf(overKey)) + (below ? 1 : 0) : board[to].items.length
    setDraft(board.map((c, i) => {
      if (i === from) return { ...c, items: c.items.filter((x) => x !== item) }
      if (i === to) return { ...c, items: [...c.items.slice(0, index), item, ...c.items.slice(index)] }
      return c
    }))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return setDraft(null)
    const key = String(active.id)
    const overKey = String(over.id)
    let next = board
    if (active.data.current?.kind === 'column') {
      const from = board.findIndex((c) => columnKey(c.id) === key)
      const to = board.findIndex((c) => columnKey(c.id) === overKey)
      if (from >= 0 && to >= 0 && from !== to) next = arrayMove(board, from, to)
    }
    else {
      const column = columnIndex(board, key)
      if (column >= 0 && isItemKey(overKey) && columnIndex(board, overKey) === column) {
        const { items } = board[column]
        next = board.map((c, i) => (i === column ? { ...c, items: arrayMove(items, items.indexOf(itemOf(key)), items.indexOf(itemOf(overKey))) } : c))
      }
    }
    if (JSON.stringify(next) === JSON.stringify(columns)) return setDraft(null)
    setDraft(next)
    setSaving(true)
    void onChange(next).catch(() => undefined).finally(() => { setDraft(null); setSaving(false) })
  }

  const body = (column: BoardColumn) => <ColumnBody column={column} disabled={disabled} itemLabel={itemLabel} renderItem={renderItem} empty={empty} />
  return (
    <DndContext sensors={sensors} collisionDetection={collision} accessibility={accessibility} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDraft(null)}>
      <div className='grid grid-cols-[minmax(0,1fr)] gap-3 p-3'>
        <SortableContext items={movable.map((c) => columnKey(c.id))} strategy={verticalListSortingStrategy}>
          {movable.map((column) => (
            <SortableColumn key={column.id} id={column.id as number} label={columnLabel(column.id as number)} disabled={disabled} renderHeader={(handle) => renderHeader(column.id, handle)}>
              {body(column)}
            </SortableColumn>
          ))}
        </SortableContext>
        {fixed.map((column) => (
          <section key='none' className='overflow-hidden rounded-md border bg-card'>
            {renderHeader(null, null)}
            {body(column)}
          </section>
        ))}
      </div>
    </DndContext>
  )
}
