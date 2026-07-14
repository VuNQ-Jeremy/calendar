import { createCookie } from 'react-router';

export const sessionCookie = createCookie('__mochi_session', {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
});
