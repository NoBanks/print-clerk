import {defineArrayMember, defineField, defineType} from 'sanity'

/** A buyer question and what the agent answered, or why it escalated to a human. */
export const inquiry = defineType({
  name: 'inquiry',
  title: 'Buyer inquiry',
  type: 'document',
  fields: [
    defineField({name: 'question', type: 'text', rows: 3}),
    defineField({name: 'answer', type: 'text', rows: 6, description: 'What the buyer was sent.'}),
    defineField({name: 'modelAnswer', type: 'text', rows: 6, description: 'What the model wrote, kept even when it was held back.'}),
    defineField({name: 'status', type: 'string', options: {list: ['answered', 'escalated']}}),
    defineField({name: 'issues', type: 'array', of: [defineArrayMember({type: 'string'})]}),
    defineField({name: 'sourceDocIds', type: 'array', of: [defineArrayMember({type: 'string'})]}),
    defineField({name: 'createdAt', type: 'datetime'}),
  ],
})
