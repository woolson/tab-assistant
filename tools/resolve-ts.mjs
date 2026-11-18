/**
 * 项目源码使用 bundler 风格的无扩展名相对导入（由 webpack 解析），
 * 而 Node 的 ESM 解析器要求显式扩展名。单测通过这个 loader 补齐扩展名，
 * 这样测试可以直接跑 `.ts` 源码，不需要额外构建步骤。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

export async function resolve(specifier, context, nextResolve) {
  if (isRelative(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const extension of EXTENSIONS) {
      const candidate = new URL(specifier + extension, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}
