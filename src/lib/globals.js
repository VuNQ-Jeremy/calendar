// src/lib/globals.js — bridges the browser globals set up in index.html
// (React/ReactDOM UMD + the Mochi Design System bundle) into the ES module graph.
//
// index.html loads those as classic scripts, which execute before this deferred
// module runs, so the globals are guaranteed to be present here. Consuming the DS
// this way keeps a single React instance shared between the app and the DS
// components (their hooks/elements must come from the same React).

export const React = window.React;
export const ReactDOM = window.ReactDOM;

if (!React) {
  throw new Error('React global is missing — check the UMD <script> tags in index.html.');
}

export const DS = window.MochiDesignSystem_472b36;

if (!DS) {
  throw new Error('Mochi Design System bundle did not load — check _ds_bundle.js in index.html.');
}
