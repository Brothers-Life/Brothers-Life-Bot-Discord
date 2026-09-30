import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function NotFoundError() {
  return (
    <div className='flex h-svh flex-col items-center justify-center gap-3 px-6 text-center'>
      <h1 className='text-2xl font-semibold'>Cette page n’existe pas</h1>
      <p className='text-muted-foreground'>Le lien est peut-être ancien, ou la page a été déplacée.</p>
      <Button asChild className='mt-4'>
        <Link to='/'>Retour à la vue d’ensemble</Link>
      </Button>
    </div>
  )
}
