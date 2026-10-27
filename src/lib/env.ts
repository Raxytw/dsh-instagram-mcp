/**
 * src/lib/env.ts —— Python 虛擬環境自檢與依賴確保
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export interface PythonEnvResult {
  ok: boolean
  pythonPath: string
  error?: string
}

export async function ensurePythonEnv(
  packageRoot: string,
  userConfigPythonPath?: string,
  log: (msg: string) => void = console.log
): Promise<PythonEnvResult> {
  const isWin = process.platform === 'win32'
  const venvDir = join(packageRoot, 'vendor', 'instagram-mcp', '.venv')
  const venvPython = isWin
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')

  const testPython = (binPath: string): boolean => {
    try {
      if (!existsSync(binPath)) return false
      const res = spawnSync(binPath, ['-c', 'import instagrapi, mcp, pydantic; print("OK")'], {
        encoding: 'utf-8',
        windowsHide: true,
      })
      return res.status === 0 && res.stdout.includes('OK')
    } catch {
      return false
    }
  }

  // 1. 若使用者指定 python 路徑且通過檢測
  if (userConfigPythonPath && testPython(userConfigPythonPath)) {
    log(`[Env] 使用配置之 Python: ${userConfigPythonPath}`)
    return { ok: true, pythonPath: userConfigPythonPath }
  }

  // 2. 若內建 .venv 已經就緒
  if (testPython(venvPython)) {
    log(`[Env] 偵測到已就緒之 Python 虛擬環境: ${venvPython}`)
    return { ok: true, pythonPath: venvPython }
  }

  log('[Env] 內建虛擬環境未就緒，嘗試自動搜尋系統 Python 進行建立...')

  // 3. 搜尋可用系統 Python
  const candidates = isWin
    ? ['python.exe', 'py.exe', 'python3.exe']
    : ['python3', 'python']

  let systemPython: string | null = null
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf-8',
        windowsHide: true,
      })
      if (res.status === 0 && res.stdout.trim().startsWith('3')) {
        systemPython = cmd
        break
      }
    } catch {}
  }

  if (!systemPython) {
    return {
      ok: false,
      pythonPath: '',
      error: '系統找不到 Python 3 環境，請安裝 Python 3.10+ 並加入 PATH。',
    }
  }

  // 4. 建立 .venv
  log(`[Env] 正在使用 ${systemPython} 建立虛擬環境至: ${venvDir}`)
  try {
    const venvParent = join(packageRoot, 'vendor', 'instagram-mcp')
    if (!existsSync(venvParent)) mkdirSync(venvParent, { recursive: true })

    const venvRes = spawnSync(systemPython, ['-m', 'venv', venvDir], {
      windowsHide: true,
      encoding: 'utf-8',
    })
    if (venvRes.status !== 0) {
      return { ok: false, pythonPath: '', error: `建立虛擬環境失敗: ${venvRes.stderr}` }
    }
  } catch (err: any) {
    return { ok: false, pythonPath: '', error: `建立虛擬環境異常: ${err.message}` }
  }

  // 5. 安裝 requirements.txt
  const reqFile = join(packageRoot, 'vendor', 'instagram-mcp', 'requirements.txt')
  log(`[Env] 正在安裝 Python 依賴: ${reqFile}`)
  try {
    const pipRes = spawnSync(venvPython, ['-m', 'pip', 'install', '--quiet', '-r', reqFile], {
      windowsHide: true,
      encoding: 'utf-8',
    })
    if (pipRes.status !== 0) {
      log(`[Env] pip 警告: ${pipRes.stderr}`)
    }
  } catch (err: any) {
    return { ok: false, pythonPath: '', error: `安裝依賴異常: ${err.message}` }
  }

  if (testPython(venvPython)) {
    log(`[Env] 虛擬環境建立成功！使用: ${venvPython}`)
    return { ok: true, pythonPath: venvPython }
  }

  return {
    ok: false,
    pythonPath: venvPython,
    error: '虛擬環境已建立，但 instagrapi 或 mcp 套件未能成功載入。',
  }
}
