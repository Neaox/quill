/**
 * An emoji's name said as words: what is read out for one nobody has described
 * (`globex_logo` is "globex logo"). Its own module, so the settings screen can
 * show the same words the renderer will use without taking the renderer with it.
 */
export function nameAsWords(name: string): string {
  return name.replaceAll(/[_-]+/gu, ' ')
}
