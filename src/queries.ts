/**
 * GROQ used by the agent. Context MCP's groq_query tool takes a single query
 * string (no separate params), so values are inlined through groqString(),
 * which emits a JSON string literal. GROQ string literals share JSON's escaping.
 */

export function groqString(value: string): string {
  return JSON.stringify(value)
}

export const ARTWORK_PROJECTION = `{
  _id,
  title,
  "slug": slug.current,
  catalogCode,
  medium,
  story,
  altText,
  tags,
  isSample,
  "collection": collection->{_id, title, statement, namingRule},
  "formats": formats[]{label, widthIn, heightIn, framed, priceUsd, status}
}`

export function artworkBySlug(slug: string): string {
  return `*[_type == "artwork" && slug.current == ${groqString(slug)}][0]${ARTWORK_PROJECTION}`
}

export function artworkById(id: string): string {
  return `*[_type == "artwork" && _id == ${groqString(id)}][0]${ARTWORK_PROJECTION}`
}

export const COLLECTION_TITLES = `*[_type == "collection"].title`

export const CATALOG_INDEX = `*[_type == "artwork"] | order(collection->title asc, title asc){
  _id, title, "slug": slug.current, "collection": collection->title,
  "formats": formats[]{label, priceUsd, status}
}`
