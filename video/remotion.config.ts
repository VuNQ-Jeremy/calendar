import path from 'node:path';
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setConcurrency(4);

/**
 * `@shared/*` resolves to the app's own `shared/` directory — the same modules the
 * web app and the Expo app consume. Tokens, i18n strings and the changelog parser
 * are imported straight from there so the videos can never drift from the product.
 *
 * The repo deliberately has no npm workspaces (Metro fights hoisted deps, see
 * docs/mobile/README.md), but Remotion bundles with webpack, which happily reads
 * files above the project root once they are aliased.
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...config.resolve?.alias,
      '@shared': path.resolve(process.cwd(), '..', 'shared'),
    },
  },
}));
