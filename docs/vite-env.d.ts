/// <reference types="vite/client" />

// Markdown is imported as a module (MDX turns each file into a component) and the stylesheet has no
// types of its own; neither has a declaration in TypeScript.
declare module '*.md' {
  import type { ComponentType } from 'react'

  const Component: ComponentType
  export default Component
}

declare module 'github-markdown-css' {}
