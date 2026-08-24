/** Bounded semantic DOM scanning shared by the managed Edge route. */

import type { ElementHandle, Frame, Page } from 'playwright-core'
import type { BrowserStepAction, BrowserTarget } from './types.ts'

/** Stable semantic identity used to relocate a control after framework re-rendering. */
export interface SemanticTargetDescriptor {
  readonly role: string
  readonly name: string
  readonly context: string
  readonly inputType: string
  readonly ordinal: number
}

/** One scanned control and the frame that owns it. */
export interface ScannedSemanticTarget {
  readonly frame: Frame
  readonly descriptor: SemanticTargetDescriptor
  readonly target: Omit<BrowserTarget, 'id'>
}

/** One complete bounded page scan. */
export interface SemanticPageScan {
  readonly text: string
  readonly targets: ScannedSemanticTarget[]
  readonly truncated: boolean
}

interface FrameProjection {
  readonly role: string
  readonly name: string
  readonly context: string
  readonly value?: string
  readonly disabled: boolean
  readonly checked?: boolean
  readonly inputType: string
  readonly actions: BrowserStepAction[]
  readonly ordinal: number
}

interface FrameScanResult {
  readonly text: string
  readonly targets: FrameProjection[]
  readonly targetCount: number
  readonly textLength: number
}

type FrameCommand =
  | { readonly kind: 'scan'; readonly maxTargets: number; readonly maxTextChars: number }
  | { readonly kind: 'resolve'; readonly descriptor: SemanticTargetDescriptor }
  | { readonly kind: 'resolve-semantic'; readonly role?: string; readonly name?: string; readonly context?: string }

/* A string expression avoids transpiler-injected helpers such as `__name` when this package runs directly through tsx.
   The command is JSON-encoded by the Host, and the expression exposes no model-provided JavaScript or selector. */
const SEMANTIC_FRAME_EXPRESSION = String.raw`(() => {
  const command = __DSH_COMMAND__;
  const normalize = (value, limit) => (value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
  const visible = (element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && bounds.width > 0 && bounds.height > 0;
  };
  const pointerControl = (element) => {
    const tag = element.tagName.toLowerCase();
    if (!['div', 'span', 'li'].includes(tag)) return false;
    const text = normalize(element.innerText || element.textContent, 161);
    if (!text || text.length > 160 || getComputedStyle(element).cursor !== 'pointer') return false;
    const parent = element.parentElement;
    return !parent || getComputedStyle(parent).cursor !== 'pointer'
      || normalize(parent.innerText || parent.textContent, 161) !== text;
  };
  const roleOf = (element) => {
    const explicit = normalize(element.getAttribute('role'), 40);
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag !== 'input') return pointerControl(element) ? 'button' : tag;
    const type = element.type.toLowerCase();
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
    if (type === 'file') return 'file';
    return 'textbox';
  };
  const nameOf = (element) => {
    let labelled = '';
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/u)) labelled += ' ' + (element.ownerDocument.getElementById(id)?.textContent || '');
    }
    const labels = 'labels' in element && element.labels
      ? [...element.labels].map(label => label.textContent || '').join(' ')
      : '';
    const candidates = [
      element.getAttribute('aria-label'), labelled, labels, element.getAttribute('alt'),
      element.getAttribute('title'), element.getAttribute('placeholder'), element.innerText, element.textContent,
    ];
    for (const candidate of candidates) {
      const value = normalize(candidate, 160);
      if (value) return value;
    }
    return '';
  };
  const contextOf = (element) => {
    const parts = [];
    const containers = [
      ['dialog', element.closest('dialog,[role="dialog"],[role="alertdialog"]')],
      ['row', element.closest('tr,[role="row"]')],
      ['form', element.closest('form')],
      ['region', element.closest('section,[role="region"],[role="group"]')],
    ];
    const seen = new Set();
    for (const [kind, container] of containers) {
      if (!container || seen.has(container)) continue;
      seen.add(container);
      const heading = container.querySelector('h1,h2,h3,h4,h5,h6,legend,[aria-label]');
      const text = normalize(
        container.getAttribute('aria-label') || heading?.getAttribute('aria-label') || heading?.textContent || container.textContent,
        kind === 'row' ? 120 : 80,
      );
      if (text) parts.push(kind + ': ' + text);
    }
    return parts.join(' | ').slice(0, 240);
  };
  const interactive = (element) => {
    const tag = element.tagName.toLowerCase();
    const role = normalize(element.getAttribute('role'), 40);
    if (tag === 'button' || tag === 'textarea' || tag === 'select' || tag === 'input') return true;
    if (tag === 'a' && element.hasAttribute('href')) return true;
    if (element.isContentEditable) return true;
    return ['button', 'link', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'option', 'switch'].includes(role)
      || pointerControl(element);
  };
  const project = (element) => {
    if (!interactive(element) || !visible(element)) return undefined;
    const inputType = element instanceof HTMLInputElement ? element.type.toLowerCase() : '';
    const actions = [];
    if (inputType !== 'file') actions.push('click', 'hover');
    const excludedFill = new Set([
      'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'password', 'radio', 'range', 'reset', 'submit',
    ]);
    if ((element instanceof HTMLInputElement && !excludedFill.has(inputType))
      || element instanceof HTMLTextAreaElement || element.isContentEditable) actions.push('fill', 'type');
    if (element instanceof HTMLSelectElement) actions.push('select');
    if (inputType === 'checkbox') actions.push('check', 'uncheck');
    if (inputType === 'radio') actions.push('check');
    if (inputType === 'file') actions.push('upload');
    const rawValue = inputType === 'password' ? undefined
      : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? normalize(element.value, 160)
        : undefined;
    const checked = inputType === 'checkbox' || inputType === 'radio' ? Boolean(element.checked) : undefined;
    return {
      role: roleOf(element), name: nameOf(element), context: contextOf(element),
      ...(rawValue ? { value: rawValue } : {}),
      disabled: 'disabled' in element && Boolean(element.disabled),
      ...(checked === undefined ? {} : { checked }), inputType, actions,
    };
  };
  const elements = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      if (interactive(element)) elements.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  const projections = [];
  const ordinals = new Map();
  for (const element of elements) {
    const projected = project(element);
    if (!projected) continue;
    const key = JSON.stringify([projected.role, projected.name, projected.context, projected.inputType]);
    const ordinal = ordinals.get(key) || 0;
    ordinals.set(key, ordinal + 1);
    projections.push({ element, projection: { ...projected, ordinal } });
  }
  if (command.kind === 'resolve') {
    return projections.find(({ projection }) => projection.role === command.descriptor.role
      && projection.name === command.descriptor.name && projection.context === command.descriptor.context
      && projection.inputType === command.descriptor.inputType && projection.ordinal === command.descriptor.ordinal)?.element || null;
  }
  if (command.kind === 'resolve-semantic') {
    const matches = projections.filter(({ projection }) =>
      (command.role === undefined || projection.role === command.role)
      && (command.name === undefined || projection.name === command.name)
      && (command.context === undefined || projection.context === command.context));
    return matches.length === 1 ? matches[0].element : null;
  }
  const rawText = document.body?.innerText || '';
  return {
    text: rawText.replace(/\r\n?/gu, '\n').slice(0, command.maxTextChars),
    targets: projections.slice(0, command.maxTargets).map(row => row.projection),
    targetCount: projections.length,
    textLength: rawText.length,
  };
})()`

