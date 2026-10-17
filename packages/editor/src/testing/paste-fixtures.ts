/**
 * The clipboards of the editor's paste budget (quill-plan.md section 31).
 *
 * Three shapes a writer really pastes at size: a Markdown file, a document
 * copied out of Google Docs or Word, and a long plain-text log or email. The
 * HTML is generated in the shape those applications put on the clipboard —
 * Docs' `b[font-weight:normal]` wrapper and styled spans, Word's `Mso`
 * classes, `mso-list` paragraphs and `o:p` noise — with headings, lists,
 * tables, images and a code block in every section, so a measurement against
 * it exercises every node view a large paste mounts.
 */

/** Sections in each HTML clipboard: one code block each, an image in every fourth. */
export const RICH_PASTE_SECTIONS = 120

/** Lines in the plain-text clipboard. */
export const PLAIN_PASTE_LINES = 10_000

const IMAGE = 'https://example.com/diagram.png'

function codeLine(index: number): string {
  return `export const rotate${String(index)} = (keys) =&gt; [...keys.slice(1), crypto.randomUUID()]`
}

function span(text: string, style = 'font-size:11pt;font-family:Arial'): string {
  return `<span style="${style};color:#000000;background-color:transparent;font-weight:400">${text}</span>`
}

function listItem(text: string, level: number, position: 'First' | 'Middle' | 'Last'): string {
  return `<p class=MsoListParagraphCxSp${position} style='margin-left:${String(36 * level)}pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level${String(level)} lfo1'><![if !supportLists]><span style='font-family:Symbol'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>${text}<o:p></o:p></p>`
}

function cell(text: string): string {
  return `<td width=200 valign=top style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal>${text}<o:p></o:p></p></td>`
}

function docsSection(index: number): string {
  const n = String(index + 1)
  return [
    `<h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt">${span(`Section ${n}: rotating the signing keys`, 'font-size:16pt;font-family:Arial')}</h2>`,
    `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt">${span('Every ')}<span style="font-weight:700">request</span>${span(` in section ${n} carries a `)}<span style="font-style:italic">short-lived</span>${span(' token, checked by the ')}<a href="https://example.com/gateway/${n}" style="text-decoration:none">${span('gateway', 'color:#1155cc;text-decoration:underline')}</a>.</p>`,
    '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px">',
    `<li dir="ltr" style="list-style-type:disc" aria-level="1"><p dir="ltr" role="presentation">${span('Issue a new key')}</p></li>`,
    '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px">',
    `<li dir="ltr" style="list-style-type:circle" aria-level="2"><p dir="ltr" role="presentation">${span('Publish it to the key set')}</p></li>`,
    '</ul>',
    `<li dir="ltr" style="list-style-type:disc" aria-level="1"><p dir="ltr" role="presentation">${span('Retire the old key')}</p></li>`,
    '</ul>',
    '<div dir="ltr" style="margin-left:0pt" align="left"><table style="border:none;border-collapse:collapse"><colgroup><col width="200"><col width="200"><col width="200"></colgroup><tbody>',
    `<tr style="height:0pt"><td style="border:solid #000000 1pt"><p dir="ltr">${span('Step')}</p></td><td style="border:solid #000000 1pt"><p dir="ltr">${span('Owner')}</p></td><td style="border:solid #000000 1pt"><p dir="ltr">${span('Window')}</p></td></tr>`,
    `<tr style="height:0pt"><td style="border:solid #000000 1pt"><p dir="ltr">${span('Issue')}</p></td><td style="border:solid #000000 1pt"><p dir="ltr">${span('Platform')}</p></td><td style="border:solid #000000 1pt"><p dir="ltr">${span(`${n} min`)}</p></td></tr>`,
    '</tbody></table></div>',
    `<pre><code>${codeLine(index)}</code></pre>`,
    ...(index % 4 === 0
      ? [
          `<p dir="ltr">${span(`<img src="${IMAGE}" width="602" height="339" alt="Diagram ${n}">`)}</p>`,
        ]
      : []),
  ].join('')
}

/** A long document as Google Docs puts it on the clipboard. */
export function googleDocsHtml(sections: number = RICH_PASTE_SECTIONS): string {
  return [
    '<meta charset="utf-8">',
    '<b style="font-weight:normal;" id="docs-internal-guid-6f1c2a3b-7fff-4d2e-9c11-0a1b2c3d4e5f">',
    `<h1 dir="ltr"><span style="font-size:20pt;font-family:Arial">Key rotation runbook</span></h1>`,
    ...Array.from({ length: sections }, (_, index) => docsSection(index)),
    '</b>',
  ].join('')
}

function wordSection(index: number): string {
  const n = String(index + 1)
  return [
    `<h2>Section ${n}: rotating the signing keys<o:p></o:p></h2>`,
    `<p class=MsoNormal>Every <b>request</b> in section ${n} carries a <i>short-lived</i> token, checked by the <a href="https://example.com/gateway/${n}">gateway</a>.<o:p></o:p></p>`,
    listItem('Issue a new key', 1, 'First'),
    listItem('Publish it to the key set', 2, 'Middle'),
    listItem('Retire the old key', 1, 'Last'),
    `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;mso-yfti-tbllook:1184'>`,
    `<tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>${cell('Step')}${cell('Owner')}${cell('Window')}</tr>`,
    `<tr style='mso-yfti-irow:1;mso-yfti-lastrow:yes'>${cell('Issue')}${cell('Platform')}${cell(`${n} min`)}</tr>`,
    '</table>',
    `<pre style='font-family:Consolas'>${codeLine(index)}<o:p></o:p></pre>`,
    ...(index % 4 === 0
      ? [
          `<p class=MsoNormal><img width=602 height=339 src="${IMAGE}" alt="Diagram ${n}" v:shapes="Picture_${n}"><o:p></o:p></p>`,
        ]
      : []),
  ].join('\n')
}

/** A long document as Word puts it on the clipboard. */
export function wordHtml(sections: number = RICH_PASTE_SECTIONS): string {
  return [
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style><!-- p.MsoNormal {margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;} --></style></head><body lang=EN-NZ style='tab-interval:36.0pt'><!--StartFragment-->`,
    '<h1>Key rotation runbook<o:p></o:p></h1>',
    ...Array.from({ length: sections }, (_, index) => wordSection(index)),
    '<!--EndFragment--></body></html>',
  ].join('\n')
}

/**
 * Plain text of `lines` lines: wrapped paragraphs of four lines with a blank
 * line between them, as an email or a log excerpt reads.
 */
export function plainText(lines: number = PLAIN_PASTE_LINES): string {
  return Array.from({ length: lines }, (_, index) =>
    index % 5 === 4 ? '' : `Line ${String(index + 1)} of the incident log, written as it happened.`,
  ).join('\n')
}
