import { useOutletContext } from 'react-router';
import { ProfileScreen } from '../../src/screens-extra.jsx';
import type { AppContext } from './_app.js';

export default function Profile() {
  const { user, onUpdateUser, onLogout } = useOutletContext<AppContext>();
  return <ProfileScreen user={user} onSave={onUpdateUser} onLogout={onLogout} />;
}
