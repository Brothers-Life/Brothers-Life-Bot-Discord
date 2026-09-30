import { useState } from 'react'
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

// Screenshots of the server, as on the loading screen
const BACKGROUNDS = ['/brand/sunset-heli.webp', '/brand/sunset-car.webp', '/brand/sunset-road.webp']

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
  const [background] = useState(() => BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)])
  const [loaded, setLoaded] = useState(false)

  return (
    <main className='dark relative grid min-h-svh place-items-center overflow-hidden bg-[#08060a] px-6 text-[#fff3e6]'>
      {/* Screenshot of the server, drifting slowly, pulled toward the sunset */}
      <div aria-hidden className='absolute -inset-[3%] overflow-hidden'>
        <img
          src={background} alt='' onLoad={() => setLoaded(true)}
          className={`ken-burns size-full object-cover transition-opacity duration-1000 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
      <div
        aria-hidden
        className='absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,4,3,0.75)_0%,rgba(5,4,3,0.1)_35%,rgba(5,4,3,0.1)_55%,rgba(5,4,3,0.92)_100%),radial-gradient(120%_80%_at_50%_55%,transparent_40%,rgba(0,0,0,0.6)_100%)]'
      />

      <section className='brackets page-enter relative w-full max-w-md rounded-2xl border border-[rgba(255,150,40,0.22)] bg-[rgba(14,10,6,0.62)] p-8 shadow-[0_18px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-10'>
        <div className='flex items-center gap-4'>
          <BrandMark className='size-16' />
          <div className='grid gap-1'>
            <span className='kicker !text-[#ffb968]'>Panel du staff</span>
            <h1 className='font-display text-3xl leading-none font-bold tracking-[0.1em] uppercase sm:text-4xl'>Brothers Life</h1>
          </div>
        </div>
        <div aria-hidden className='mt-6 h-px bg-gradient-to-r from-[#ff9628] via-[#ff9628]/30 to-transparent' />
        <p className='mt-5 text-[rgba(255,243,230,0.72)]'>
          Serveurs, staff, sanctions, tickets et bot : tout le réseau au même endroit.
        </p>

        {message && (
          <p role='alert' className='mt-6 rounded-md border border-[#f0545a]/50 bg-[#f0545a]/12 px-3 py-2 text-sm text-[#ffb3b5]'>
            {message}
          </p>
        )}

        <Button asChild size='lg' className='mt-8 w-full gap-2 bg-[#5865f2] text-white shadow-[0_8px_24px_-8px_#5865f2] hover:bg-[#4752c4]'>
          <a href='/api/auth/login'>
            <DiscordIcon />
            Se connecter avec Discord
          </a>
        </Button>
        <p className='mt-4 text-xs text-[rgba(255,243,230,0.55)]'>
          Seul ton identifiant Discord est demandé. L’accès dépend des rangs attribués dans le panel.
        </p>
      </section>
    </main>
  )
}
