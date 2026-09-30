import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronsUpDown, KeyRound, LogOut, Moon, Sun } from 'lucide-react'
import { api } from '@/lib/api'
import { useMe } from '@/hooks/use-me'
import { useTheme } from '@/context/theme-provider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function NavUser() {
  const { isMobile } = useSidebar()
  const { me } = useMe()
  const { resolvedTheme, setTheme } = useTheme()
  const [confirmLogout, setConfirmLogout] = useState(false)
  if (!me) return null

  const name = me.user.username ?? me.user.id
  const role = me.isOwner ? 'Chef du réseau' : (me.ranks[0]?.name ?? 'Sans rang')

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/login')
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size='lg' className='data-[state=open]:bg-sidebar-accent'>
                <Avatar className='size-8 rounded-md'>
                  {me.user.avatar && <AvatarImage src={me.user.avatar} alt='' />}
                  <AvatarFallback className='rounded-md'>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-start text-sm leading-tight'>
                  <span className='truncate font-medium'>{name}</span>
                  <span className='truncate text-xs text-sidebar-foreground/60'>{role}</span>
                </div>
                <ChevronsUpDown className='ms-auto size-4' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-56'
              side={isMobile ? 'bottom' : 'right'}
              align='end'
              sideOffset={4}
            >
              <DropdownMenuLabel className='font-normal'>
                <div className='text-sm font-medium'>{name}</div>
                <div className='text-xs text-muted-foreground'>ID {me.user.id}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
                {resolvedTheme === 'dark' ? 'Thème clair' : 'Thème sombre'}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to='/sessions'>
                  <KeyRound />
                  Mes sessions
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => setConfirmLogout(true)}>
                <LogOut />
                Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title='Se déconnecter'
        desc='Ta session sur cet appareil sera fermée.'
        confirmText='Se déconnecter'
        handleConfirm={logout}
        className='sm:max-w-sm'
      />
    </>
  )
}
