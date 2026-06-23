// templates/mochi-app/ds-base.js
// Loads the Mochi design system (styles + compiled component bundle) for this template.
(() => {
  const base = '_ds/mochi-design-system-472b365a-31b5-44c2-8b48-4d5ab7945e52';
  // Preconnect + load the webfonts directly so first paint (and screenshot/PDF/PPTX
  // capture) renders Fredoka/Nunito Sans/DM Mono immediately, instead of waiting on the
  // nested @import chain inside styles.css. styles.css still ships the @import for consumers.
  const pre1 = document.createElement('link'); pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com'; document.head.appendChild(pre1);
  const pre2 = document.createElement('link'); pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous'; document.head.appendChild(pre2);
  const font = document.createElement('link'); font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,500;0,6..12,600;0,6..12,700;0,6..12,800;1,6..12,400&family=DM+Mono:wght@400;500&display=swap';
  document.head.appendChild(font);
  for (const p of ['styles.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = base + '/' + p;
    document.head.appendChild(l);
  }
  const s = document.createElement('script');
  s.src = base + '/_ds_bundle.js';
  s.onerror = () => console.error('ds-base.js: failed to load ' + s.src + ' — if this is a consuming project, point the base line at the bound _ds/<folder> tree relative to this page (e.g. _ds/<folder> at the project root, ../_ds/<folder> one level down); in a fresh design system this can just mean the bundle is not compiled yet');
  document.head.appendChild(s);
})();
