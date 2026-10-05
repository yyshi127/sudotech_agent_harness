/**
 * The markdown renderer's two mdast grammars, one per rendering arm. Each
 * arm is internally consistent — the incremental tail parses, the one-shot
 * parses, and the plain-text projection of a given grammar always agree on
 * where blocks start and end — and the settled grammar is the streaming one
 * plus the math extensions, so the arms differ only where TeX delimiters
 * begin a math construct (a `$$` block is a paragraph while streaming and a
 * math block once settled, by design).
 */

import type { Root, RootContent } from 'mdast'
import { recoverLocalImages } from './local-image-syntax.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { cjkFriendlyStrong } from './cjkFriendlyStrong.ts'
import { mathCompatibility } from './mathCompatibility.ts'

/**
 * Parse GFM markdown, keeping Chinese sentence punctuation outside bare links
 * (the streaming arm's grammar: no math, so incomplete TeX never flashes KaTeX errors mid-stream).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfm(text: string): Root {
  return recoverLocalImages(separateBareLinkPunctuation(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  }), text), text)
}

/**
 * Parse GFM markdown plus TeX math with the compatibility delimiters, keeping
 * Chinese sentence punctuation outside bare links (the settled arm's grammar).
 * @param text - Markdown source.
 * @returns The mdast root.
 */
export function parseGfmWithMath(text: string): Root {
  return recoverLocalImages(separateBareLinkPunctuation(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }), text), text)
}

/** Chinese prose punctuation ends bare links outside paired URL brackets; authored destinations stay intact. */
function separateBareLinkPunctuation(root: Root, source: string): Root {
  const openingBracket: Readonly<Record<string, string>> = {
    ')': '(', ']': '[', '}': '{', '）': '（', '】': '【', '》': '《', '」': '「', '』': '『',
  }
  const openings = new Set(Object.values(openingBracket))
  const visit = (node: Root | RootContent): void => {
    if (!('children' in node)) return
    const children: RootContent[] = node.children
    for (let index = 0; index < children.length; index++) {
      const child = children[index]
      if (child === undefined) continue
      const position = child.position
      if (child.type === 'link' && position?.start.offset !== undefined && position.end.offset !== undefined
        && child.children.length === 1 && child.children[0]?.type === 'text') {
        const literal = source.slice(position.start.offset, position.end.offset)
        if (/^(?:https?:\/\/|www\.)/iu.test(literal)
          && (child.url === literal || child.url === `http://${literal}`)) {
          let end = literal.length
          const stack: string[] = []
          for (let offset = 0; offset < literal.length; offset++) {
            const character = literal.charAt(offset)
            const opening = openingBracket[character]
            if (openings.has(character)) stack.push(character)
            else if (opening !== undefined && stack.at(-1) === opening) stack.pop()
            else if (/^[）】》」』]$/u.test(character) || (stack.length === 0 && /^[。，、：；！？]$/u.test(character))) {
              end = offset
              break
            }
          }
          while (end < literal.length && end > 0 && /[!"&'),.:;<>?\]}]/u.test(literal.charAt(end - 1))) {
            const character = literal.charAt(end - 1)
            const opening = openingBracket[character]
            if (opening !== undefined) {
              const prefix = literal.slice(0, end)
              if (prefix.split(character).length <= prefix.split(opening).length) break
            }
            end--
          }
          const suffix = literal.slice(end)
          if (suffix !== '') {
            const linkEnd = { ...position.end, offset: position.end.offset - suffix.length, column: position.end.column - suffix.length }
            child.url = child.url.slice(0, -suffix.length)
            child.children[0].value = literal.slice(0, end)
            if (child.children[0].position !== undefined) child.children[0].position.end = linkEnd
            child.position = { start: position.start, end: linkEnd }
            children.splice(++index, 0, { type: 'text', value: suffix, position: { start: linkEnd, end: position.end } })
          }
        }
      }
      visit(child)
    }
  }
  visit(root)
  return root
}
