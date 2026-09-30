import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function GeneralError({ error }: { error?: unknown }) {
  const { history } = useRouter()
  return (
    <div className='flex h-svh flex-col items-center justify-center gap-3 px-6 text-center'>
      <h1 className='text-2xl font-semibold'>La page a planté</h1>
      <p className='max-w-md text-muted-foreground'>
        {error instanceof Error ? error.message : 'Une erreur inattendue est survenue.'} Le détail est dans la console du bot.
      </p>
      <div className='mt-4 flex gap-3'>
        <Button variant='outline' onClick={() => history.go(-1)}>Revenir en arrière</Button>
        <Button onClick={() => window.location.reload()}>Recharger</Button>
      </div>
    </div>
  )
}
