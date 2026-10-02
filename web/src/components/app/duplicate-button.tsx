import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Same look everywhere: icon button, or with its text when `text` is set
export function DuplicateButton({ name, onClick, text = false, disabled, loading }: { name?: string; onClick: () => void; text?: boolean; disabled?: boolean; loading?: boolean }) {
  const label = name ? `Dupliquer ${name}` : 'Dupliquer'
  return text
    ? <Button type='button' size='sm' variant='outline' onClick={onClick} disabled={disabled} loading={loading}><Copy /> Dupliquer</Button>
    : <Button type='button' size='icon' variant='ghost' aria-label={label} title='Dupliquer' onClick={onClick} disabled={disabled} loading={loading}><Copy /></Button>
}
