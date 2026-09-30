import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/jetbrains-mono'
import { ApiError, errorMessage } from '@/lib/api'
import { ThemeProvider } from './context/theme-provider'
import { routeTree } from './routeTree.gen'
import './styles/index.css'

function goToLogin() {
  if (window.location.pathname !== '/login') window.location.assign('/login')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
    mutations: {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) return goToLogin()
        toast.error(errorMessage(error))
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) goToLogin()
    },
  }),
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme='dark'>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
