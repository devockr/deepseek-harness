/// <reference types="vite/client" />

// The site imports Markdown as a module; MDX turns each file into a component, but TypeScript has no
// built-in declaration for the extension.
declare module '*.md' {
  import type { ComponentType } from 'react'

  const Component: ComponentType
  export default Component
}
