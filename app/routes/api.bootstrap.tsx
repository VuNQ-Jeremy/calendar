import { withAuth } from '../../server/api/handler';
import { iso } from '../../shared/logic/dates';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as assessmentTypesSvc from '../../server/services/assessment-types';
import * as homeworkSvc from '../../server/services/homework';
import * as invitesSvc from '../../server/services/invites';
import * as feedbackSvc from '../../server/services/feedback';
import * as uiPrefsSvc from '../../server/services/ui-prefs';
import * as themeSvc from '../../server/services/theme';

/**
 * Everything a cold app start needs, in one round trip.
 *
 * Not a mirror of any web route — the web gets this data per-route from loaders. On a
 * Vietnamese mobile connection five sequential requests is the difference between a fast
 * app and a slow one.
 *
 * Students receive only their own identity and prefs: they must never be sent the roster.
 * Mirrors the student branch of the _app.tsx layout loader.
 */
export const loader = withAuth('user', async ({ user, db }) => {
  const identity = { user: { ...user.user, kind: user.kind }, account: user.account };

  if (user.kind === 'student') {
    const uiPrefs = await uiPrefsSvc.getUiPrefs(db);
    return {
      ...identity,
      uiPrefs,
      badgeCounts: { homeworkDue: 0, unusedInvites: 0, newFeedback: 0 },
    };
  }

  const today = iso(new Date());
  const [classes, students, assessmentTypes, uiPrefs, theme, homeworkDue, unusedInvites, newFeedback] =
    await Promise.all([
      classesSvc.list(db),
      peopleSvc.listStudents(db),
      assessmentTypesSvc.list(db),
      uiPrefsSvc.getUiPrefs(db),
      themeSvc.getTheme(db),
      homeworkSvc.countDue(db, today),
      invitesSvc.countUnused(db),
      feedbackSvc.countNew(db),
    ]);

  return {
    ...identity,
    classes,
    students,
    assessmentTypes,
    uiPrefs,
    theme,
    badgeCounts: { homeworkDue, unusedInvites, newFeedback },
  };
});
