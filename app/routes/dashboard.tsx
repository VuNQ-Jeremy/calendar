import { useOutletContext, useNavigate } from 'react-router';
import { DashboardScreen } from '../../src/screens-core.jsx';
import type { AppContext } from './_app.js';

export default function Dashboard() {
  const { user } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  return <DashboardScreen user={user} onNav={(id: string) => navigate('/' + id)} />;
}
