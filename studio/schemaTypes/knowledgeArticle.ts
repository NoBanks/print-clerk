import {defineField, defineType} from 'sanity'

/** Prose the Knowledge Base is built from: policies, care notes, collection rules. */
export const knowledgeArticle = defineType({
  name: 'knowledgeArticle',
  title: 'Knowledge article',
  type: 'document',
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'title'}, validation: (r) => r.required()}),
    defineField({
      name: 'topic',
      type: 'string',
      options: {list: ['policy', 'care', 'collection-story', 'process']},
    }),
    defineField({name: 'body', type: 'text', rows: 8, validation: (r) => r.required()}),
    defineField({name: 'isSample', type: 'boolean', initialValue: false}),
  ],
})
