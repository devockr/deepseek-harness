/**
 * Host half. The decision this package carries is made in the browser (see ./client), because
 * that is where dsh decides whether the privileged surface belongs to the page. The browser
 * cannot answer it alone: the authorities this deployment serves live in the host's `connection`
 * service, so this half hands them over and the browser half checks its own authority against
 * them instead of granting the surface to whoever can load the page.
 */
export const name = '@idsh/privileged-ui'

/** The path the browser half reads. Read-only, and no secret: it is the deployment's own names. */
export const trustedHostsPath = '/idsh/trusted-hosts'

const HTTP_OK = 200
const HTTP_METHOD_NOT_ALLOWED = 405

interface RouteRequest {
  method?: string
}

interface RouteResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

interface HostContext {
  webServer?: { register(route: unknown): unknown }
  get(name: string): unknown
  inject(names: string[], callback: (ctx: HostContext) => void): void
}

/**
 * The authorities dsh accepts besides loopback, as the host declared them (`dsh web
 * --trusted-host <name>`, plus the LAN literals it derives when bound to `0.0.0.0`). Empty when
 * the host is older than that service, which leaves the browser half trusting loopback only.
 */
function declaredAuthorities(ctx: HostContext): string[] {
  const connection = ctx.get('connection') as
    { trustedHosts?: unknown } | undefined

  return Array.isArray(connection?.trustedHosts)
    ? connection.trustedHosts.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : []
}

/** The listener's own literal, which dsh accepts on any port independently of the list above. */
function boundAddresses(ctx: HostContext): string[] {
  const startup = ctx.get('webStartup') as { host?: unknown } | undefined

  return typeof startup?.host === 'string' && startup.host !== ''
    ? [startup.host]
    : []
}

function answer(
  request: RouteRequest,
  response: RouteResponse,
  ctx: HostContext,
): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(HTTP_METHOD_NOT_ALLOWED, { allow: 'GET' })
    response.end()
    return
  }

  response.writeHead(HTTP_OK, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(
    JSON.stringify({
      trustedHosts: declaredAuthorities(ctx),
      bindHosts: boundAddresses(ctx),
    }),
  )
}

export function apply(ctx: HostContext): void {
  ctx.inject(['webServer'], ctx => {
    const { webServer } = ctx
    if (webServer !== undefined) {
      webServer.register({
        kind: 'exact',
        path: trustedHostsPath,
        handler: (request: RouteRequest, response: RouteResponse) => {
          answer(request, response, ctx)
        },
      })
    }
  })
}
