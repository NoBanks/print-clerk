import {defineField, defineType} from 'sanity'

/** Append-only log of everything the agent and the human reviewer did. */
export const auditEvent = defineType({
  name: 'auditEvent',
  title: 'Audit event',
  type: 'document',
  readOnly: true,
  fields: [
    defineField({name: 'at', type: 'datetime'}),
    defineField({name: 'actor', type: 'string', description: 'agent, or human:<name>'}),
    defineField({name: 'action', type: 'string'}),
    defineField({name: 'subjectId', type: 'string'}),
    defineField({name: 'details', type: 'text', rows: 4}),
  ],
  preview: {select: {title: 'action', subtitle: 'at'}},
})
