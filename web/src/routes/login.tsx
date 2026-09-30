import { createFileRoute } from '@tanstack/react-router'
import { BrandMark } from '@/components/app/brand-mark'
import { Button } from '@/components/ui/button'

const ERRORS: Record<string, string> = {
  denied: 'Ton compte Discord n’a pas accès au panel. Demande à un responsable de te donner un rang avec l’accès au panel.',
  state: 'La connexion a expiré ou a été modifiée. Recommence.',
  cancelled: 'Connexion annulée sur Discord.',
  discord: 'Discord n’a pas répondu correctement. Réessaie dans un instant.',
  not_configured: 'Le panel n’est pas configuré : APP_ID et CLIENT_SECRET manquent dans le fichier .env du bot.',
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: LoginPage,
})

function DiscordIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden className='size-5 fill-current'>
      <path d='M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z' />
    </svg>
  )
}

function LoginPage() {
  const { error } = Route.useSearch()
  const message = error ? (ERRORS[error] ?? 'La connexion a échoué.') : null

  return (
    <main className='grid min-h-svh place-items-center bg-sidebar px-6'>
      <div className='w-full max-w-sm'>
        <BrandMark className='size-14' />
        <h1 className='mt-8 text-3xl font-semibold tracking-tight'>Brothers Life</h1>
        <p className='mt-2 text-muted-foreground'>
          Panel de gestion du réseau : serveurs, staff, logs et bot.
        </p>

        {message && (
          <p role='alert' className='mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
            {message}
          </p>
        )}

        <Button asChild size='lg' className='mt-8 w-full gap-2 bg-[#5865f2] text-white hover:bg-[#4752c4]'>
          <a href='/api/auth/login'>
            <DiscordIcon />
            Se connecter avec Discord
          </a>
        </Button>
        <p className='mt-4 text-xs text-muted-foreground'>
          Seul ton identifiant Discord est demandé. L’accès dépend des rangs attribués dans le panel.
        </p>
      </div>
    </main>
  )
}
