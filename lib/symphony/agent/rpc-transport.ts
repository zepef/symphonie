import { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './protocol'

export interface RpcTransport {
  nextId(): number
  sendRaw(msg: JsonRpcRequest | JsonRpcNotification): void
  sendRequest(msg: JsonRpcRequest): Promise<JsonRpcResponse>
  /** Returns true if the message was a response (consumed), false if it is a notification. */
  handleResponseLine(msg: Record<string, unknown>): boolean
  rejectAll(reason: Error): void
}

export function createRpcTransport(writeLine: (line: string) => void): RpcTransport {
  let _reqId = 1

  const pendingRpc = new Map<
    string | number,
    { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }
  >()

  function nextId(): number {
    return _reqId++
  }

  function sendRaw(msg: JsonRpcRequest | JsonRpcNotification) {
    writeLine(JSON.stringify(msg) + '\n')
  }

  function sendRequest(msg: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      pendingRpc.set(msg.id, { resolve, reject })
      sendRaw(msg)
    })
  }

  function handleResponseLine(msg: Record<string, unknown>): boolean {
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as unknown as JsonRpcResponse
      const pending = pendingRpc.get(resp.id)
      if (pending) {
        pendingRpc.delete(resp.id)
        pending.resolve(resp)
        return true
      }
    }
    return false
  }

  function rejectAll(reason: Error): void {
    for (const [id, p] of pendingRpc) {
      p.reject(new Error(`${reason.message} (request ${id})`))
    }
    pendingRpc.clear()
  }

  return { nextId, sendRaw, sendRequest, handleResponseLine, rejectAll }
}
