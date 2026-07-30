import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Heading } from '~/ui';

/**
 * "Exit Mochi?" — shown when Android back is pressed on one of the tab bar's own screens.
 *
 * The design-system replacement for the native Alert this started as. It borrows MoveEventSheet's
 * overlay anatomy exactly — scrim Pressable, inner Pressable that swallows taps, secondary/primary
 * button row — but as a CENTERED card with a fade rather than a bottom sheet with a slide. A
 * leave-or-stay question is a dialog; a sheet is for editing something.
 *
 * Title only, no message line, and Exit is `primary` rather than `danger`: `exitApp()` is
 * `moveTaskToBack`, so nothing is discarded and there is nothing to warn about. `danger` is
 * reserved for deletes in this app.
 *
 * While this Modal is visible, Android hands the hardware back press to the Modal natively and it
 * arrives here as `onRequestClose` — the BackHandler subscription in (app)/_layout.tsx never fires.
 * Back-on-dialog therefore cancels, which is also what a scrim tap does.
 */
export function ExitConfirmDialog({
  visible,
  onCancel,
  onExit,
}: {
  visible: boolean;
  onCancel: () => void;
  onExit: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* Tapping the scrim cancels, as MoveEventSheet's backdrop does. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('cancel')}
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(60,40,25,0.45)',
          justifyContent: 'center',
          padding: th.spacing[6],
        }}
      >
        {/* An inner Pressable with no handler swallows taps so they do not reach the scrim. */}
        <Pressable
          style={{
            backgroundColor: th.color.surfaceCard,
            borderRadius: th.radius.xl,
            padding: th.spacing[5],
            gap: th.spacing[5],
          }}
        >
          <Heading>{t('m_exit_q')}</Heading>
          <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
            <Button variant="secondary" style={{ flex: 1 }} onPress={onCancel}>
              {t('cancel')}
            </Button>
            <Button variant="primary" style={{ flex: 1 }} onPress={onExit}>
              {t('m_exit')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
