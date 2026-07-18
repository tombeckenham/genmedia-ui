import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { Toaster } from '../components/ui/sonner'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Mission Control',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        // Inline filmstrip glyph (teal on zinc-950) so the tab reads as the
        // film-production console without shipping a binary asset.
        rel: 'icon',
        type: 'image/svg+xml',
        href: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227%22%20fill%3D%22%2309090b%22%2F%3E%3Crect%20x%3D%228%22%20y%3D%226%22%20width%3D%2216%22%20height%3D%2220%22%20rx%3D%222%22%20fill%3D%22%2314b8a6%22%2F%3E%3Cg%20fill%3D%22%2309090b%22%3E%3Crect%20x%3D%2210%22%20y%3D%228%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2214.5%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2221%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3Crect%20x%3D%2219%22%20y%3D%228%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3Crect%20x%3D%2219%22%20y%3D%2214.5%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3Crect%20x%3D%2219%22%20y%3D%2221%22%20width%3D%223%22%20height%3D%223%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="bottom-center" />
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
