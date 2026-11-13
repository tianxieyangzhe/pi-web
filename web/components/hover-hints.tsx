'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Hint = { anchor: HTMLElement; text: string; x: number; y: number };
const attribute = 'data-hover-hint';

/** Adapt existing title text to one immediate, non-interactive hint layer. */
export function HoverHints() {
  const [hint, setHint] = useState<Hint | null>(null);
  const current = useRef<Hint | null>(null);
  useEffect(() => {
    const converted = new Set<HTMLElement>();
    const update = (next: Hint | null) => { current.current = next; setHint(next); };
    const convert = (element: Element) => {
      if (!(element instanceof HTMLElement) || element.tagName === 'IFRAME' || !element.hasAttribute('title')) return;
      element.setAttribute(attribute, element.getAttribute('title') ?? '');
      element.removeAttribute('title'); converted.add(element);
    };
    const scan = (root: Element) => { convert(root); root.querySelectorAll('[title]').forEach(convert); };
    scan(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') convert(record.target as Element);
        for (const node of record.addedNodes) if (node instanceof Element) scan(node);
        for (const node of record.removedNodes) if (node instanceof Element) {
          for (const element of converted) if (node === element || node.contains(element)) converted.delete(element);
        }
      }
      const active = current.current;
      if (active && (!active.anchor.isConnected || active.anchor.getAttribute(attribute) !== active.text)) update(null);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title', attribute] });
    const show = (event: PointerEvent | FocusEvent) => {
      if (event instanceof PointerEvent && event.pointerType === 'touch') return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLElement>(`[${attribute}]`);
      const text = anchor?.getAttribute(attribute)?.trim();
      if (!anchor || !text) { update(null); return; }
      if (anchor === current.current?.anchor && text === current.current.text) return;
      const rect = anchor.getBoundingClientRect();
      const button = anchor.tagName === 'BUTTON';
      update({ anchor, text, x: button ? rect.left : event instanceof PointerEvent ? event.clientX : rect.left, y: button ? rect.bottom : event instanceof PointerEvent ? event.clientY : rect.bottom });
    };
    const hide = () => update(null);
    const leave = (event: PointerEvent) => {
      if (!(event.relatedTarget instanceof Node) || !current.current?.anchor.contains(event.relatedTarget)) hide();
    };
    document.addEventListener('pointerover', show, true);
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('focusin', show, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      observer.disconnect();
      for (const element of converted) {
        if (!element.hasAttribute('title')) element.setAttribute('title', element.getAttribute(attribute) ?? '');
        element.removeAttribute(attribute);
      }
      document.removeEventListener('pointerover', show, true);
      document.removeEventListener('pointerout', leave, true);
      document.removeEventListener('focusin', show, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return hint ? createPortal(<HintBubble key={hint.text} hint={hint} />, document.body) : null;
}

function HintBubble({ hint }: { hint: Hint }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const previous = hint.anchor.getAttribute('aria-describedby');
    hint.anchor.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '));
    return () => {
      const descriptions = (hint.anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(value => value && value !== id);
      if (descriptions.length) hint.anchor.setAttribute('aria-describedby', descriptions.join(' '));
      else hint.anchor.removeAttribute('aria-describedby');
    };
  }, [hint.anchor, id]);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showPopover?.();
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(hint.x + 12, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, hint.y + 16 + rect.height > window.innerHeight - 8 ? hint.y - rect.height - 8 : hint.y + 16)}px`;
  }, [hint]);
  return <div ref={ref} id={id} popover="manual" role="tooltip" className="hover-hint">{hint.text}</div>;
}
