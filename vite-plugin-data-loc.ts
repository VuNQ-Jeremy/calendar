/// <reference types="node" />
// Stamps every JSX host element (<div>, <button>, ...) with a data-loc="relative/path.tsx:line"
// attribute at build time. Lets the dev-only inspector overlay (src/dev-inspector.tsx) show
// exactly which source line rendered a given element, so debugging over chat can reference
// a file:line instead of a screenshot.
import path from 'node:path';
import * as babel from '@babel/core';
import type { NodePath, PluginObj } from '@babel/core';
import type { JSXOpeningElement } from '@babel/types';
import type { Plugin } from 'vite';

const TAGGABLE_FILE = /\.tsx$/;
const SKIP_DIR = /node_modules/;

export function dataLocPlugin(): Plugin {
  let root = process.cwd();

  return {
    name: 'data-loc',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      if (process.env.VITEST) return null;
      const [filename] = id.split('?');
      if (!TAGGABLE_FILE.test(filename) || SKIP_DIR.test(filename)) return null;

      const relPath = path.relative(root, filename).split(path.sep).join('/');
      if (!(relPath.startsWith('src/') || relPath.startsWith('app/'))) {
        return null;
      }

      const result = babel.transformSync(code, {
        filename,
        babelrc: false,
        configFile: false,
        plugins: [
          '@babel/plugin-syntax-jsx',
          ['@babel/plugin-syntax-typescript', { isTSX: true }],
          dataLocBabelPlugin(relPath),
        ],
        sourceMaps: true,
      });

      if (!result?.code) return null;
      return { code: result.code, map: result.map };
    },
  };
}

function dataLocBabelPlugin(relPath: string) {
  return ({ types: t }: typeof babel): PluginObj => ({
    visitor: {
      JSXOpeningElement(nodePath: NodePath<JSXOpeningElement>) {
        const nameNode = nodePath.node.name;
        // Only host elements (lowercase tag names like "div"); components like <EventModal>
        // would receive data-loc as an unhandled prop.
        if (nameNode.type !== 'JSXIdentifier' || !/^[a-z]/.test(nameNode.name)) return;

        const hasDataLoc = nodePath.node.attributes.some(
          (attr): boolean => attr.type === 'JSXAttribute' && attr.name.name === 'data-loc',
        );
        if (hasDataLoc) return;

        const line = nodePath.node.loc?.start.line;
        if (!line) return;

        nodePath.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('data-loc'), t.stringLiteral(`${relPath}:${line}`)),
        );
      },
    },
  });
}
