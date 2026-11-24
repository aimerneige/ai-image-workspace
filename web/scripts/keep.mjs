// Vite empties the output dir; restore the placeholder so `go:embed` keeps
// working on a fresh checkout and git does not report it as deleted.
import { writeFileSync } from 'node:fs'
writeFileSync(new URL('../../internal/webui/dist/.gitkeep', import.meta.url), '')
