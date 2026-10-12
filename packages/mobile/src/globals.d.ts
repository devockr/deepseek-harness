/// <reference types="typed-query-selector" />
// The two globals a client bundle is written against, taken from dsh's own published declarations
// rather than restated here: a change to either then shows up as a build failure instead of drifting
// quietly. Nothing in this file reaches the bundle — it is a declaration file, so it emits nothing,
// and the imports below are the client type faces that carry the service augmentations.
import type { Context } from '@deepseek-ai/cordis'
import type { ClientBundleRegistration } from '@deepseek-ai/dsh-client-modules/client'
import '@deepseek-ai/dsh-client-connection/client'
import '@deepseek-ai/dsh-api-gateway/client'

declare global {
  interface Window {
    __ModuleLoader__: {
      load(module: ClientBundleRegistration): void
    }
  }
  // The same object, declared as a global binding so a bundle written against `globalThis`
  // type-checks too — in a browser the two are the same thing.
  var __ModuleLoader__: {
    load(module: ClientBundleRegistration): void
  }
  /** The plugin context, as dsh's own client plugins type it: `Context` plus the client services. */
  type PluginContext = Context
  /** What a contribution returns so it can undo itself. */
  type Disposable = () => void
}
