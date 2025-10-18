import format from "pg-format"
import { query, tableExists } from "../db"
import { ouraClient } from "../oura"
import { addHours, isAfter, isBefore, subHours } from "date-fns"

export type Tag = {
  id: string
  tag: string
  startTime: Date
  endTime: Date
  source: 'oura'
}

export const getTags = async (user: string, start: Date, end: Date, oura: ReturnType<typeof ouraClient>) => {
  if (!(await tableExists(user, 'tags'))) {
    await query(
      user,
      `CREATE TABLE tags (
          id        VARCHAR PRIMARY KEY,
          tag       VARCHAR,
          "startTime" TIMESTAMPTZ NOT NULL,
          "endTime"   TIMESTAMPTZ,
          source    VARCHAR
        )`,
    )
  }

  const tagResponse = await query<Tag>(
    user,
    format(
      `SELECT * FROM tags WHERE "startTime" BETWEEN %L AND %L ORDER BY "startTime"`,
      subHours(start, 12),
      addHours(end, 12),
    ),
  )

  const tags = tagResponse.rows
  const tagIds = tags.map(({ id }) => id)

  let ouraStart: Date = start
  let ouraEnd: Date = end
  if (tagResponse.rowCount) {
    const firstTagAt = new Date(tagResponse.rows[0].startTime)
    const lastTagAt = new Date(tagResponse.rows.at(-1)!.startTime)
    console.log({ firstTagAt, lastTagAt })
    if (isBefore(firstTagAt, start)) ouraStart = subHours(lastTagAt, 12)
    if (isAfter(lastTagAt, end)) ouraEnd = addHours(firstTagAt, 12)
  }

  console.log({ ouraStart, ouraEnd })
  if (isAfter(ouraEnd, ouraStart)) {
    // Fetch possibly new/updated tags from oura.
    const access_token = await oura.getAccessToken(user)
    const tagsFromOura = await oura.getTags(ouraStart, ouraEnd, access_token)

    const newTags = tagsFromOura.filter(({ id }) => !tagIds.includes(id))
    for (const tag of newTags) await storeTag(user, tag)
    return [...tags, ...newTags].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )
  }
  return tags
}

export const storeTag = async (user: string, tag: Tag) => {
  await query(
    user,
    format(
      `INSERT INTO tags (id, tag, "startTime", "endTime", source)
      VALUES(%L, %L, %L, %L, %L)
      ON CONFLICT (id) DO NOTHING`,
      tag.id,
      tag.tag,
      tag.startTime,
      tag.endTime,
      tag.source,
    ),
  )
}
