/** The typed confirmation enables deletion only when it names the account exactly, surrounding spaces aside. */
export const confirmsUsername = (typed: string, username: string): boolean =>
  username !== '' && typed.trim() === username
