import { useOutletContext } from 'react-router';
import { FeedbackScreen } from '../../src/feedback.jsx';
import type { AppContext } from './_app.js';

export default function Feedback() {
  const { user } = useOutletContext<AppContext>();
  return <FeedbackScreen user={user} />;
}
