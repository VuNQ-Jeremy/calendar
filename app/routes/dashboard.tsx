import type { LoaderFunctionArgs } from 'react-router';
import { useOutletContext, useNavigate } from 'react-router';
import { DashboardScreen } from '../../src/screens-core.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import * as eventsSvc from '../../server/services/events';
import * as homeworkSvc from '../../server/services/homework';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import { iso, TODAY } from '../../src/lib/core.js';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const today = iso(TODAY);
  const [todayEvents, homework, classes, students, materials] = await Promise.all([
    eventsSvc.listForToday(db, today),
    homeworkSvc.list(db),
    classesSvc.listLite(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
  ]);
  return {
    todayEvents,
    homework,
    classes,
    studentCount: students.length,
    materialCount: materials.length,
  };
}

export default function Dashboard() {
  const { user } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  return <DashboardScreen user={user} onNav={(id: string) => navigate('/' + id)} />;
}
