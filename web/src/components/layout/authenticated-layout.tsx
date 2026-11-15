import { Outlet } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { useMe } from '@/hooks/use-me'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'
import { useTelemetryStream } from '@/features/telemetry/use-stream'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

function TelemetryUpdateListener() {
  const { can } = useMe()
  const queryClient = useQueryClient()
  useTelemetryStream((tick) => {
    const families = new Set(tick.updates ?? [])
    if (!families.size) return
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'telemetry'
        && typeof query.queryKey[1] === 'string'
        && families.has(query.queryKey[1]),
    })
  }, can('telemetry.view'))
  return null
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
      <LayoutProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SkipToMain />
          <AppSidebar />
          <SidebarInset
            className={cn(
              // Set content container, so we can use container queries
              '@container/content',

              // If layout is fixed, set the height
              // to 100svh to prevent overflow
              'has-data-[layout=fixed]:h-svh',

              // If layout is fixed and sidebar is inset,
              // set the height to 100svh - spacing (total margins) to prevent overflow
              'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
            )}
          >
            <TelemetryUpdateListener />
            {children ?? <Outlet />}
          </SidebarInset>
        </SidebarProvider>
      </LayoutProvider>
  )
}