function semanticExpression(command: FrameCommand): string {
  return SEMANTIC_FRAME_EXPRESSION.replace('__DSH_COMMAND__', () => JSON.stringify(command))
}

/**
 * Scan each live frame once, including open Shadow DOM roots inside that frame.
 * @param page - Managed Edge page to inspect.
 * @param maxTargets - Maximum semantic controls to retain.
 * @param maxTextChars - Maximum visible text characters to retain.
 * @returns Bounded page text, semantic controls, and truncation state.
 */
export async function scanSemanticPage(page: Page, maxTargets: number, maxTextChars: number): Promise<SemanticPageScan> {
  const targets: ScannedSemanticTarget[] = []
  const text: string[] = []
  let textUsed = 0
  let totalTargets = 0
  let totalText = 0
  const frames = page.frames().filter(frame => !frame.isDetached())
  let scannedFrames = 0
  for (const frame of frames) {
    scannedFrames += 1
    const command: FrameCommand = {
      kind: 'scan', maxTargets: Math.max(0, maxTargets - targets.length), maxTextChars: Math.max(0, maxTextChars - textUsed),
    }
    let scanned: FrameScanResult
    try {
      scanned = await frame.evaluate<FrameScanResult>(semanticExpression(command))
    } catch (error) {
      if (frame === page.mainFrame()) {
        throw new Error(`browser semantic scan failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    totalTargets += scanned.targetCount
    totalText += scanned.textLength
    if (scanned.text !== '') {
      text.push(scanned.text)
      textUsed += scanned.text.length + 1
    }
    for (const projection of scanned.targets) {
      targets.push({
        frame,
        descriptor: {
          role: projection.role, name: projection.name, context: projection.context,
          inputType: projection.inputType, ordinal: projection.ordinal,
        },
        target: {
          role: projection.role,
          name: projection.name,
          ...(projection.context === '' ? {} : { context: projection.context }),
          ...(projection.value === undefined ? {} : { value: projection.value }),
          disabled: projection.disabled,
          ...(projection.checked === undefined ? {} : { checked: projection.checked }),
          actions: projection.actions,
        },
      })
    }
    if (targets.length >= maxTargets && textUsed >= maxTextChars) break
  }
  return {
    text: text.join('\n').slice(0, maxTextChars),
    targets,
    truncated: scannedFrames < frames.length || totalTargets > maxTargets || totalText > maxTextChars,
  }
}

/**
 * Relocate an observed target by semantic identity and context.
 * @param frame - Original live frame.
 * @param descriptor - Semantic identity captured by the prior observation.
 * @returns The uniquely matching live element.
 */
export async function resolveObservedElement(
  frame: Frame,
  descriptor: SemanticTargetDescriptor,
): Promise<ElementHandle<HTMLElement>> {
  if (frame.isDetached()) throw new Error('browser target frame changed after it was observed; observe again')
  const command: FrameCommand = { kind: 'resolve', descriptor }
  const handle = await frame.evaluateHandle<HTMLElement | null>(semanticExpression(command))
  const element = handle.asElement()
  if (element !== null) return element
  await handle.dispose()
  throw new Error('browser target changed after it was observed; observe again')
}

/**
 * Resolve one newly revealed control by an exact semantic target.
 * @param frame - Live frame to search.
 * @param target - Exact role, name, and context constraints.
 * @returns The uniquely matching element, or undefined when absent or ambiguous.
 */
export async function resolveSemanticElement(
  frame: Frame,
  target: { readonly role?: string; readonly name?: string; readonly context?: string },
): Promise<ElementHandle<HTMLElement> | undefined> {
  const command: FrameCommand = { kind: 'resolve-semantic', ...target }
  const handle = await frame.evaluateHandle<HTMLElement | null>(semanticExpression(command))
  const element = handle.asElement()
  if (element !== null) return element
  await handle.dispose()
  return undefined
}
