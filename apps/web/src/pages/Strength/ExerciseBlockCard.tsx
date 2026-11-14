import type { ComponentChildren } from 'preact'

import { useState } from 'preact/hooks'

import type { RecordLines } from './records'

import { exerciseItemUrl } from './constants'
import { type ExerciseBlock, setLabel, type SetRow } from './sessionModel'
import { SetForm } from './SetForm'

export const ExerciseBlockCard = ({
  block,
  position,
  count,
  muscles,
  superset,
  info,
  records,
  timed,
  weightStep,
  onUpdateSet,
  onDeleteSet,
  onRemove,
  onMove,
  children,
}: {
  block: ExerciseBlock
  position: number
  count: number
  muscles?: string
  superset?: boolean
  info?: string[]
  records?: RecordLines
  timed: boolean
  weightStep: number
  onUpdateSet: (index: number, set: SetRow) => void
  onDeleteSet: (index: number) => void
  onRemove: () => void
  onMove: (delta: number) => void
  children?: ComponentChildren
}) => {
  const [editing, setEditing] = useState<number | undefined>()
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <section class="strength-card strength-block">
      <div class="strength-block-head">
        <div class="strength-block-title">
          <h2>
            <a href={exerciseItemUrl(block.exercise)}>{block.exercise}</a>
          </h2>
          {superset && <span class="strength-tag">Superset</span>}
        </div>
        <div class="strength-block-tools">
          <button
            type="button"
            class="strength-icon-btn"
            aria-label={`Move ${block.exercise} up`}
            disabled={position === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            class="strength-icon-btn"
            aria-label={`Move ${block.exercise} down`}
            disabled={position === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            class="strength-icon-btn"
            aria-label={`Remove ${block.exercise}`}
            onClick={() => setConfirmRemove(true)}
          >
            ✕
          </button>
        </div>
      </div>
      {confirmRemove && (
        <div class="strength-confirm" role="alert">
          <span>
            Remove {block.exercise}
            {block.sets.length > 0
              ? ` and its ${block.sets.length} ${block.sets.length === 1 ? 'set' : 'sets'}`
              : ''}
            ?
          </span>
          <div class="strength-row-actions">
            <button type="button" class="btn-danger" onClick={onRemove}>
              Remove
            </button>
            <button type="button" class="btn-secondary" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </div>
        </div>
      )}
      {muscles && <p class="strength-muted">{muscles}</p>}
      {info?.map((line) => (
        <p key={line} class="strength-muted">
          {line}
        </p>
      ))}
      {block.sets.length > 0 && (
        <ol class="strength-sets">
          {block.sets.map((set, i) => (
            <li key={i} class="strength-set">
              {editing === i ? (
                <SetForm
                  idPrefix={`${block.id}-edit-${i}`}
                  initial={set}
                  timed={timed}
                  submitLabel={`Save set ${i + 1}`}
                  weightStep={weightStep}
                  onSubmit={(next) => {
                    onUpdateSet(i, next)
                    setEditing(undefined)
                  }}
                  onCancel={() => setEditing(undefined)}
                  onDelete={() => {
                    onDeleteSet(i)
                    setEditing(undefined)
                  }}
                />
              ) : (
                <button
                  type="button"
                  class="strength-set-row"
                  onClick={() => setEditing(i)}
                  aria-label={`Set ${i + 1}, ${setLabel(set)}. Edit`}
                >
                  <span class="strength-set-number">{i + 1}</span>
                  <span class="strength-set-label">{setLabel(set)}</span>
                  {typeof set.note === 'string' && <span class="strength-set-note-text">{set.note}</span>}
                  <span class="strength-set-edit">Edit</span>
                </button>
              )}
              {records?.bySet.get(set)?.map((line) => (
                <p key={line} class="strength-record">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
      {records?.session.map((line) => (
        <p key={line} class="strength-record">
          {line}
        </p>
      ))}
      {block.planned.length > 0 && (
        <ul class="strength-planned">
          {block.planned.map((set, i) => (
            <li key={i}>planned: {setLabel(set)}</li>
          ))}
        </ul>
      )}
      {children}
    </section>
  )
}

export const CollapsedBlock = ({
  block,
  summary,
  superset,
  onSelect,
}: {
  block: ExerciseBlock
  summary: string
  superset?: boolean
  onSelect: () => void
}) => (
  <button type="button" class="strength-card strength-block-collapsed" onClick={onSelect}>
    <span class="strength-block-collapsed-name">
      {block.exercise}
      {superset && <span class="strength-tag">Superset</span>}
    </span>
    <span class="strength-muted">{summary}</span>
  </button>
)
