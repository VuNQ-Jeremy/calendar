import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('materials/:id/download', 'routes/materials.$id.download.tsx'),
  layout('routes/_app.tsx', [
    index('routes/home.tsx'),
    route('dashboard', 'routes/dashboard.tsx'),
    route('calendar', 'routes/calendar.tsx'),
    route('classes', 'routes/classes.tsx'),
    route('people', 'routes/people.tsx'),
    route('materials', 'routes/materials.tsx'),
    route('homework', 'routes/homework.tsx'),
    route('assessments', 'routes/assessments.tsx'),
    route('feedback', 'routes/feedback.tsx'),
    route('profile', 'routes/profile.tsx'),
  ]),
] satisfies RouteConfig;
