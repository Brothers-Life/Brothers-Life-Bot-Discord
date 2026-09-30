import { createFileRoute, redirect } from '@tanstack/react-router'
import { ApiError } from '@/lib/api'
import { meQuery } from '@/hooks/use-me'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        throw redirect({ to: '/login', search: { error: error.status === 403 ? 'denied' : undefined } })
      }
      throw error
    }
  },
  component: AuthenticatedLayout,
})
