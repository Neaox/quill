import { GuidanceIcon, OptionalIcon, PlaceholderIcon, RepeatIcon } from '@quill/ui'
import type { IconProps } from '@quill/ui'
import type { ComponentType } from 'react'

import { containerDirective, insertBlock, paragraph } from '../slash-commands.ts'
import { commandItem } from '../slash-item.ts'
import type { SlashContribution } from '../slash-item.ts'

/**
 * Templates (ADR-029): the authoring blocks a template is written with. Each
 * opens with a prompt in it, selected, so the author types straight over it.
 */

interface TemplateBlock {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly attributes: Readonly<Record<string, string>>
  readonly prompt: string
  readonly icon: ComponentType<IconProps>
}

const TEMPLATE_BLOCKS: readonly TemplateBlock[] = [
  {
    name: 'placeholder',
    label: 'Placeholder',
    description: 'A prompt the author replaces; never published',
    attributes: {},
    prompt: 'Say what belongs here',
    icon: PlaceholderIcon,
  },
  {
    name: 'guidance',
    label: 'Guidance',
    description: 'Advice to the author; removed at publish',
    attributes: {},
    prompt: 'Explain how to fill this section in',
    icon: GuidanceIcon,
  },
  {
    name: 'optional',
    label: 'Optional section',
    description: 'A section offered to the author, published only once added',
    attributes: { title: 'Optional section' },
    prompt: 'What this section is for',
    icon: OptionalIcon,
  },
  {
    name: 'repeat',
    label: 'Repeating section',
    description: 'A section the author may add again',
    attributes: { title: 'Another item' },
    prompt: 'What one item looks like',
    icon: RepeatIcon,
  },
]

export const templateItems: SlashContribution = {
  id: 'core.templates',
  items: () =>
    TEMPLATE_BLOCKS.map(({ name, label, description, attributes, prompt, icon }) =>
      commandItem(
        {
          id: `template-${name}`,
          label,
          description,
          group: 'Templates',
          keywords: ['template', name],
          icon,
        },
        insertBlock(
          containerDirective(name, attributes, (schema) => [paragraph(schema, prompt)]),
          { selectText: true },
        ),
      ),
    ),
}
