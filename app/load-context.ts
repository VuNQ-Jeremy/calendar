import { createContext } from 'react-router';

export const cloudflareCtx = createContext<{ env: Env; ctx: ExecutionContext }>();
