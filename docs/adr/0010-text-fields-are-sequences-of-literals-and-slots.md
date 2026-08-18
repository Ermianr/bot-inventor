# Text fields are sequences of literals and Slots

An Embed is mostly text with values inside it: `Usuario: @Khroost`, `Servidor: FASE REM`. Until now a Node's text field was either typed in or wired, never both — one field, one value, and the id shared between the field and its Port decided which won. That rule cannot write the sentence above without a Node whose only job is to glue two strings together, and the embed in front of us needs four of them.

The alternative we rejected was a template string: store `"Usuario: {{user}}"` and parse it when the Project is read. It needs no format change, and it costs the user an escaping rule — someone who types `{{` in a message breaks their bot, and the product exists so that nobody has to know that.

We decided instead that **the value of a text field is a sequence of segments**: literal text, and **Slots**. A Slot is a hole with an opaque id, and it declares a Data input Port on the Node that owns the field, so a value reaches it the same way every other value reaches a Node — along a Wire, through the Coercion table, drawn on the Canvas. The editor never shows the sequence: a field with Slots reads as one text box with pills inside it.

## Consequences

- `FieldValue` gains the sequence, `schemaVersion` goes up, and the migration ships with the backup step every Project format change ships with. Existing text fields migrate to a single literal segment.
- This is general, not the Embed's. Reply's `content` becomes a Slotted field too. The old rule — inline field unless a Wire is connected — goes away rather than living beside this one, because two ways to put a value into a text are two vocabularies for one idea.
- A Slot's id is generated when the Slot is inserted and stored in the segment. Deriving it from the Slot's position in the text would break a Wire every time the user typed a word in front of it.
- Slots are Ports, so they are `dynamicPorts` (ADR 0008) and everything that ADR says about a Port disappearing applies here: removing the last occurrence of a Slot removes its Port and the Wire drawn to it, as part of the same edit.
- A Slot may repeat, in the same field or in another field of the same Node. A Port already feeds however many places want it.
- Its Port is typed `text`, so `user`, `number` and `boolean` reach it through the Coercion table with the Coercion drawn on the Wire, as always.
