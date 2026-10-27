/**
 * src/lib/hostdeps.ts —— 宿主依賴載入器
 */

export async function loadSchemastery(): Promise<any> {
  try {
    // @ts-ignore
    const mod = await import('schemastery')
    return mod.default || mod
  } catch {}
  try {
    // @ts-ignore
    const mod = await import('@deepseek-ai/schemastery')
    return mod.default || mod
  } catch {}

  // 輕量兜底
  const fallback: any = (schema: any) => ({
    description: () => fallback(schema),
    default: () => fallback(schema),
  })
  fallback.object = () => fallback({})
  fallback.string = () => fallback({})
  fallback.number = () => fallback({})
  fallback.boolean = () => fallback({})
  fallback.array = () => fallback({})
  return fallback
}
