/** A `.drawio.svg` whose label says which revision it is, so each is its own object. */
export function drawioFixture(label: string): Buffer {
  const model = `&lt;mxfile&gt;&lt;diagram id=&quot;p&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;a&quot; value=&quot;${label}&quot; vertex=&quot;1&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" content="${model}"><text>${label}</text></svg>`,
  )
}
