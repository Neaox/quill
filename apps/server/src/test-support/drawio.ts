/**
 * A `.drawio.svg` whose label says which drawing it is, so each one is its own
 * object (ADR-043): the label is in the model draw.io embeds and in the
 * picture, which is what search reads and what a reader sees.
 */
export function aDrawioSvg(label: string): Buffer {
  const model = `&lt;mxfile&gt;&lt;diagram id=&quot;p&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;a&quot; value=&quot;${label}&quot; vertex=&quot;1&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" content="${model}"><text>${label}</text></svg>`,
  )
}
