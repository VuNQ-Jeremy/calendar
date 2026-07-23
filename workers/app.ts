/// <reference types="vite/client" />
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareCtx } from '../app/load-context';

// Durable Object used to relocate Anthropic API egress to a supported region
// (see workers/translate-proxy.ts). Must be exported from the Worker's main
// module for Cloudflare to register the class.
export { TranslateProxy } from './translate-proxy';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const context = new RouterContextProvider(new Map([[cloudflareCtx, { env, ctx }]]));
    const url = new URL(request.url);
    const start = Date.now();
    try {
      const response = await requestHandler(request, context);
      console.log('[request]', {
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - start,
      });
      return response;
    } catch (err) {
      console.error('[request] unhandled', {
        method: request.method,
        path: url.pathname,
        ms: Date.now() - start,
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;
