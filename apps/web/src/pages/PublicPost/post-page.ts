/** Whether the post page at `/u/:username/posts/:id` belongs to the signed-in user, who reads it signed in. */
export const ownsPostPage = (
  auth: { token?: string | null; user?: string | null },
  username: string,
): boolean => Boolean(auth.token) && auth.user === username
