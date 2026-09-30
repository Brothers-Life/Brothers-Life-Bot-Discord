import { Link, useLocation } from '@tanstack/react-router'
import { useLayout } from '@/context/layout-provider'
import { useMe } from '@/hooks/use-me'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { BrandMark } from '@/components/app/brand-mark'
import { navSections } from './nav'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { can } = useMe()
  const { setOpenMobile } = useSidebar()
  const pathname = useLocation({ select: (l) => l.pathname })

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size='lg' asChild className='hover:bg-transparent'>
              <Link to='/' onClick={() => setOpenMobile(false)}>
                <BrandMark className='!size-8 shrink-0' />
                <div className='grid leading-tight'>
                  <span className='truncate font-semibold tracking-tight'>Brothers Life</span>
                  <span className='truncate text-xs text-sidebar-foreground/60'>Panel du réseau</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navSections.map((section) => {
          const items = section.items.filter((item) => item.permission === null || can(item.permission))
          if (!items.length) return null
          return (
            <SidebarGroup key={section.title}>
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => {
                  const active = item.url === '/' ? pathname === '/' : pathname.startsWith(item.url)
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} onClick={() => setOpenMobile(false)}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
