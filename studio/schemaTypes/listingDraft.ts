import {defineArrayMember, defineField, defineType} from 'sanity'

/** Written by the agent, decided by a human. The agent can never set status to approved. */
export const listingDraft = defineType({
  name: 'listingDraft',
  title: 'Listing draft',
  type: 'document',
  fields: [
    defineField({name: 'artwork', type: 'reference', to: [{type: 'artwork'}], validation: (r) => r.required()}),
    defineField({
      name: 'channel',
      type: 'string',
      options: {list: ['marketplace', 'instagram', 'x', 'newsletter']},
      validation: (r) => r.required(),
    }),
    defineField({name: 'title', type: 'string'}),
    defineField({name: 'body', type: 'text', rows: 10}),
    defineField({
      name: 'status',
      type: 'string',
      options: {list: ['needs_review', 'blocked', 'approved', 'rejected']},
      initialValue: 'needs_review',
    }),
    defineField({
      name: 'verification',
      type: 'object',
      fields: [
        defineField({name: 'ok', type: 'boolean'}),
        defineField({name: 'issues', type: 'array', of: [defineArrayMember({type: 'string'})]}),
        defineField({name: 'factsHash', type: 'string', description: 'Hash of the catalog facts the draft was checked against.'}),
      ],
    }),
    defineField({name: 'sourceDocIds', type: 'array', of: [defineArrayMember({type: 'string'})]}),
    defineField({name: 'model', type: 'string'}),
    defineField({name: 'createdAt', type: 'datetime'}),
    defineField({name: 'reviewedAt', type: 'datetime'}),
    defineField({name: 'reviewer', type: 'string'}),
    defineField({name: 'reviewNote', type: 'text', rows: 2}),
  ],
  preview: {select: {title: 'title', subtitle: 'status'}},
})
