export type ConfigValues = Record<string, unknown>

/** The config with `key` set, or without it when the value is empty or false. */
export const withConfigValue = (config: ConfigValues, key: string, value: unknown): ConfigValues => {
  const { [key]: _dropped, ...rest } = config
  const empty =
    value === undefined ||
    value === false ||
    value === '' ||
    (typeof value === 'number' && Number.isNaN(value)) ||
    (Array.isArray(value) && value.length === 0)
  return empty ? rest : { ...rest, [key]: value }
}
