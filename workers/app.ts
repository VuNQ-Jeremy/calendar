/// <reference types="vite/client" />
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareCtx } from '../app/load-context';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const context = new RouterContextProvider(new Map([[cloudflareCtx, { env, ctx }]]));
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
