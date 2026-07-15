import React, { useEffect, useRef, useState } from 'react';

// Dev-only overlay: hold Alt and hover to see which source line rendered an element
// (stamped at build time by vite-plugin-data-loc.ts as data-loc="file.tsx:line").
// Click while holding Alt to copy the reference for pasting into a debug chat.
export function DevInspector() {
  const [active, setActive] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [loc, setLoc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const altHeld = useRef(false);

  useEffect(() => {
    function clear() {
      altHeld.current = false;
      setActive(false);
      setRect(null);
      setLoc(null);
      setCopied(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Alt') altHeld.current = true;
      if (e.key === 'Escape') clear();
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Alt') clear();
    }

    function onMouseMove(e: MouseEvent) {
      if (!altHeld.current) return;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-loc]');
      if (!target) {
        setActive(false);
        setRect(null);
        setLoc(null);
        return;
      }
      setActive(true);
      setRect(target.getBoundingClientRect());
      setLoc(target.getAttribute('data-loc'));
      setCopied(false);
    }

    async function onClick(e: MouseEvent) {
      if (!altHeld.current) return;
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-loc]');
      if (!target) return;
      const value = target.getAttribute('data-loc');
      if (!value) return;
      e.preventDefault();
      e.stopPropagation();
      await navigator.clipboard.writeText(value);
      setCopied(true);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  if (!active || !rect || !loc) return null;

  return (
    <div className="dev-inspector" aria-hidden>
      <div
        className="dev-inspector__box"
        style={{
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        }}
      />
      <div
        className="dev-inspector__badge"
        style={{
          top: rect.bottom + window.scrollY + 4,
          left: rect.left + window.scrollX,
        }}
      >
        {copied ? 'copied ✓' : loc}
      </div>
    </div>
  );
}
