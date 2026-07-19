import { createFileRoute } from '@tanstack/react-router'
import { projectDir } from '../../lib/server/paths'

// Identity probe for agents (the storyboard skill): confirms this server is
// Mission Control and reports which project directory it is serving, so a
// skill can find a running board (or know it must start one) before linking
// the user to it.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => Response.json({ app: 'mission-control', projectDir: projectDir() }),
    },
  },
})
