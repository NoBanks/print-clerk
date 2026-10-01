import {defineArrayMember, defineField, defineType} from 'sanity'

/**
 * One piece of art. Price and availability live on each format, never on the
 * artwork, because a price is only true for one size. Quoting the price of one
 * size for another size is the mistake this schema is shaped to prevent.
 */
export const artwork = defineType({
  name: 'artwork',
  title: 'Artwork',
  type: 'document',
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'title'}, validation: (r) => r.required()}),
    defineField({name: 'catalogCode', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'collection',
      type: 'reference',
      to: [{type: 'collection'}],
      validation: (r) => r.required(),
    }),
    defineField({name: 'image', type: 'image', options: {hotspot: true}}),
    defineField({name: 'medium', type: 'string'}),
    defineField({
      name: 'formats',
      title: 'Sizes and prices',
      type: 'array',
      validation: (r) => r.required().min(1),
      of: [
        defineArrayMember({
          name: 'format',
          type: 'object',
          fields: [
            defineField({name: 'label', type: 'string', validation: (r) => r.required()}),
            defineField({name: 'widthIn', title: 'Width (in)', type: 'number', validation: (r) => r.required().positive()}),
            defineField({name: 'heightIn', title: 'Height (in)', type: 'number', validation: (r) => r.required().positive()}),
            defineField({name: 'framed', type: 'boolean', initialValue: true}),
            defineField({name: 'priceUsd', title: 'Price (USD)', type: 'number', validation: (r) => r.required().min(0)}),
            defineField({
              name: 'status',
              type: 'string',
              initialValue: 'available',
              options: {list: ['available', 'on_hold', 'sold', 'retired']},
              validation: (r) => r.required(),
            }),
          ],
          preview: {select: {title: 'label', price: 'priceUsd', status: 'status'},
            prepare: ({title, price, status}) => ({title, subtitle: `$${price} - ${status}`})},
        }),
      ],
    }),
    defineField({name: 'story', type: 'text', rows: 4, description: 'Only what is true about this piece.'}),
    defineField({
      name: 'altText',
      type: 'string',
      description: 'Literal description of the image for screen readers.',
      validation: (r) => r.required().max(250),
    }),
    defineField({name: 'tags', type: 'array', of: [defineArrayMember({type: 'string'})], options: {layout: 'tags'}}),
    defineField({name: 'isSample', type: 'boolean', initialValue: false}),
  ],
  preview: {select: {title: 'title', subtitle: 'collection.title', media: 'image'}},
})
