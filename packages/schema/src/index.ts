export { toSlottedText } from "./migrate-to-slotted-text.js"
export {
  type Migration,
  MigrationChainError,
  migrations,
  readSchemaVersion,
  runMigrationChain
} from "./migrations.js"
export {
  formatProjectIssues,
  type OpenProjectOptions,
  type OpenProjectResult,
  openProject
} from "./open-project.js"
export {
  CURRENT_SCHEMA_VERSION,
  type FieldValue,
  type Flow,
  fieldValueSchema,
  flowSchema,
  type Node,
  nodeSchema,
  type PortReference,
  type Position,
  type Project,
  portReferenceSchema,
  positionSchema,
  projectSchema,
  projectSchemaForVersion,
  type Wire,
  type WireKind,
  wireSchema
} from "./project.js"
export {
  type LiteralSegment,
  literalSegmentSchema,
  literalText,
  readSlottedText,
  type SlotSegment,
  type SlottedText,
  slotIdsOf,
  slotSegmentSchema,
  slottedTextSchema,
  type TextSegment,
  textSegmentSchema
} from "./slotted-text.js"
export type { ValidationIssue, Validator } from "./validator.js"
