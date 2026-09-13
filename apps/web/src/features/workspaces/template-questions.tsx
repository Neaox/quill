import { Input, tv } from '@quill/ui'

import type {
  TemplateDeclaration,
  TemplateQuestion,
} from '../../lib/documents/template-declaration.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'

export const templateQuestionsStyles = tv({
  slots: {
    root: 'flex flex-col gap-4 border-t border-border pt-4',
    heading: 'meta',
    checkbox: 'flex items-start gap-2.5',
    box: [
      'mt-0.5 size-4 shrink-0 rounded-sm border border-border-strong bg-surface-raised',
      'accent-accent focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring',
    ],
    checkboxText: 'flex flex-col gap-0.5',
    label: 'text-xs font-medium text-foreground',
    help: 'text-2xs leading-normal text-muted',
  },
})

export type TemplateAnswers = Readonly<Record<string, string | boolean>>

export interface TemplateQuestionsProps {
  readonly declaration: TemplateDeclaration
  readonly answers: TemplateAnswers
  readonly onChange: (id: string, answer: string | boolean) => void
}

function BooleanQuestion({
  question,
  checked,
  onChange,
}: {
  readonly question: TemplateQuestion
  readonly checked: boolean
  readonly onChange: (answer: boolean) => void
}) {
  const styles = templateQuestionsStyles()

  return (
    <label className={styles.checkbox()}>
      <input
        type="checkbox"
        checked={checked}
        className={styles.box()}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span className={styles.checkboxText()}>
        <span className={styles.label()}>{question.label}</span>
        {question.help === undefined ? undefined : (
          <span className={styles.help()}>{question.help}</span>
        )}
      </span>
    </label>
  )
}

/**
 * A template's questions, as a form.
 *
 * ADR-029's types map onto the controls a browser already has, because a
 * question with a native control is a question a keyboard, a screen reader,
 * and a password manager all already understand. `document` and `user` are
 * asked for as text until there is something to pick from.
 */
export function TemplateQuestions({ declaration, answers, onChange }: TemplateQuestionsProps) {
  if (declaration.questions.length === 0) return undefined

  const styles = templateQuestionsStyles()

  return (
    <fieldset className={styles.root()}>
      <legend className={styles.heading()}>{declaration.name ?? 'Template'}</legend>

      {declaration.questions.map((question) => {
        const answer = answers[question.id]

        if (question.type === 'boolean') {
          return (
            <BooleanQuestion
              key={question.id}
              question={question}
              checked={answer === true}
              onChange={(next) => {
                onChange(question.id, next)
              }}
            />
          )
        }

        if (question.type === 'choice') {
          return (
            <SelectField
              key={question.id}
              label={question.label}
              {...(question.help === undefined ? {} : { description: question.help })}
              value={typeof answer === 'string' ? answer : ''}
              onChange={(event) => {
                onChange(question.id, event.target.value)
              }}
            >
              {question.optional ? <option value="">No answer</option> : undefined}
              {question.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          )
        }

        return (
          <Input
            key={question.id}
            label={question.label}
            type={question.type === 'date' ? 'date' : 'text'}
            {...(question.help === undefined ? {} : { description: question.help })}
            value={typeof answer === 'string' ? answer : ''}
            onChange={(event) => {
              onChange(question.id, event.target.value)
            }}
          />
        )
      })}
    </fieldset>
  )
}
