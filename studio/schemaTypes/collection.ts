import {defineField, defineType} from 'sanity'

export const collection = defineType({
  name: 'collection',
  title: 'Collection',
  type: 'document',
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'title'}, validation: (r) => r.required()}),
    defineField({
      name: 'statement',
      type: 'text',
      rows: 4,
      description: 'The artist statement for the collection. The agent may quote it, never extend it.',
    }),
    defineField({
      name: 'namingRule',
      type: 'string',
      description: 'How pieces in this collection are titled.',
      options: {
        list: [
          {title: 'Hash fingerprint (#XXXXXX)', value: 'hash-fingerprint'},
          {title: 'Time of day (H:MM AM/PM)', value: 'time-of-day'},
          {title: 'Human title', value: 'human'},
        ],
      },
    }),
    defineField({name: 'isSample', type: 'boolean', initialValue: false}),
  ],
})
