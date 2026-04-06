import { captureException } from './error_capture';

let installed = false;
let handler: ((event: Event) => void) | null = null;

export function installResourceErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  handler = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Only capture resource load failures (script, img, link, video, audio)
    const tagName = target.tagName?.toLowerCase();
    if (!tagName || !['script', 'img', 'link', 'video', 'audio', 'source', 'iframe'].includes(tagName)) return;

    const src = (target as HTMLScriptElement | HTMLImageElement).src
      || (target as HTMLLinkElement).href
      || '';

    if (!src) return;

    const error = new Error(`Failed to load ${tagName}: ${src}`);
    error.name = 'ResourceLoadError';

    captureException(error, {
      tags: {
        mechanism: 'resource_error',
        resource_type: tagName,
      },
      extra: {
        resource_url: src,
        element: formatElement(target),
      },
    });
  };

  // Use capture phase to catch errors that don't bubble
  window.addEventListener('error', handler, { capture: true });
}

function formatElement(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase() || '';
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? `.${el.className.trim().split(/\s+/).join('.')}`
    : '';
  return `<${tag}${id}${cls}>`;
}

export function uninstallResourceErrorCapture(): void {
  if (!installed || typeof window === 'undefined') return;
  installed = false;

  if (handler) {
    window.removeEventListener('error', handler, { capture: true });
    handler = null;
  }
}
